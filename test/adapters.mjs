
import '@litejs/cli/test.js'
import { App, loadEnv } from '../index.mjs'
import { listen as listenNode } from '../lib/node.mjs'
import { DurableObject, Server as ServerSW, listen as listenSW, serveCache, worker as workerSW } from '../lib/browser.mjs'
import * as bun from '../lib/bun.mjs'
import * as deno from '../lib/deno.mjs'
import https from 'node:https'
import net from 'node:net'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

var fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// Poll until the server answers, decoupled from any adapter-specific readiness event.
, untilReady = async (get, last) => {
	for (var i = 0; i < 100; i++) try { return await get() } catch (e) { last = e, await sleep(20) }
	throw last
}
, httpsGet = (port, path) => new Promise((resolve, reject) => {
	// agent:false forces a fresh TLS handshake so we observe the current cert after a reload.
	https.get({ host: '127.0.0.1', port, path, rejectUnauthorized: false, agent: false }, res => {
		var body = ''
		res.setEncoding('utf8')
		res.on('data', d => body += d)
		res.on('end', () => resolve({ status: res.statusCode, body, fp: res.socket.getPeerCertificate().fingerprint256 }))
	}).on('error', reject)
})
// fetch() normalizes the request target before sending, so odd paths need a raw request line.
, rawGet = (port, target, host = '127.0.0.1:' + port) => new Promise((resolve, reject) => {
	var buf = ''
	, socket = net.connect(port, '127.0.0.1', () => socket.write(
		'GET ' + target + ' HTTP/1.1\r\nHost: ' + host + '\r\nConnection: close\r\n\r\n'
	))
	socket.setEncoding('utf8')
	socket.on('data', d => buf += d)
	socket.on('error', reject)
	socket.on('close', () => {
		var end = buf.indexOf('\r\n\r\n')
		, head = buf.slice(0, end)
		, body = buf.slice(end + 4)
		// Responses here are small enough to arrive in a single chunk.
		resolve({
			status: +buf.slice(9, 12),
			location: (head.match(/^location: *(.*)$/im) || [])[1],
			body: /^transfer-encoding: *chunked/im.test(head) ? body.split('\r\n')[1] || '' : body,
		})
	})
})

// Test with swaped globals only in Node, on real runtime those are read-only.
// Real Bun/Deno behavior is tested by test/server/e2e.mjs.
var skip = typeof Bun !== 'undefined' || typeof Deno !== 'undefined'

describe('node adapter', !skip && (() => {
	test('serves GET, POST, HEAD and empty bodies over HTTP', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var app = App()
		app.get('hi', () => 'world')
		app.post('echo', async (req) => await req.json())
		app.get('empty', () => undefined)

		var port = 18723
		, base = 'http://127.0.0.1:' + port
		, server = listenNode(app, { PORT: port, HOSTNAME: '127.0.0.1', BIND_ADDR: '127.0.0.1' })
		try {
			var get = await untilReady(() => fetch(base + '/hi'))
			assert.equal(get.status, 200)
			assert.equal(await get.text(), 'world')

			var post = await fetch(base + '/echo', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ a: 1 }),
			})
			assert.equal(await post.json(), { a: 1 }, 'request body is streamed to the handler')

			var head = await fetch(base + '/hi', { method: 'HEAD' })
			assert.equal(head.status, 200)
			assert.equal(await head.text(), '', 'HEAD response has no body')

			var empty = await fetch(base + '/empty')
			assert.equal(empty.status, 200)
			assert.equal(await empty.text(), '', 'empty handler result sends no body')
		} finally {
			server.close()
		}
	})

	test('listen returns a { name, close } controller', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		// Omit HOSTNAME and BIND_ADDR to exercise their defaults.
		var base = 'http://127.0.0.1:18724'
		, server = listenNode(App(), { PORT: 18724 })
		await untilReady(() => fetch(base))
		assert.equal(typeof server.close, 'function')
		server.reload() // without a TLS listener reload is a no-op
		server.close()
	})

	test('builds the url from the target without resolving it as relative', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var port = 18725
		, origin = 'http://127.0.0.1:' + port
		// Every target below is unrouted, so notFound reports what the adapter built.
		, app = App({ notFound: req => req.origin + ' ' + req.path })
		, server = listenNode(app, { PORT: port, BIND_ADDR: '127.0.0.1' })
		try {
			await untilReady(() => fetch(origin))

			var empty = await rawGet(port, '/pub//file')
			assert.equal(empty.status, 301, 'an empty path segment redirects')
			assert.equal(empty.location, '/pub/file', 'the duplicate slash is collapsed')

			// A leading // is a path here, not a network-path reference.
			var authority = await rawGet(port, '//evil.com/x')
			assert.equal(authority.location, '/evil.com/x', 'the redirect carries no authority at all')

			var slashes = await rawGet(port, '///')
			assert.equal(slashes.location, '/', 'a bare /// collapses to the root')

			// Absolute-form is already a url, and per RFC 9112 its authority wins over Host.
			// Deno resolves it the same way.
			var absolute = await rawGet(port, 'http://elsewhere.test/x')
			assert.equal(absolute.body, 'http://elsewhere.test /x', 'absolute-form is used as given')

			var badHost = await rawGet(port, '/hi', 'bad host')
			assert.equal(badHost.status, 400, 'a Host that cannot form a url returns 400')

			for (var target of [
				'foo/bar',
				'../../etc/passwd',
				'evil.com/x',
				'javascript:alert(1)',
				'file:///etc/passwd',
				'htp://localhost/etc/passwd',
				'data:text/html,x',
				'127.0.0.1:' + port,
				'\\x',
			]) assert.equal((await rawGet(port, target)).status, 400, 'refuses ' + target)

			assert.equal((await rawGet(port, '/pub/file')).status, 200, 'the server is still up')
		} finally {
			server.close()
		}
	})

	test('a body stream that errors mid-response does not down the server', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var port = 18726
		, base = 'http://127.0.0.1:' + port
		, app = App()
		app.get('boom', () => new Response(new ReadableStream({
			start(c) {
				c.enqueue(new TextEncoder().encode('partial'))
				setTimeout(() => c.error(new Error('disk blew up')), 20)
			}
		}), { headers: { 'content-length': '999' } }))
		app.get('hi', () => 'world')

		var server = listenNode(app, { PORT: port, BIND_ADDR: '127.0.0.1' })
		try {
			await untilReady(() => fetch(base + '/hi'))
			// Headers are already sent, so the client can only see a cut-off body.
			var cut = 0
			try {
				await (await fetch(base + '/boom')).text()
			} catch (e) {
				cut = 1
			}
			assert.ok(cut, 'the truncated body is reported to the client')
			assert.equal(await (await fetch(base + '/hi')).text(), 'world', 'the server is still up')
		} finally {
			server.close()
		}
	})

	test('serves over HTTPS and rotates certs on reload', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var app = App()
		app.get('hi', () => 'world')

		var dir = mkdtempSync(join(tmpdir(), 'litejs-tls-'))
		, key = join(dir, 'k.pem')
		, cert = join(dir, 'c.pem')
		, port = 18731
		copyFileSync(join(fixtures, 'tls1.key'), key)
		copyFileSync(join(fixtures, 'tls1.crt'), cert)

		var server = listenNode(app, { HTTPS_KEY: key, HTTPS_CERT: cert, HTTPS_PORT: port, BIND_ADDR: '127.0.0.1' })
		try {
			var r1 = await untilReady(() => httpsGet(port, '/hi'))
			assert.equal(r1.status, 200)
			assert.equal(r1.body, 'world', 'serves over TLS')

			// Swap in the second cert and hot-reload without a restart.
			copyFileSync(join(fixtures, 'tls2.key'), key)
			copyFileSync(join(fixtures, 'tls2.crt'), cert)
			server.reload()

			var r2 = await httpsGet(port, '/hi')
			assert.equal(r2.body, 'world', 'still serving after reload')
			assert.notEqual(r2.fp, r1.fp, 'presented certificate changed after reload')
		} finally {
			server.close()
			rmSync(dir, { recursive: true, force: true })
		}
	})

	test('redirects plain HTTP to HTTPS when both are bound', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var app = App()
		app.get('hi', () => 'world')

		var httpsPort = 18732
		, httpPort = 18733
		, server = listenNode(app, {
			HTTPS_KEY: join(fixtures, 'tls1.key'),
			HTTPS_CERT: join(fixtures, 'tls1.crt'),
			HTTPS_PORT: httpsPort,
			PORT: httpPort,
			BIND_ADDR: '127.0.0.1',
		})
		try {
			// HTTPS still serves the app.
			var secure = await untilReady(() => httpsGet(httpsPort, '/hi'))
			assert.equal(secure.body, 'world', 'HTTPS serves the app')

			// Plain HTTP 301-redirects to HTTPS on the configured port.
			var redirect = await untilReady(() => fetch('http://127.0.0.1:' + httpPort + '/hi', { redirect: 'manual' }))
			assert.equal(redirect.status, 301, 'HTTP returns a redirect')
			assert.equal(redirect.headers.get('location'), 'https://127.0.0.1:' + httpsPort + '/hi', 'redirects to HTTPS')
		} finally {
			server.close()
		}
	})
}))

describe('{0} adapter', !skip && [
	[ 'Bun', bun ],
	[ 'Deno', deno ],
], (name, lib) => {
	test('Server() listens on the loaded env and mounts the static root last', async (assert, mock) => {
		var calls = []
		, serve = (o, handler) => (calls.push({ ...o, fetch: o.fetch || handler }), { stop() {}, shutdown() {}, reload() {} })
		mock.swap(globalThis, name, { serve })
		mock.swap(console, 'log', () => {})
		mock.swap(process, 'env', {})
		mock.swap(process, 'on', () => {}) // setupShutdown must not touch the test runner

		var app = App()
		app.get('x', () => name)
		var server = lib.Server(app, fixtures)

		assert.equal(calls[0].port, 8080, 'PORT comes from loadEnv, not from the caller')
		assert.equal(typeof server.close, 'function', 'hands back the listen() controller')

		var routed = await calls[0].fetch(new Request('http://localhost/x'))
		assert.equal(await routed.text(), name, 'the app own routes still win')

		var asset = await calls[0].fetch(new Request('http://localhost/tls1.crt'))
		assert.equal(asset.status, 200, 'the static root is served under them')

		var miss = await calls[0].fetch(new Request('http://localhost/nope'))
		assert.equal(miss.status, 404, 'a static miss is the 404')

		// Without a directory nothing is mounted, so the app alone answers.
		var bare = App()
		bare.get('y', () => 'bare')
		lib.Server(bare)
		assert.equal(await (await calls[1].fetch(new Request('http://localhost/y'))).text(), 'bare')
		assert.equal((await calls[1].fetch(new Request('http://localhost/tls1.crt'))).status, 404, 'no static root without a dir')
	})

	test('listen passes options to {0}.serve and returns a { name, close } controller', async (assert, mock) => {
		// Capture each serve() call. Bun puts fetch in options.fetch and TLS in
		// options.tls; Deno passes the handler as the 2nd arg and TLS at top level.
		var calls = []
		, stop = mock.fn(Promise.resolve()) // one spy counts stop+shutdown; a Promise so Deno reload can chain
		, reload = mock.fn()
		, serve = (o, handler) => (calls.push({ ...o, fetch: o.fetch || handler }), { stop, shutdown: stop, reload })
		mock.swap(globalThis, name, { serve })
		mock.swap(console, 'log', () => {})

		var app = App()
		app.get('x', () => name)
		app.get('defer', (req, env, ctx) => (ctx.waitUntil(Promise.resolve()), name))
		var env = loadEnv(null, { HOSTNAME: 'test.litejs.com', PORT: 1234 })
		, server = lib.listen(app, env)

		assert.equal(calls[0].port, 1234, 'binds PORT')
		assert.equal(calls[0].hostname, '0.0.0.0', 'BIND_ADDR default')
		assert.equal(server.name, 'http://test.litejs.com:1234', 'SERVER_NAME is computed from the merged env')
		assert.equal(typeof server.close, 'function', 'uniform close')

		var res = await calls[0].fetch(new Request('http://localhost/x'))
		assert.equal(await res.text(), name, 'serve handler routes through the app')

		var deferred = await calls[0].fetch(new Request('http://localhost/defer'))
		assert.equal(await deferred.text(), name, 'ctx.waitUntil is wired (no-op off Workers)')

		server.close()
		assert.equal(stop.called, 1, 'close() stops the single listener')
		server.reload() // without a TLS listener reload is a no-op

		// PORT defaults to 8080
		lib.listen(app)
		assert.equal(calls[1].port, 8080)

		// HTTPS_* switches to TLS on HTTPS_PORT (Bun: options.tls, Deno: top-level key/cert)
		var pem = readFileSync(join(fixtures, 'tls1.key'), 'utf8')
		, crt = readFileSync(join(fixtures, 'tls1.crt'), 'utf8')
		lib.listen(app, { HTTPS_KEY: pem, HTTPS_CERT: crt, HTTPS_PORT: 8443 })
		var c = calls[2]
		assert.equal(calls.length, 3, 'TLS-only: a single listener (no PORT)')
		assert.equal(c.port, 8443, 'TLS listens on HTTPS_PORT')
		assert.ok((c.tls?.key || c.key) && (c.tls?.cert || c.cert), 'key and cert handed to serve')

		// With PORT: two listeners, the HTTP one redirects to HTTPS.
		var dual = lib.listen(app, { HTTPS_KEY: pem, HTTPS_CERT: crt, HTTPS_PORT: 8443, PORT: 8080 })
		assert.equal(calls.length, 5, 'binds both HTTPS and HTTP listeners')
		assert.equal(calls[3].port, 8443, 'HTTPS on HTTPS_PORT')
		assert.equal(calls[4].port, 8080, 'HTTP on PORT')
		var red = await calls[4].fetch(new Request('http://localhost/hi'))
		assert.equal(red.status, 301, 'HTTP listener redirects')
		assert.equal(red.headers.get('location'), 'https://localhost:8443/hi', 'redirects to HTTPS')

		// reload(): Bun hot-swaps the cert in place; Deno drains and rebinds the TLS listener.
		dual.reload()
		await sleep(0)
		name === 'Bun'
			? assert.own(reload.calls[0].args[0], { tls: { key: pem, cert: crt } }, 'reload hands a fresh tls cert to the server')
			: assert.equal(calls[5].port, 8443, 'reload rebinds the TLS listener on HTTPS_PORT')

		var before = stop.called
		dual.close()
		assert.equal(stop.called, before + 2, 'close() stops both listeners')

		// TLS with default HTTPS_PORT; the HTTP listener redirects there.
		var n = calls.length
		, both = lib.listen(app, { HTTPS_KEY: pem, HTTPS_CERT: crt, PORT: 8080 })
		assert.equal(calls[n].port, 8443, 'HTTPS_PORT defaults to 8443')
		var red2 = await calls[n + 1].fetch(new Request('http://localhost/x'))
		assert.equal(red2.headers.get('location'), 'https://localhost:8443/x', 'redirects to the default HTTPS_PORT')
		both.reload() // rebinds (Deno) or hot-swaps (Bun) using the default HTTPS_PORT
		await sleep(0)
	})
})

describe('service-worker adapter', () => {
	if (skip) return

	test('throws not implemented', async assert => {
		assert.throws(() => {
			var instance = new DurableObject()
		})
	})

	test('Server() registers the fetch event, ignoring any static root', async (assert, mock) => {
		var app = App()
		app.get('sw', () => 'sw-ok')

		var handlers = {}
		mock.swap(globalThis, 'addEventListener', (type, fn) => { handlers[type] = fn })
		mock.swap(globalThis, 'skipWaiting', () => {})
		mock.swap(globalThis, 'clients', { claim: () => 'claim-token' })

		assert.equal(ServerSW(app, 'public'), undefined, 'there is no module shape to return')

		var responded
		handlers.fetch({ request: new Request('http://localhost/sw'), respondWith: (p) => { responded = p } })
		assert.equal(await (await responded).text(), 'sw-ok', 'the app answers through the event')
	})

	test('listen wires install, activate and fetch to the worker', async (assert, mock) => {
		var app = App()
		app.get('sw', () => 'sw-ok')

		var handlers = {}
		, skipped = false
		// The service worker uses bare ServiceWorkerGlobalScope globals.
		mock.swap(globalThis, 'addEventListener', (type, fn) => { handlers[type] = fn })
		mock.swap(globalThis, 'skipWaiting', () => { skipped = true })
		mock.swap(globalThis, 'clients', { claim: () => 'claim-token' })

		listenSW(app)

		handlers.install()
		assert.equal(skipped, true, 'install calls skipWaiting')

		var activateToken
		handlers.activate({ waitUntil: (v) => { activateToken = v } })
		assert.equal(activateToken, 'claim-token', 'activate claims clients')

		var responded
		handlers.fetch({ request: new Request('http://localhost/sw'), respondWith: (p) => { responded = p } })
		var res = await responded
		assert.equal(await res.text(), 'sw-ok', 'fetch is answered by the worker')
	})

	test('serveCache serves cache hits and caches successful fetches', async (assert, mock) => {
		var store = new Map()
		mock.swap(globalThis, 'caches', { open: async () => ({
			match: (req) => store.get(req.url),
			put: (req, res) => { store.set(req.url, res) },
		}) })
		var calls = []
		mock.swap(globalThis, 'fetch', async (req) => {
			calls.push(req.url)
			var ok = !req.url.endsWith('/bad')
			return new Response(ok ? 'asset' : 'no', { status: ok ? 200 : 404 })
		})

		var assets = serveCache('v1')

		var miss = await assets.fetch(new Request('http://localhost/app.js'))
		assert.equal(await miss.text(), 'asset')
		assert.equal(calls.length, 1, 'a miss goes to the network')

		var hit = await assets.fetch(new Request('http://localhost/app.js'))
		assert.equal(await hit.text(), 'asset')
		assert.equal(calls.length, 1, 'a hit is served from cache')

		assert.equal((await assets.fetch(new Request('http://localhost/bad'))).status, 404)
		await assets.fetch(new Request('http://localhost/bad'))
		assert.equal(calls.length, 3, 'failed responses are not cached')
	})
})

