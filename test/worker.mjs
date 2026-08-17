
import '@litejs/cli/test.js'
import { App } from '../index.mjs'
import { worker } from '../lib/worker.mjs'

describe('worker adapter', () => {
	function send(handler, path, opts, env) {
		return worker(handler)(new Request('http://localhost' + path, opts), env)
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

	test('a string is sent as the body; the worker forces no content-type', async (assert) => {
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
		await worker((req, env, c) => (seen = c, 204))(new Request('http://localhost/'), {}, ctx)
		assert.strictEqual(seen, ctx)
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

	test('request is patched with path, query, origin, header and searchParams', async (assert) => {
		var res = await send(req => ({
			path: req.path,
			fullPath: req.fullPath,
			query: req.query,
			origin: req.origin,
			x: req.searchParams.get('x'),
			h: req.header('x-test'),
		}), '/q?x=1&y=2', { headers: { 'x-test': 'value' } })
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
		var w = worker((req, env) => env.A + ',' + env.B, { A: 'default', B: 'def' })
		var res = await w(new Request('http://localhost/'), { B: 'override' })
		assert.equal(await res.text(), 'default,override')
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


describe('worker integration', () => {
	var app = App()
	, menu = App()
	, server = worker(app)
	, handler = req => [req.fullPath, req.path, req.param]

	app.get('hi', handler)
	app.get('menü', handler)

	app.mount('menu', menu)

	menu.get('{order}', handler)

	test('encoding {i}', [
		[ '/hi', ['/hi', '/hi', {}] ],
		[ '/men%C3%BC', ['/menü', '/men%C3%BC', {}] ],
		[ '/menu/caf%C3%A9', ['/menu/café', '/caf%C3%A9', { order: 'café' }] ],
		[ '/menu/a%2Fb', ['/menu/a%2Fb', '/a%2Fb', { order: 'a/b' }] ],
		[ '/menu/a%252Fb', ['/menu/a%2Fb', '/a%252Fb', { order: 'a%2Fb' }] ],
	], async (url, expected, assert) => {
		var res = await server(new Request('http://localhost' + url))
		assert.equal(await res.json(), expected)
	})

})

