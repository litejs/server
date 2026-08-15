// Test responses from deployed demo server
// TEST_URL=http://127.0.0.1:8080 TEST_RUNTIME=dev node demo/test/smoke.mjs
//
// TEST_RUNTIME is what info.mjs was stamped with — 'dev' until the deploy
// workflow rewrites it with the target name.

import '@litejs/cli/test.js'

var base = process.env.TEST_URL
, runtime = process.env.TEST_RUNTIME
, get = (path, opts) => fetch(base + path, opts)

if (!base) throw new Error('TEST_URL is required')

describe.conf.timeout = +process.env.DEMO_TIMEOUT || 15000

// Trailing slashes would double up against every route below.
base = base.replace(/\/+$/, '')

describe('smoke ' + base, () => {

	test('GET / serves the demo page', async assert => {
		var res = await get('/')
		, html = await res.text()
		assert.equal(res.status, 200, 'status')
		assert.ok(/^text\/html\b/.test(res.headers.get('content-type')), 'content-type is html')
		assert.ok(html.includes('LiteJS'), 'body names the project')
	})

	test('GET /info reports the runtime', async assert => {
		var info = await (await get('/info?a=1')).json()
		assert.equal(info.path, '/info', 'path')
		assert.equal(info.fullPath, '/info', 'fullPath')
		assert.equal(info.query, 'a=1', 'query')
		assert.equal(info.method, 'GET', 'method')
		// Only asserted when the caller says which target this should be.
		if (runtime) assert.equal(info.runtime, runtime, 'runtime')
	})

	test('GET /hello/{name} reads a route param', async assert => {
		assert.equal(await (await get('/hello/moon')).text(), 'Hello moon', 'plain')
		// Params arrive decoded, the raw path does not.
		assert.equal(await (await get('/hello/a%20b')).text(), 'Hello a b', 'percent-encoded')
	})

	test('POST /echo round-trips the body', async assert => {
		var body = 'echo-' + Math.random().toString(36).slice(2)
		, res = await get('/echo', { method: 'POST', body })
		assert.equal(res.status, 200, 'status')
		assert.equal((await res.json()).echo, body, 'body')
	})

	test('GET /teapot sets the status from the handler', async assert => {
		var res = await get('/teapot')
		assert.equal(res.status, 418, 'status')
		assert.equal(await res.text(), 'no coffee', 'body')
	})

	test('GET /nowhere is a 404', async assert => {
		assert.equal((await get('/nowhere')).status, 404, 'status')
	})

	test('HEAD /info has no body', async assert => {
		var res = await get('/info', { method: 'HEAD' })
		assert.equal(res.status, 200, 'status')
		assert.equal(await res.text(), '', 'body is empty')
	})

	test('GET //info does not keep the double slash', async assert => {
		var res = await get('//info', { redirect: 'manual' })
		// worker() answers 301 to the collapsed path.
		// Some edges collapse it to 200, or their own 308 instead of the 301.
		assert.ok([ 200, 301, 308 ].includes(res.status), 'status is 200, 301 or 308, got ' + res.status)
		// Relative here, absolute from some edges — only the path is the point.
		if (res.status !== 200) {
			assert.equal(new URL(res.headers.get('location'), base).pathname, '/info', 'location')
		}
	})
})

