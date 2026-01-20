
import '@litejs/cli/test.js'
import { App, loadEnv } from '../index.mjs'
import { listen as listenNode } from '../lib/node.mjs'
import { listen as listenSW, serveCache } from '../lib/service-worker.mjs'
import * as bun from '../lib/bun.mjs'
import * as deno from '../lib/deno.mjs'

describe('node adapter', () => {
	function untilReady(server) {
		return new Promise((resolve, reject) => {
			if (server.listening) return resolve()
			server.once('listening', resolve)
			server.once('error', reject)
		})
	}

	test('serves GET, POST, HEAD and empty bodies over HTTP', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var app = App()
		app.get('hi', () => 'world')
		app.post('echo', async (req) => await req.json())
		app.get('empty', () => undefined)

		var port = 18723
		, server = listenNode(app, { PORT: port, HOSTNAME: '127.0.0.1', BIND_ADDR: '127.0.0.1' })
		await untilReady(server)
		try {
			var base = 'http://127.0.0.1:' + port

			var get = await fetch(base + '/hi')
			assert.equal(get.status, 200)
			assert.equal(get.headers.get('content-type'), 'text/plain')
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

	test('listen returns the server so setupShutdown can close it', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		// Omit HOSTNAME and BIND_ADDR to exercise their defaults.
		var server = listenNode(App(), { PORT: 18724 })
		await untilReady(server)
		assert.equal(typeof server.close, 'function')
		server.close()
	})
})

// Test with swaped globals only in Node, on real runtime those are read-only.
// Real Bun/Deno behavior is tested by test/server/e2e.mjs.
var skip = typeof Bun !== 'undefined' || typeof Deno !== 'undefined'

describe('{0} adapter', !skip && [
	[ 'Bun', bun, o => ({ ...o, stop(){} }) ],
	[ 'Deno', deno, (o, fetch) => ({ ...o, fetch })],

], (name, lib, serve) => {
	test('listen', async (assert, mock) => {
		mock.swap(globalThis, name, { serve })
		mock.swap(console, 'log', () => {})

		var app = App()
		, env = loadEnv(null, {
			HOSTNAME: 'test.litejs.com',
			PORT: 1234
		})
		, server = lib.listen(app, env)

		app.get('x', () => name)

		assert.equal(server.port, 1234)
		assert.equal(server.name, 'http://127.0.0.1:8080')
		assert.type(server.fetch, 'asyncfunction')

		var res = await server.fetch(new Request('http://localhost/x'))
		assert.equal(await res.text(), name)

		// PORT defaults to 8080
		server = lib.listen(app)
		assert.equal(server.port, 8080)
	})
})

describe('service-worker adapter', () => {
	if (skip) return
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

