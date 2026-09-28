
import '@litejs/cli/test.js'
import { dedupe, sharedKV } from '../index.mjs'

describe('dedupe', () => {
	// A gate lets a handler park mid-flight until the test opens it, so the
	// in-flight coalescing window is deterministic instead of timer-based.
	function gate() {
		var open
		var promise = new Promise(res => { open = res })
		return { promise, open }
	}

	function req(path, extra) {
		return { path, resHeaders: {}, ...extra }
	}

	test('coalesces concurrent requests for the same key', async assert => {
		var calls = 0
		var g = gate()
		var wrapped = dedupe(async r => {
			calls++
			await g.promise
			r.resStatus = 201
			r.resHeaders.foo = 'bar'
			return { path: r.path, n: calls }
		})
		var rs = [req('/report'), req('/report'), req('/report')]
		var pending = rs.map(r => wrapped(r, {}, {}))
		g.open()
		var out = await Promise.all(pending)
		assert.equal(calls, 1, 'handler ran exactly once')
		assert.equal(out, [
			{ path: '/report', n: 1 },
			{ path: '/report', n: 1 },
			{ path: '/report', n: 1 },
		], 'every waiter got the same result')
		assert.equal(rs.map(r => r.resStatus), [201, 201, 201], 'status replayed onto every req')
		assert.equal(rs.map(r => r.resHeaders.foo), ['bar', 'bar', 'bar'], 'headers replayed onto every req')
	})

	test('evicts on settle so a later call is a fresh flight', async assert => {
		var calls = 0
		var wrapped = dedupe(async () => ++calls)
		await wrapped(req('/x'), {}, {})
		await wrapped(req('/x'), {}, {})
		assert.equal(calls, 2, 'no caching across settled flights')
	})

	test('different keys run independently', async assert => {
		var calls = 0
		var g = gate()
		var wrapped = dedupe(async () => (calls++, await g.promise, 1))
		var pending = [wrapped(req('/a'), {}, {}), wrapped(req('/b'), {}, {})]
		g.open()
		await Promise.all(pending)
		assert.equal(calls, 2)
	})

	test('default key (path) collapses query; url override keeps it separate', async assert => {
		var byPath = 0, byUrl = 0
		var g = gate()
		var wPath = dedupe(async () => (byPath++, await g.promise, 1))
		var wUrl = dedupe(async () => (byUrl++, await g.promise, 1), 'url')
		var pending = [
			wPath(req('/r', { url: '/r?id=1' }), {}, {}),
			wPath(req('/r', { url: '/r?id=2' }), {}, {}),
			wUrl(req('/r', { url: '/r?id=1' }), {}, {}),
			wUrl(req('/r', { url: '/r?id=2' }), {}, {}),
		]
		g.open()
		await Promise.all(pending)
		assert.equal(byPath, 1, 'path key coalesces different query (documented footgun)')
		assert.equal(byUrl, 2, 'url key splits by query')
	})

	test('Response results are cloned so each waiter can read the body', async assert => {
		var g = gate()
		var wrapped = dedupe(async () => (await g.promise, new Response('shared')))
		var pending = [req('/res'), req('/res')].map(r => wrapped(r, {}, {}))
		g.open()
		var [a, b] = await Promise.all(pending)
		assert.ok(a !== b, 'each waiter got its own clone')
		assert.equal(await a.text(), 'shared')
		assert.equal(await b.text(), 'shared')
	})

	test('failure is shared by every waiter, then freed for retry', async assert => {
		var calls = 0
		var g = gate()
		var boom = dedupe(async () => {
			calls++
			await g.promise
			throw new Error('boom-' + calls)
		})
		var pending = [req('/x'), req('/x'), req('/x')]
			.map(r => boom(r, {}, {}).then(() => 'ok', e => e.message))
		g.open()
		assert.equal(await Promise.all(pending), ['boom-1', 'boom-1', 'boom-1'], 'all waiters share one rejection')
		assert.equal(calls, 1, 'handler ran once despite the failure')
		// gate already open: the retry runs to completion immediately
		await boom(req('/x'), {}, {}).catch(() => {})
		assert.equal(calls, 2, 'evicted after failure, retried fresh')
	})
})


describe('sharedKV', () => {
	function mockKV(data) {
		var kv = {
			gets: 0,
			puts: [],
			get: async key => (kv.gets++, key === 'fail' ? Promise.reject('boom') : data[key] ?? null),
			put: async (key, val, opts) => { kv.puts.push([key, val, opts]) }
		}
		return kv
	}

	function req() {
		var fns = []
		return { defer: fn => fns.push(fn), end: () => Promise.all(fns.map(fn => fn('res'))) }
	}

	test('concurrent requests share one read and the last one writes', async assert => {
		var kv = mockKV({ a: '{"n":1}' })
		var get = sharedKV(kv, { expirationTtl: 60 }, undefined, 0)
		var r1 = req(), r2 = req()
		var [a, b] = await Promise.all([get(r1, 'a'), get(r2, 'a')])
		assert.ok(a === b, 'same object for both')
		assert.equal(kv.gets, 1)
		a.n++
		await r1.end()
		assert.equal(kv.puts.length, 0, 'not written while a request is pending')
		await r2.end()
		assert.equal(kv.puts, [['a', '{"n":2}', { expirationTtl: 60 }]])
	})

	test('unchanged value is not written and a later call reads again', async assert => {
		var kv = mockKV({ a: '{"n":1}' })
		var get = sharedKV(kv, undefined, undefined, 0)
		var r1 = req()
		var a = await get(r1, 'a')
		await r1.end()
		assert.equal(kv.puts.length, 0)
		var r2 = req()
		assert.ok(await get(r2, 'a') !== a, 'fresh object after the batch ended')
		assert.equal(kv.gets, 2)
	})

	test('missing, corrupt and non-object values fall back to {}', async assert => {
		var kv = mockKV({ bad: '{"n":', num: '1', nul: 'null' })
		var get = sharedKV(kv, undefined, undefined, 0)
		var rs = ['missing', 'bad', 'num', 'nul'].map(key => [key, req()])
		var vals = await Promise.all(rs.map(([key, r]) => get(r, key)))
		assert.equal(vals, [{}, {}, {}, {}])
		await Promise.all(rs.map(([, r]) => r.end()))
		assert.equal(kv.puts.length, 0, 'not written when untouched')
		var r = req()
		;(await get(r, 'bad')).n = 1
		await r.end()
		assert.equal(kv.puts, [['bad', '{"n":1}', undefined]], 'replaced once changed')
	})

	test('failed read is shared, then freed for retry', async assert => {
		var kv = mockKV({})
		var get = sharedKV(kv, undefined, undefined, 0)
		var out = await Promise.all([get(req(), 'fail'), get(req(), 'fail')].map(p => p.catch(e => e.message)))
		assert.equal(out, ['boom', 'boom'])
		assert.equal(kv.gets, 1)
		await get(req(), 'fail').catch(() => {})
		assert.equal(kv.gets, 2, 'retried after the failure')
	})

	test('a record stays cached after its last request, so one soon after shares it', async assert => {
		var kv = mockKV({ a: '{"n":1}' })
		var get = sharedKV(kv, undefined, undefined, 20)
		var r1 = req()
		var a = await get(r1, 'a')
		var ended = r1.end()
		await new Promise(r => setTimeout(r, 5))
		var r2 = req()
		assert.ok(await get(r2, 'a') === a, 'the same record, not read again')
		assert.equal(kv.gets, 1)
		await Promise.all([ended, r2.end()])
		await get(req(), 'a')
		assert.equal(kv.gets, 2, 'read again once it sat unused for cache ms')
	})

	test('a change made while a record stays cached is written when its request ends', async assert => {
		var kv = mockKV({ a: '{"n":1}' })
		var get = sharedKV(kv, undefined, undefined, 100)
		var r1 = req(), r2 = req()
		await get(r1, 'a')
		var ended = r1.end()
		await new Promise(r => setTimeout(r, 5))
		;(await get(r2, 'a')).n = 2
		r2.end()
		await new Promise(r => setTimeout(r, 5))
		assert.equal(kv.puts, [['a', '{"n":2}', undefined]], 'not once the record would be dropped')
		await ended
	})

	// A put that waits for the test, as a store write that lands after the response would
	function slowKV(data) {
		var kv = mockKV(data)
		kv.put = (key, val) => new Promise(done => kv.land = () => (kv.puts.push([key, val]), done()))
		return kv
	}

	test('a request during the write shares the record instead of reading the store', async assert => {
		var kv = slowKV({ a: '{"n":1}' })
		var get = sharedKV(kv, undefined, undefined, 0)
		var r1 = req(), r2 = req()
		;(await get(r1, 'a')).n = 2
		var written = r1.end()
		var b = await get(r2, 'a')
		assert.equal(b.n, 2, 'the value being written, not the stored one')
		assert.equal(kv.gets, 1)
		kv.land()
		await written
		await r2.end()
		assert.equal(kv.puts, [['a', '{"n":2}']])
		await get(req(), 'a')
		assert.equal(kv.gets, 2, 'read again once the write landed and nothing held it')
	})

	test('a change made during the write is written after it', async assert => {
		var kv = slowKV({ a: '{"n":1}' })
		var get = sharedKV(kv, undefined, undefined, 0)
		var r1 = req(), r2 = req()
		;(await get(r1, 'a')).n = 2
		var written = r1.end()
		;(await get(r2, 'a')).n = 3
		await r2.end()
		assert.equal(kv.puts, [], 'no second write while the first is in flight')
		kv.land()
		await new Promise(r => setTimeout(r, 0))
		kv.land()
		await written
		assert.equal(kv.puts, [['a', '{"n":2}'], ['a', '{"n":3}']])
	})

	test('a failed write is tried once more a second later', async (assert, mock) => {
		var kv = mockKV({ a: '{"n":1}' })
		var delays = []
		var fails = 1
		var get = sharedKV(kv, undefined, undefined, 0)
		var r = req()
		mock.swap(globalThis, 'setTimeout', (fn, ms) => (delays.push(ms), fn()))
		kv.put = async (key, val) => { if (fails--) throw Error('429'); kv.puts.push([key, val]) }
		;(await get(r, 'a')).n = 2
		await r.end()
		assert.equal(delays, [1000, 0], 'then it stays cached')
		assert.equal(kv.puts, [['a', '{"n":2}']])
	})
})
