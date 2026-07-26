
import '@litejs/cli/test.js'
import { App, Router } from '../app.mjs'

describe('app', () => {
	function createReq(pathname, method = 'GET') {
		var urlObj = new URL(pathname, 'http://localhost')
		urlObj.method = method
		urlObj.path = urlObj.pathname
		return urlObj
	}

	test('routing - HTTP methods', [
		['GET', 'get'],
		['POST', 'post'],
		['PUT', 'put'],
		['PATCH', 'patch'],
		['DELETE', 'del'],
	], async (method, alias, assert) => {
		var app = App()
		app[alias]('test', () => method + ' response')
		var result = await app(createReq('/test', method))
		assert.equal(result, method + ' response')
	})

	test('all() registers handler for every method', async (assert) => {
		var app = App()
		app.all('ping', () => 'pong')
		for (var method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
			assert.equal(await app(createReq('/ping', method)), 'pong', method + ' hits all() handler')
		}
	})

	test('method not allowed - 405', async (assert) => {
		var app = App()
		var req = createReq('/test', 'CONNECT')
		var result = await app(req)
		assert.equal(result, 405)
		assert.equal(req.resHeaders.Allow, 'DELETE, GET, PATCH, POST, PUT')
	})

	test('HEAD is routed to the GET handler', async (assert) => {
		var app = App()
		app.get('test', () => 'GET response')
		var result = await app(createReq('/test', 'HEAD'))
		assert.equal(result, 'GET response')
	})

	test('middleware and route parameters', async (assert) => {
		var app = App()
		var called = []
		app.use((req) => {
			called.push('middleware1')
		})
		.use((req) => {
			called.push('middleware2')
		})
		.get('user', (req) => {
			called.push('error')
		})
		.get('user/{userId+}', (req) => {
			called.push('handler')
			return { userId: req.param.userId }
		})
		var result = await app(createReq('/user/123', 'GET'))
		assert.equal(result.userId, '123')
		assert.equal(called.length, 3)
		assert.equal(called[0], 'middleware1')
		assert.equal(called[1], 'middleware2')
		assert.equal(called[2], 'handler')
	})

	test('custom method', async (assert) => {
		var app = App({
			method: {
				OPTIONS: 'options'
			}
		})
		app.options('test', () => 'options')
		var result = await app(createReq('/test', 'OPTIONS'))
		assert.equal(result, 'options')
	})

	test('missing route returns 404', async (assert) => {
		var app = App()
		app.get('known', () => 'ok')
		var result = await app(createReq('/missing', 'GET'))
		assert.equal(result, 404)
	})

	test('method with no routes 404s at root instead of matching empty alternation', async (assert) => {
		var app = App()
		app.use(() => {})
		app.get('test', () => 'ok')
		assert.equal(await app(createReq('/', 'POST')), 404)
		assert.equal(await app(createReq('/', 'DELETE')), 404)
	})

	test('mount: unimplemented method 404s at mount root, not just sub-paths', async (assert) => {
		var sub = App()
		sub.get('', () => 'sub root')
		var app = App()
		app.mount('api', sub)
		assert.equal(await app(createReq('/api', 'DELETE')), 404)
	})

	test('env forwarded to handlers', [
		[undefined, { defined: false, R2: undefined }],
		[{ R2: {} }, { defined: true, R2: true }],
	], async (env, expected, assert) => {
		var app = App()
		app.get('env', (req, env) => ({ defined: env !== undefined, R2: env?.R2 && true }))
		var result = await app(createReq('/env', 'GET'), env)
		assert.equal(result.defined, expected.defined)
		assert.equal(result.R2, expected.R2)
	})

	test('mount sub-app', async (assert) => {
		var sub = App()
		sub.get('', () => 'sub root')
		sub.get('{id+}', (req) => 'item ' + req.param.id)
		sub.put('{id+}', (req) => 'updated ' + req.param.id)
		sub.get('path/{id+}', (req) => req.path)

		var app = App()
		app.get('', () => 'home')
		app.mount('hi', sub)
		app.get('hih', 'app hih')

		var result = await app(createReq('/', 'GET'))
		assert.equal(result, 'home')

		result = await app(createReq('/hi', 'GET'))
		assert.equal(result, 'sub root')

		result = await app(createReq('/hi/123', 'GET'))
		assert.equal(result, 'item 123')

		result = await app(createReq('/hi/456', 'PUT'))
		assert.equal(result, 'updated 456')

		result = await app(createReq('/hi/unknown', 'GET'))
		assert.equal(result, 404)

		result = await app(createReq('/hih', 'GET'))
		assert.equal(result, 'app hih')

		result = await app(createReq('/hi/path/42', 'GET'))
		assert.equal(result, '/path/42', 'req.path inside sub is prefix-stripped')
	})

	test('req.route reflects deepest matched pattern through mounts', async (assert) => {
		var inner = App()
		inner.get('info/{id+}', (req) => req.route)

		var app = App()
		app.get('home', (req) => req.route)
		app.mount('api', inner)

		assert.equal(await app(createReq('/home', 'GET')), 'home', 'top-level route pattern')
		assert.equal(await app(createReq('/api/info/42', 'GET')), 'info/{id+}', 'inner route pattern, not mount prefix')
	})

	test('sub-app middleware scoped to mount prefix only', async (assert) => {
		var sub = App()
		var mwHits = 0
		sub.use(() => { mwHits++ })
		sub.get('hi', () => 'rel')

		var app = App()
		app.get('', () => 'root')
		app.mount('sub', sub)

		assert.equal(await app(createReq('/', 'GET')), 'root', 'parent root unaffected')
		assert.equal(await app(createReq('/sub/hi', 'GET')), 'rel')
		assert.equal(mwHits, 1, 'middleware ran for /sub/hi')
		assert.equal(await app(createReq('/sub/nope', 'GET')), 404, 'no leak to nonexistent sub paths')
		assert.equal(await app(createReq('/elsewhere', 'GET')), 404, 'no leak outside prefix')
		assert.equal(mwHits, 1, 'middleware does not run for paths the sub-app 404s on')
	})

	test("nested mounts scope under each parent's prefix", async (assert) => {
		var inner = App()
		inner.get('', () => 'inner root')
		inner.get('info', () => 'inner info')

		var mid = App()
		mid.get('', () => 'mid root')
		mid.mount('hi', inner)

		var app = App()
		app.mount('api', mid)

		assert.equal(await app(createReq('/api', 'GET')), 'mid root')
		assert.equal(await app(createReq('/api/hi', 'GET')), 'inner root')
		assert.equal(await app(createReq('/api/hi/info', 'GET')), 'inner info')
		assert.equal(await app(createReq('/hi/info', 'GET')), 404, 'nested mount NOT reachable at top-level root')
	})

})

describe('router', () => {
	function createReq(url, method = 'GET') {
		var urlObj = new URL(url, 'http://localhost')
		var req = new Request(urlObj, { method })
		req.path = decodeURI(urlObj.pathname)
		return req
	}

	var r = Router()
	var routes = [
		'home',
		'user/{userId+}',
		'blog/{year}/{month}',
		'file/{file.name*}',
		'pub/test.sh',
		'pub/\\{ignored}',
		'a/{path/}{name}',
		'about/*',
		'user/{userId+}-post',
		'user/pre-{userId+}',
	]
	routes.forEach((route, index) => {
		r.add(route, (req) => ({ index, param: req.param }))
	})

	test('-> {0}', [
		['', -1, {}],
		['home', 0, {}],
		['home/', 0, {}],
		['hom', -1, {}],
		['homee', -1, {}],
		['home/e', -1, {}],
		['user/123', 1, { userId: '123' }],
		['user/123/', 1, { userId: '123' }],
		['user/123/edit', -1, {}],
		['user/1-post', 8, { userId: '1' }],
		['user/pre-12345', 9, { userId: '12345' }],
		['user/edit', -1, {}],
		['blog/2025/12', 2, { year: '2025', month: '12' }],
		['file/', 3, { 'file.name': '' }],
		['file/report.pdf', 3, { 'file.name': 'report.pdf' }],
		['file/sub/report.pdf', 3, { 'file.name': 'sub/report.pdf' }],
		['pub/test.sh', 4, {}],
		['pub/test,sh', -1, {}],
		['pub/{ignored}', 5, {}],
		['a/b.txt', 6, {path:'', name: 'b.txt'}],
		['a/nésted/file.txt', 6, {path:'nésted/', name: 'file.txt'}],
		['a/nested/more/file.txt', 6, {path:'nested/more/', name: 'file.txt'}],
		['about', -1, {}],
		['about/*', 7, {}],
		['about/a', -1, {}],

	], async (url, expectedIndex, expectedParam, assert) => {
		var result = await r.handle(createReq(url))
		var actualIndex = result?.index ?? -1
		var actualParam = result?.param ?? {}
		assert
		.equal(actualIndex, expectedIndex)
		.equal(actualParam, expectedParam)
	})

	test('handler result is returned verbatim; the worker shapes it', [
		[() => 'sync', 'sync'],
		[async () => 'async', 'async'],
		['literal-value', 'literal-value'],
		[() => ({ a: 1 }), { a: 1 }],
		[() => [1, 2], [1, 2]],
		[() => ({ body: 'created', status: 201 }), { body: 'created', status: 201 }],
	], async (handler, expected, assert) => {
		var r2 = Router()
		r2.add('test', handler)
		assert.equal(await r2.handle(createReq('test')), expected)
	})

	test('middleware with sync and async', async (assert) => {
		var r2 = Router()
		var called = []
		r2.use((req) => {
			called.push('middleware1')
		})
		r2.use(async (req) => {
			called.push('middleware2')
		})
		r2.add('test', (req) => {
			called.push('handler')
			return 'ok'
		})
		var result = await r2.handle(createReq('test'))
		assert.equal(result, 'ok')
		assert.equal(called.length, 3)
		assert.equal(called[0], 'middleware1')
		assert.equal(called[1], 'middleware2')
		assert.equal(called[2], 'handler')
	})

	test('errors propagate to the caller; the worker maps them', [
		[r => r.add('e', () => { throw new Error('sync') }), undefined],
		[r => r.add('e', async () => { throw new Error('async') }), undefined],
		[r => { r.use(async () => { throw new Error('mw') }); r.add('e', () => 'ok') }, undefined],
		[r => r.add('e', () => { var er = new Error('gone'); er.code = 410; throw er }), 410],
	], async (setup, expectedCode, assert) => {
		var r2 = Router()
		setup(r2)
		var err = await r2.handle(createReq('e')).then(() => null, e => e)
		assert.ok(err instanceof Error, 'router rethrows instead of swallowing')
		assert.equal(err.code, expectedCode, 'e.code is preserved for the worker to map')
	})

	test('falsy or pathless request returns 404', [null, {}], async (req, assert) => {
		var r2 = Router()
		r2.add('test', () => 'found')
		assert.equal(await r2.handle(req), 404)
	})

	test('middleware that returns nothing yields an undefined result', async (assert) => {
		var r2 = Router()
		var called = false
		r2.use(() => { called = true })
		r2.add('', () => {})
		var result = await r2.handle({ path: '/' })
		assert.equal(called, true)
		assert.equal(result, undefined)
	})

	test('middleware short-circuits when returning a value', async (assert) => {
		var r2 = Router()
		var called = []
		r2.use(() => { called.push('a'); return { error: 'denied' } })
		r2.use(() => { called.push('b') })
		r2.add('test', () => { called.push('handler'); return 'ok' })
		var result = await r2.handle({ path: '/test' })
		assert.equal(called, ['a'])
		assert.equal(result, { error: 'denied' })
	})

	test('notFound option', async (assert) => {
		var r2 = Router({ notFound: () => ({ body: 'custom 404', status: 404 }) })
		r2.add('test', () => 'ok')
		var result = await r2.handle({ path: '/missing' })
		assert.equal(result.body, 'custom 404')
		assert.equal(result.status, 404)
	})
})
