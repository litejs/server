
import '@litejs/cli/test.js'
import { worker } from '../lib/worker.mjs'

describe('worker adapter', () => {
	function send(handler, path, opts, env) {
		return worker(handler)(new Request('http://localhost' + path, opts), env)
	}

	test('normalizes a handler result to a {1} Response with body {2}', [
		[() => ({ body: 'plain' }), 200, 'plain', 'text/plain'],
		[() => ({ body: { a: 1 } }), 200, '{"a":1}', 'application/json'],
		[() => 204, 204, '', null], // a number becomes a bare status
		[() => undefined, 200, '', null], // a falsy result becomes an empty 200
		[() => 100, 500, '', null], // an out-of-range status falls back to 500
		// app handlers may return e.g. `status: err.code` where code is a string.
		[() => ({ body: 'x', status: 'ENOENT' }), 500, 'x', 'text/plain'],
	], async (handler, expectedStatus, expectedBody, expectedType, assert) => {
		var res = await send(handler, '/')
		assert.ok(res instanceof Response)
		assert.equal(res.status, expectedStatus)
		assert.equal(await res.text(), expectedBody)
		assert.equal(res.headers.get('content-type'), expectedType)
	})

	test('full response object sets status, body and headers', async (assert) => {
		var res = await send(() => ({ body: '<p>hi</p>', status: 201, headers: { 'content-type': 'text/html' } }), '/')
		assert.equal(res.status, 201)
		assert.equal(await res.text(), '<p>hi</p>')
		assert.equal(res.headers.get('content-type'), 'text/html', 'handler content-type is not overridden')
	})

	test('a returned Response is passed through unchanged', async (assert) => {
		var res = await send(() => new Response('raw body', { status: 207 }), '/')
		assert.equal(res.status, 207)
		assert.equal(await res.text(), 'raw body')
	})

	test('a stream body is passed through without serialization', async (assert) => {
		var res = await send(() => ({ body: new Blob(['streamed']).stream() }), '/')
		assert.equal(await res.text(), 'streamed')
		assert.equal(res.headers.get('content-type'), null, 'no content-type is forced')
	})

	test('request is patched with path, query, origin, header and searchParams', async (assert) => {
		var res = await send(req => ({ body: {
			path: req.path,
			fullPath: req.fullPath,
			query: req.query,
			origin: req.origin,
			x: req.searchParams.get('x'),
			h: req.header('x-test'),
		} }), '/q?x=1&y=2', { headers: { 'x-test': 'value' } })
		assert.equal(await res.json(), {
			path: '/q',
			fullPath: '/q',
			query: 'x=1&y=2',
			origin: 'http://localhost',
			x: '1',
			h: 'value',
		})
	})

	test('env merges defaults with per-request env, request wins', async (assert) => {
		var w = worker((req, env) => ({ body: env.A + ',' + env.B }), { A: 'default', B: 'def' })
		var res = await w(new Request('http://localhost/'), { B: 'override' })
		assert.equal(await res.text(), 'default,override')
	})

	test('a thrown error maps to a generic, logged 500', async (assert, mock) => {
		mock.swap(console, 'error', mock.fn())
		var res = await send(() => { throw new Error('nope') }, '/')
		assert.equal(res.status, 500)
		assert.equal(await res.text(), '{"error":"Internal Server Error"}', 'internal message is not leaked')
		assert.equal(res.headers.get('content-type'), 'application/json')
		assert.equal(console.error.called, 1, 'error is logged server-side')
	})

	test('a thrown error with a code maps to that status and exposes its message', async (assert) => {
		var res = await send(() => { var e = new Error('gone'); e.code = 410; throw e }, '/')
		assert.equal(res.status, 410)
		assert.equal(await res.text(), '{"error":"gone"}', 'an intentional 4xx exposes its message')
	})

	test('a 5xx error body is generic and logged server-side', async (assert, mock) => {
		mock.swap(console, 'error', mock.fn())
		var res = await send(() => ({ body: new Error('secret'), status: 503 }), '/')
		assert.equal(res.status, 503)
		assert.equal(await res.text(), '{"error":"Internal Server Error"}', 'internal message is not leaked')
		assert.equal(res.headers.get('content-type'), 'application/json')
		assert.equal(console.error.called, 1, 'error is logged server-side')
	})

	test('an error without stack or message falls back to the error itself', async (assert, mock) => {
		mock.swap(console, 'error', mock.fn())
		var err = new Error('')
		err.stack = ''
		var res = await send(() => ({ body: err, status: 503 }), '/')
		assert.equal(await res.text(), '{"error":"Internal Server Error"}')
		assert.equal(console.error.calls[0].args[0], err, 'the error itself is logged when stack is empty')

		err.code = 422
		res = await send(() => { throw err }, '/')
		assert.equal(res.status, 422)
		assert.equal(await res.text(), '{"error":{"code":422}}', 'a messageless 4xx error serializes the error itself')
	})

	test('req.resHeaders and handler headers merge, set-cookie appends', async (assert) => {
		var res = await send(req => {
			req.resHeaders['x-foo'] = 'bar'
			req.resHeaders['set-cookie'] = 'a=1'
			req.resHeaders['Set-cookie'] = 'b=2'
			return { body: 'ok', headers: { 'set-cookie': 'c=3' } }
		}, '/')
		assert.equal(res.headers.get('x-foo'), 'bar')
		assert.equal(res.headers.getSetCookie(), ['a=1', 'b=2', 'c=3'])
		assert.equal(await res.text(), 'ok')
	})

	test('HEAD strips the response body but keeps status and headers', async (assert) => {
		var res = await send(() => ({ body: 'world' }), '/', { method: 'HEAD' })
		assert.equal(res.status, 200)
		assert.equal(res.headers.get('content-type'), 'text/plain', 'headers are preserved')
		assert.equal(await res.text(), '', 'body is stripped for HEAD')
	})
})
