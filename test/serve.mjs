
import '@litejs/cli/test.js'
import { App } from '../index.mjs'
import { serveRange, toHandler } from '../lib/serve.mjs'
// serveStatic is built per runtime from staticFrom(); this is the node one.
import { serveStatic } from '../lib/env.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('serveStatic', () => {
	var assets
	, testDir = path.join(__dirname, '_static-test')
	, pubDir = path.join(testDir, 'pub')
	, subDir = path.join(pubDir, 'sub')
	, siblingDir = pubDir + '2'

	test('setup', (assert) => {
		fs.rmSync(testDir, { recursive: true, force: true })

		fs.mkdirSync(subDir, { recursive: true })
		fs.writeFileSync(path.join(subDir, 'img.png'), 'PNG')

		fs.writeFileSync(path.join(pubDir, '.env'), 'SECRET=1')
		fs.writeFileSync(path.join(pubDir, 'index.html'), '<h1>Home</h1>')
		fs.writeFileSync(path.join(pubDir, 'hello.txt'), 'hello')
		fs.writeFileSync(path.join(pubDir, 'data.bin'), 'binary')

		fs.mkdirSync(siblingDir, { recursive: true })
		fs.writeFileSync(path.join(testDir, 'secret.txt'), 'SECRET1')
		fs.writeFileSync(path.join(siblingDir, 'secret.txt'), 'SECRET2')

		fs.mkdirSync(path.join(pubDir, '.git'), { recursive: true })
		fs.writeFileSync(path.join(pubDir, '.git', 'config'), 'cfg')

		fs.mkdirSync(path.join(pubDir, '.well-known'), { recursive: true })
		fs.writeFileSync(path.join(pubDir, '.well-known', 'security.txt'), 'Contact: x')

		fs.mkdirSync(path.join(pubDir, '.well-known2'), { recursive: true })
		fs.writeFileSync(path.join(pubDir, '.well-known2', 'evil.txt'), 'Evil')

		assets = serveStatic(pubDir)
		assert.type(assets.fetch, 'asyncfunction')
		assert.end()
	})

	test('no baseDir serves from the working directory', async (assert) => {
		var res = await serveStatic().fetch(new Request('http://localhost/package.json'))
		assert.equal(res.status, 200, 'defaults the root to cwd')
		assert.equal(res.headers.get('content-type'), 'application/json')
	})

	test('200 - {0}fetch index.html on root', [
		[ 'index.html on root', 'http://localhost/', '<h1>Home</h1>', 'text/html; charset=utf-8' ],
		[ 'file', 'http://localhost/hello.txt', 'hello', 'text/plain; charset=utf-8' ],
		[ 'subdir', 'http://localhost/sub/img.png', 'PNG', 'image/png' ],
		[ 'unknown extension', 'http://localhost/data.bin', 'binary', 'application/octet-stream' ],
		[ '.well-known is served', 'http://localhost/.well-known/security.txt', 'Contact: x', 'text/plain; charset=utf-8' ]
	], async (name, url, text, type, assert) => {
		const res = await assets.fetch(new Request(url))
		assert.equal(res.status, 200)
		assert.equal(await res.text(), text)
		assert.equal(res.headers.get('content-type'), type)
	})

	test('404 - {0}', [
		[ 'missing file', 'http://localhost/missing.txt' ],
		[ 'path traversal', 'http://localhost/../secret.txt' ],
		[ 'path traversal same root prefix', 'http://localhost/../pub2/secret.txt' ],
		[ 'URL encoded path traversal', 'http://localhost/%2e%2e/secret.txt' ],
		[ 'encoded-slash path traversal', 'http://localhost/%2e%2e%2fsecret.txt' ],
		[ 'multiple path traversals', 'http://localhost/../../tsconfig.json' ],
		[ 'fetch directory', 'http://localhost/sub' ],
		[ 'dotfiles', 'http://localhost/.env' ],
		[ 'dotdir', 'http://localhost/.git/config' ],
		[ '.well-known prefix', 'http://localhost/.well-known2/evil.txt'],
	], async (desc, url, assert) => {
		try {
			var file = decodeURIComponent(url.slice(17))
			, exists = file === 'missing.txt' || !!fs.statSync(path.join(pubDir, file), { throwIfNoEntry: false })
			//console.log(exists, file, path.join(pubDir, file))
			assert.equal(exists, true)
		} catch {}
		assert.equal(await assets.fetch(new Request(url)), 404)
	})

	test('cleanup', async (assert) => {
		fs.rmSync(testDir, { recursive: true, force: true })
		assert.ok(true)
	})
})

describe('serveRange', () => {
	var body = '0123456789'
	, full = () => new Response(body, { headers: { 'content-length': '10', 'content-type': 'text/plain' } })
	, get = headers => new Request('http://localhost/f', { headers })

	it('serves {0} as bytes {1}', [
		['bytes=0-3', '0-3/10', '0123'],
		['bytes=4-', '4-9/10', '456789'],
		['bytes=-3', '7-9/10', '789'],
		['bytes=0-0', '0-0/10', '0'],
	], async (range, contentRange, expected, assert) => {
		var res = await serveRange(get({ range }), full())
		assert.equal(res.status, 206)
		assert.equal(await res.text(), expected)
		assert.equal(res.headers.get('content-range'), 'bytes ' + contentRange)
		assert.equal(res.headers.get('content-length'), '' + expected.length)
		assert.equal(res.headers.get('content-type'), 'text/plain', 'other headers are kept')
	})

	it('serves the full body for {1}', [
		[{}, 'no Range header'],
		[{ range: 'bytes=4-2' }, 'a backwards range'],
		[{ range: 'bytes=10-' }, 'an unsatisfiable range'],
		[{ range: 'bytes=0-99' }, 'an over-long range'],
		[{ range: 'bytes=-99' }, 'an over-long suffix'],
		[{ range: 'bytes=-' }, 'an empty range'],
		[{ range: 'bytes=0-1,3-4' }, 'multiple ranges'],
		[{ range: 'items=0-1' }, 'unknown units'],
		[{ range: 'bytes=0-3', 'if-range': '"v1"' }, 'If-Range (validators are not tracked)'],
	], async (headers, name, assert) => {
		var res = full()
		assert.strictEqual(await serveRange(get(headers), res), res, 'response passes through untouched')
	})

	test('passes through when status or length disqualify', async (assert) => {
		var missing = new Response(null, { status: 404 })
		assert.strictEqual(await serveRange(get({ range: 'bytes=0-1' }), Promise.resolve(missing)), missing, 'non-200 and promised responses')
		// An upstream (R2, assets, a nested serveRange) may have honored Range already.
		var partial = new Response('23', { status: 206, headers: { 'content-length': '2', 'content-range': 'bytes 2-3/10' } })
		assert.strictEqual(await serveRange(get({ range: 'bytes=2-3' }), partial), partial, 'an already-ranged 206 is not sliced again')
		var unsized = new Response(body, { headers: { 'content-type': 'text/plain' } })
		unsized.headers.delete('content-length')
		assert.strictEqual(await serveRange(get({ range: 'bytes=0-1' }), unsized), unsized, 'unknown content-length')
		var bodyless = new Response(null, { headers: { 'content-length': '10' } })
		assert.strictEqual(await serveRange(get({ range: 'bytes=0-1' }), bodyless), bodyless, 'a length with no body')
	})
})

describe('handler', () => {
	function send(handler, path, opts, env) {
		return toHandler(handler)(new Request('http://localhost' + path, opts), env)
	}

	test('a malformed url return 400', async (assert) => {
		assert.equal((await send(() => 202, '/p/100%')).status, 400)
	})

	// Location is relative, so a client-supplied Host cannot steer the redirect.
	test('{0} redirects to {1}', [
		[ '/a//b', '/a/b' ],
		[ '//', '/' ],
		[ '/a//', '/a/' ],
		[ '/a///b//c', '/a/b/c' ], // runs of slashes collapse to one
		[ '/a//b?x=1&y=2', '/a/b?x=1&y=2' ], // the query is kept
	], async (path, expected, assert) => {
		var called = 0
		, res = await send(() => (called++, 'body'), path)
		assert.equal(res.status, 301)
		assert.equal(res.headers.get('location'), expected)
		assert.equal(await res.text(), '', 'the redirect has no body')
		assert.equal(called, 0, 'the handler is not run')
	})

	test('{0} is not redirected', [
		[ '/a/b' ],
		[ '/menu/a%2F%2Fb' ], // encoded slashes are a path segment, not a separator
	], async (path, assert) => {
		var res = await send(req => req.path, path)
		assert.equal(res.status, 200)
		assert.equal(await res.text(), path)
	})

	test('normalizes a handler result to a {1} Response with body {2}', [
		[() => ({ a: 1 }), 200, '{"a":1}', 'application/json'], // an object is JSON
		[() => [1, 2], 200, '[1,2]', 'application/json'], // an array is JSON too
		[() => 204, 204, '', null], // a number is a bare status
		[() => undefined, 200, '', null], // a falsy result is an empty 200
		[() => 100, 500, '', null], // an out-of-range status falls back to 500
	], async (handler, expectedStatus, expectedBody, expectedType, assert) => {
		var res = await send(handler, '/')
		assert.ok(res instanceof Response)
		assert.equal(res.status, expectedStatus)
		assert.equal(await res.text(), expectedBody)
		assert.equal(res.headers.get('content-type'), expectedType)
	})

	test('a string is sent as the body; the handler forces no content-type', async (assert) => {
		var res = await send(() => 'plain', '/')
		assert.equal(res.status, 200)
		assert.equal(await res.text(), 'plain')
	})

	test('status and headers come from req.resStatus / req.resHeaders', async (assert) => {
		var res = await send(req => {
			req.resStatus = 201
			req.resHeaders['content-type'] = 'text/html'
			return '<p>hi</p>'
		}, '/')
		assert.equal(res.status, 201)
		assert.equal(await res.text(), '<p>hi</p>')
		assert.equal(res.headers.get('content-type'), 'text/html')
	})

	test('ctx is forwarded to the handler', async (assert) => {
		var ctx = { waitUntil() {} }, seen
		await toHandler((req, env, c) => (seen = c, 204))(new Request('http://localhost/'), {}, ctx)
		assert.strictEqual(seen, ctx)
	})

	test('a missing ctx gets a no-op waitUntil', async (assert) => {
		var res = await send((req, env, ctx) => (ctx.waitUntil(Promise.resolve()), 'deferred'), '/')
		assert.equal(await res.text(), 'deferred')
	})

	test('a returned Response is passed through unchanged', async (assert) => {
		var res = await send(() => new Response('raw body', { status: 207 }), '/')
		assert.equal(res.status, 207)
		assert.equal(await res.text(), 'raw body')
	})

	test('a stream body is passed through without serialization', async (assert) => {
		var res = await send(() => new Blob(['streamed']).stream(), '/')
		assert.equal(await res.text(), 'streamed')
		assert.equal(res.headers.get('content-type'), null, 'no content-type is forced')
	})

	test('request is patched with path, query, origin and searchParams', async (assert) => {
		var res = await send(req => ({
			path: req.path,
			fullPath: req.fullPath,
			query: req.query,
			origin: req.origin,
			x: req.searchParams.get('x'),
		}), '/q?x=1&y=2')
		assert.equal(await res.json(), {
			path: '/q',
			fullPath: '/q',
			query: 'x=1&y=2',
			origin: 'http://localhost',
			x: '1',
		})
	})

	test('a fixed env wins over the per-request argument', async (assert) => {
		var fixed = { A: 'fixed' }
		, w = toHandler((req, env) => env, fixed)
		, res = await w(new Request('http://localhost/'), { A: 'request' })
		assert.equal(await res.json(), fixed)
	})

	test('without a fixed env the per-request one is used', async (assert) => {
		var res = await send((req, env) => env, '/', {}, { A: 'request' })
		assert.equal(await res.json(), { A: 'request' })
	})

	test('a thrown error becomes a generic, logged 500', async (assert, mock) => {
		mock.swap(console, 'error', mock.fn())
		var res = await send(() => { throw new Error('db secret') }, '/')
		assert.equal(res.status, 500)
		assert.equal(await res.text(), 'Internal Server Error', 'internal message is not leaked')
		assert.equal(console.error.called, 1, 'error is logged server-side')
	})

	test('a thrown error with a 4xx code exposes its message', async (assert, mock) => {
		mock.swap(console, 'error', mock.fn())
		var res = await send(() => { var e = new Error('gone'); e.code = 410; throw e }, '/')
		assert.equal(res.status, 410)
		assert.equal(await res.text(), 'gone', 'an intentional 4xx exposes its message')
	})

	test('a thrown error with a 5xx code stays generic', async (assert, mock) => {
		mock.swap(console, 'error', mock.fn())
		var res = await send(() => { var e = new Error('upstream creds'); e.code = 503; throw e }, '/')
		assert.equal(res.status, 503)
		assert.equal(await res.text(), 'Internal Server Error', 'internal message is not leaked on 5xx')
	})

	test('a 4xx error with no message yields an empty body', async (assert, mock) => {
		mock.swap(console, 'error', mock.fn())
		var e = new Error('')
		e.code = 422
		var res = await send(() => { throw e }, '/')
		assert.equal(res.status, 422)
		assert.equal(await res.text(), '', 'no message, empty body')
	})

	test('shaping failure is a logged 500, not a rejection: {0}', [
		[ 'an invalid header value', req => (req.resHeaders.Location = '/x\r\nX-Injected: 1', 302) ],
		[ 'a circular object', () => { var o = {}; o.self = o; return o } ],
		[ 'a BigInt field', () => ({ n: 1n }) ],
		[ 'an unconstructable body', () => Symbol('nope') ],
		[ 'a toJSON that throws a non-Error', () => ({ toJSON() { throw 'no stack' } }) ],
	], async (_, handler, assert, mock) => {
		mock.swap(console, 'error', mock.fn())
		var res = await send(handler, '/')
		assert.equal(res.status, 500)
		assert.equal(await res.text(), 'Internal Server Error', 'internal message is not leaked')
		assert.equal(res.headers.get('x-injected'), null, 'no header survives a failed shaping')
		assert.equal(console.error.called, 1, 'error is logged server-side')
	})

	test('a throw with no stack is logged as the thrown value itself', async (assert, mock) => {
		mock.swap(console, 'error', mock.fn())
		await send(() => { throw 'boom' }, '/')
		assert.equal(console.error.calls[0].args[0], 'boom', 'falls back to the value when there is no stack')
	})

	test('req.resHeaders pass through; set-cookie keys append', async (assert) => {
		var res = await send(req => {
			req.resHeaders['x-foo'] = 'bar'
			req.resHeaders['set-cookie'] = 'a=1'
			req.resHeaders['Set-cookie'] = 'b=2'
			return 'ok'
		}, '/')
		assert.equal(res.headers.get('x-foo'), 'bar')
		assert.equal(res.headers.getSetCookie(), ['a=1', 'b=2'])
		assert.equal(await res.text(), 'ok')
	})

	test('HEAD strips the response body but keeps status and headers', async (assert) => {
		var res = await send(req => (req.resHeaders['content-type'] = 'text/html', 'world'), '/', { method: 'HEAD' })
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-type'), 'text/html', 'headers are preserved')
		assert.equal(await res.text(), '', 'body is stripped for HEAD')
	})
})


describe('handler integration', () => {
	var app = App()
	, menu = App()
	, server = toHandler(app)
	, handler = req => [req.fullPath, req.path, req.param]

	app.get('hi', handler)
	app.get('menü', handler)

	app.mount('menu', menu)

	menu.get('{order}', handler)

	test('encoding {i}', [
		[ '/hi', ['/hi', '/hi', {}] ],
		[ '/men%C3%BC', ['/menü', '/men%C3%BC', {}] ],
		[ '/men%c3%bc', ['/menü', '/men%c3%bc', {}] ],
		[ '/menu/caf%C3%A9', ['/menu/café', '/caf%C3%A9', { order: 'café' }] ],
		[ '/menu/a%2Fb', ['/menu/a%2Fb', '/a%2Fb', { order: 'a/b' }] ],
		[ '/menu/a%252Fb', ['/menu/a%2Fb', '/a%252Fb', { order: 'a%2Fb' }] ],
	], async (url, expected, assert) => {
		var res = await server(new Request('http://localhost' + url))
		assert.equal(await res.json(), expected)
	})

})
