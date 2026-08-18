
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
		['HEAD', 'head'],
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
		for (var method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
			assert.equal(await app(createReq('/ping', method)), 'pong', method + ' hits all() handler')
		}
	})

	test('method not allowed lists methods matching the requested path', async (assert) => {
		var app = App()
		app.get('test', () => 'get')
		app.post('test', () => 'post')
		app.put('other', () => 'put')
		var req = createReq('/test', 'CONNECT')
		var result = await app(req)
		assert.equal(result, 405)
		assert.equal(req.resHeaders.Allow, 'GET, HEAD, POST')
	})

	test('configured method without a matching route returns 405', async (assert) => {
		var app = App()
		app.get('test', () => 'get')
		var req = createReq('/test', 'POST')

		assert.equal(await app(req), 405)
		assert.equal(req.resHeaders.Allow, 'GET, HEAD')
	})

	test('fallback handlers receive route details, env, and ctx', async (assert) => {
		var notAllowed
		, notFound
		, env = {}
		, ctx = {}
		, app = App({ notAllowed(req, actualEnv, actualCtx) {
			notAllowed = [req.resHeaders.Allow, actualEnv, actualCtx]
			return 418
		}, notFound(req, actualEnv, actualCtx) {
			notFound = [req.path, actualEnv, actualCtx]
			return 410
		} })
		app.patch('known', () => 'patch')

		assert.equal(await app(createReq('/known', 'CONNECT'), env, ctx), 418)
		assert.equal(notAllowed[0], 'PATCH')
		assert.strictEqual(notAllowed[1], env)
		assert.strictEqual(notAllowed[2], ctx)

		var missingReq = createReq('/missing', 'CONNECT')
		assert.equal(await app(missingReq, env, ctx), 410)
		assert.equal(missingReq.resHeaders, undefined)
		assert.equal(notFound[0], '/missing')
		assert.strictEqual(notFound[1], env)
		assert.strictEqual(notFound[2], ctx)
	})

	test('HEAD uses an explicit route or falls back to GET', async (assert) => {
		var app = App()
		, calls = 0
		app.use(() => { calls++ })
		app.get('fallback', () => 'GET fallback')
		app.get('test', () => 'GET response')
		app.head('test', () => 'HEAD response')

		assert.equal(await app(createReq('/fallback', 'HEAD')), 'GET fallback')
		assert.equal(await app(createReq('/test', 'HEAD')), 'HEAD response')
		assert.equal(calls, 2)
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

	test('mount inherits custom methods and applies parent middleware', async (assert) => {
		var calls = 0
		, blocked = false
		, sub = App({ method: { OPTIONS: 'options' } })
		, app = App()

		sub.options('', () => 'sub options')
		app.use(() => (calls++, blocked && 'blocked'))
		app.mount('api', sub)

		assert.equal(await app(createReq('/api', 'OPTIONS')), 'sub options')
		blocked = true
		assert.equal(await app(createReq('/api', 'OPTIONS')), 'blocked')
		assert.equal(calls, 2)
	})

	test('null omits local methods while mounts can re-enable routing', async (assert) => {
		var app = App({ method: { GET: null } })
		, calls = 0
		app.head('head', () => 'head')
		app.all('all', () => 'all')

		assert.equal(app.get, undefined)
		assert.equal(app.routers.GET, undefined)
		assert.equal(await app(createReq('/head', 'HEAD')), 'head')

		var req = createReq('/head', 'GET')
		assert.equal(await app(req), 405)
		assert.equal(req.resHeaders.Allow, 'HEAD')

		req = createReq('/all', 'GET')
		assert.equal(await app(req), 405)
		assert.equal(req.resHeaders.Allow, 'DELETE, HEAD, PATCH, POST, PUT')

		var sub = App()
		sub.get('', () => 'sub get')
		app.use(() => { calls++ })
		app.mount('api', sub)
		assert.equal(app.get, undefined, 'mount does not restore the local alias')
		assert.ok(app.routers.GET, 'mount creates the router required by the sub-app')
		assert.equal(await app(createReq('/api', 'GET')), 'sub get')
		assert.equal(calls, 1)

		app = App({ method: { HEAD: null } })
		app.get('get', () => 'get')
		assert.equal(app.head, undefined)
		assert.equal(await app(createReq('/get', 'HEAD')), 'get', 'HEAD still falls back to GET')
	})

	test('missing routes return 404', async (assert) => {
		var app = App()
		app.use(() => {})
		app.get('known', () => 'ok')

		assert.equal(await app(createReq('/missing', 'GET')), 404)
		assert.equal(await app(createReq('/', 'POST')), 404)
		assert.equal(await app(createReq('/', 'DELETE')), 404)
	})

	test('mount: unimplemented method returns 405 at the mount root', async (assert) => {
		var sub = App()
		sub.get('', () => 'sub root')
		var app = App()
		app.mount('api', sub)
		var req = createReq('/api', 'DELETE')
		assert.equal(await app(req), 405)
		assert.equal(req.resHeaders.Allow, 'GET, HEAD')
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
		assert.strictEqual(app.mount('hi', sub), app, 'mount returns the app for chaining')
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

	test('mount at root preserves the leading slash', async (assert) => {
		var sub = App()
		sub.get('', req => req.path)
		sub.get('path/{id+}', req => req.path)

		var app = App()
		app.mount('', sub)

		assert.equal(await app(createReq('/', 'GET')), '/')
		assert.equal(await app(createReq('/path/42', 'GET')), '/path/42')
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
		req.path = urlObj.pathname
		return req
	}
	async function handle(router, req, env, ctx) {
		var matched = router.match(req)
		return matched && router.handle(req, env, ctx, matched)
	}

	var r = Router({
		'*': '(.*)',
		'+': '(\\d+)',
		'/': '((?:[^/]+\\/)*)',
	})
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

	test('match treats a missing path as empty', async (assert) => {
		assert.equal(r.match({}), null)
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
		var result = await handle(r, createReq(url))
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
		[() => ({ body: 'created', status: 201 }), { body: 'created', status: 201 }],
	], async (handler, expected, assert) => {
		var r2 = Router()
		r2.add('test', handler)
		assert.equal(await handle(r2, createReq('test')), expected)
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
		})
		var result = await handle(r2, createReq('test'))
		assert.equal(result, undefined)
		assert.equal(called.length, 3)
		assert.equal(called[0], 'middleware1')
		assert.equal(called[1], 'middleware2')
		assert.equal(called[2], 'handler')
	})

	test('errors propagate to the caller; the worker maps them', [
		[r => r.add('e', async () => { throw new Error('async') }), undefined],
		[r => { r.use(async () => { throw new Error('mw') }); r.add('e', () => 'ok') }, undefined],
		[r => r.add('e', () => { var er = new Error('gone'); er.code = 410; throw er }), 410],
	], async (setup, expectedCode, assert) => {
		var r2 = Router()
		setup(r2)
		var err = await handle(r2, createReq('e')).then(() => null, e => e)
		assert.ok(err instanceof Error, 'router rethrows instead of swallowing')
		assert.equal(err.code, expectedCode, 'e.code is preserved for the worker to map')
	})

	test('middleware short-circuits when returning a value', async (assert) => {
		var r2 = Router()
		var called = []
		r2.use(() => { called.push('a'); return { error: 'denied' } })
		r2.use(() => { called.push('b') })
		r2.add('test', () => { called.push('handler'); return 'ok' })
		var result = await handle(r2, { path: '/test' })
		assert.equal(called, ['a'])
		assert.equal(result, { error: 'denied' })
	})
})
