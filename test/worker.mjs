
import '@litejs/cli/test.js'
import { App } from '../app.mjs'
import { worker } from '../lib/worker.mjs'

describe('worker adapter', () => {
	function send(w, path, opts) {
		return w(new Request('http://localhost' + path, opts))
	}

	test('wraps handler results in a Response with the right content-type', [
		[() => 'plain', 'plain', 'text/plain'],
		[() => ({ a: 1 }), '{"a":1}', 'application/json'],
		[() => [1, 2], '[1,2]', 'application/json'],
	], async (handler, expectedBody, expectedType, assert) => {
		var app = App()
		app.get('r', handler)
		var res = await send(worker(app), '/r')
		assert.ok(res instanceof Response)
		assert.equal(res.status, 200)
		assert.equal(await res.text(), expectedBody)
		assert.equal(res.headers.get('content-type'), expectedType)
	})

	test('full response object sets status, body and headers', async (assert) => {
		var app = App()
		app.get('html', () => ({ body: '<p>hi</p>', status: 201, headers: { 'content-type': 'text/html' } }))
		var res = await send(worker(app), '/html')
		assert.equal(res.status, 201)
		assert.equal(await res.text(), '<p>hi</p>')
		assert.equal(res.headers.get('content-type'), 'text/html', 'handler content-type is not overridden')
	})

	test('thrown error maps to 500 with JSON error body', async (assert) => {
		var app = App()
		app.get('boom', () => { throw new Error('nope') })
		var res = await send(worker(app), '/boom')
		assert.equal(res.status, 500)
		assert.equal(await res.text(), '{"error":"nope"}')
		assert.equal(res.headers.get('content-type'), 'application/json')
	})

	test('a returned Response is passed through unchanged', async (assert) => {
		var app = App()
		app.get('raw', () => new Response('raw body', { status: 207 }))
		var res = await send(worker(app), '/raw')
		assert.equal(res.status, 207)
		assert.equal(await res.text(), 'raw body')
	})

	test('request is patched with path, query, origin and searchParams', async (assert) => {
		var app = App()
		app.get('q', (req) => ({
			path: req.path,
			fullPath: req.fullPath,
			query: req.query,
			origin: req.origin,
			x: req.searchParams.get('x'),
		}))
		var res = await send(worker(app), '/q?x=1&y=2')
		assert.equal(await res.json(), {
			path: '/q',
			fullPath: '/q',
			query: 'x=1&y=2',
			origin: 'http://localhost',
			x: '1',
		})
	})

	test('req.header is a shorthand for headers.get', async (assert) => {
		var app = App()
		app.get('h', (req) => req.header('x-test'))
		var res = await send(worker(app), '/h', { headers: { 'x-test': 'value' } })
		assert.equal(await res.text(), 'value')
	})

	test('env merges defaults with per-request env, request wins', async (assert) => {
		var app = App()
		app.get('env', (req, env) => env.A + ',' + env.B)
		var w = worker(app, { A: 'default', B: 'def' })
		var res = await w(new Request('http://localhost/env'), { B: 'override' })
		assert.equal(await res.text(), 'default,override')
	})

	test('non-object handler results are normalized', async (assert) => {
		var num = await worker(() => 204)(new Request('http://localhost/'))
		assert.equal(num.status, 204, 'a number becomes a bare status')
		assert.equal(await num.text(), '')

		var empty = await worker(() => undefined)(new Request('http://localhost/'))
		assert.equal(empty.status, 200, 'a falsy result becomes an empty 200')
		assert.equal(await empty.text(), '')
	})

	test('an error without a message still serializes', async (assert) => {
		var app = App()
		app.get('e', () => { throw new Error('') })
		var res = await send(worker(app), '/e')
		assert.equal(res.status, 500)
		assert.equal(await res.text(), '{"error":{}}')
	})

	test('headers set on req.resHeaders appear in the response', async (assert) => {
		var app = App()
		app.get('rh', (req) => { req.resHeaders['x-foo'] = 'bar'; return 'ok' })
		var res = await send(worker(app), '/rh')
		assert.equal(res.headers.get('x-foo'), 'bar')
		assert.equal(await res.text(), 'ok')
	})

	test('multiple set-cookie headers are preserved', async (assert) => {
		var app = App()
		app.get('rh', (req) => {
			req.resHeaders['set-cookie'] = 'a=1'
			req.resHeaders['Set-cookie'] = 'b=2'
			return { body: 'ok', headers: { 'set-cookie': 'c=3' } }
		})
		var res = await send(worker(app), '/rh')
		assert.equal(res.headers.getSetCookie(), ['a=1', 'b=2', 'c=3'])
		assert.equal(await res.text(), 'ok')
	})

	test('HEAD is routed to the GET handler with an empty body', async (assert) => {
		var app = App()
		app.get('hi', () => 'world')
		var res = await send(worker(app), '/hi', { method: 'HEAD' })
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-type'), 'text/plain', 'GET headers are preserved')
		assert.equal(await res.text(), '', 'body is stripped for HEAD')
	})

	test('a thrown request error maps to 400', async (assert) => {
		var app = App()
		app.get('x', () => 'ok')
		// A relative url makes `new URL(req.url)` throw inside the try block.
		var res = await worker(app)({ url: '/relative', method: 'GET', headers: new Headers() })
		assert.equal(res.status, 400)
		assert.equal(res.headers.get('content-type'), 'application/json')
	})

})
