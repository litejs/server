
import '@litejs/cli/test.js'
import { dedupe } from '../index.mjs'

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

