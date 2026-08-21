
import '@litejs/cli/test.js'
import { on, one, off, emit, listen, unlisten } from '../event.mjs'
import { Data } from '../util.mjs'

describe('events', () => {

	test('emit is async and walks the prototype chain with its arguments and scope', async assert => {
		var parent = Data({ name: 'parent' })
		, child = Data({ name: 'child' }, parent)
		, scope = Data({ name: 'scope' })
		, calls = []
		, pending
		on(child, 'change', function(...args) { calls.push([this.name, ...args]) }, 0)
		on(parent, 'change', function(...args) { calls.push([this.name, ...args]) })
		on(child, 'scoped', function() { calls.push([this.name]) }, scope)
		pending = emit(child, 'change', null, 0, '', false)
		assert
		.equal(calls, [], 'listeners wait for a microtask')
		.equal(await pending, 2)
		.equal(calls, [
			['child', null, 0, '', false],
			['child', null, 0, '', false],
		])
		.equal(await emit(child, 'scoped'), 1)
		.equal(calls.at(-1), ['scope'])
	})

	test('objects and functions can participate, primitives and invalid inputs cannot', async assert => {
		class Host {}
		var host = new Host()
		, emitter = value => value
		, owner = () => {}
		, fn = value => calls.push(value)
		, calls = []
		emitter.route = 'GET'
		on(host, 'host', fn)
		on(emitter, 'function', fn)
		listen(owner, host, 'owned', fn)
		assert
		.ok(!on(null, 'x', fn))
		.ok(!on(5, 'x', fn))
		.ok(!on(host, '', fn))
		.ok(!on(host, 'bad', null))
		.ok(!one(host, 'bad', 0))
		.ok(!listen(5, host, 'x', fn))
		.ok(!listen({}, null, 'x', fn))
		.strictEqual(unlisten(0), undefined)
		.equal([
			await emit(host, 'host', 1),
			await emit(emitter, 'function', 2),
			await emit(host, 'owned', 3),
		], [1, 1, 1])
		.equal(calls, [1, 2, 3])
		.equal([await emit(null, 'x'), await emit(5, 'x'), await emit(host, ''), await emit(host, 'bad')], [0, 0, 0, 0])
		.equal(emitter('value'), 'value')
		.equal(Object.keys(emitter), ['route'])
	})

	test('one removes itself before calling and leaves a persistent copy alone', async assert => {
		var emitter = {}
		, scope = { name: 'scope' }
		, calls = []
		, nested
		, handler = () => calls.push('change')
		, cancelled = () => calls.push('cancelled')
		one(emitter, 'recursive', function(value) {
			calls.push(this.name + ':' + value)
			nested = emit(emitter, 'recursive', value + 1)
		}, scope)
		on(emitter, 'change', handler)
		one(emitter, 'change', handler)
		one(emitter, 'cancelled', cancelled)
		off(emitter, 'cancelled', cancelled)
		assert
		.equal(await emit(emitter, 'recursive', 1), 1)
		.equal(await nested, 0)
		.equal(await emit(emitter, 'cancelled'), 0)
		.equal(await emit(emitter, 'change'), 2)
		.equal(await emit(emitter, 'change'), 1)
		.equal(calls, ['scope:1', 'change', 'change', 'change'])
	})

	test('one stays removed after throwing and releases a waiting emit', async assert => {
		var emitter = {}
		, calls = []
		, continued
		, err
		one(emitter, 'change', () => {
			continued = emit(emitter, 'after')
			throw Error('once')
		})
		on(emitter, 'after', () => calls.push('after'))
		try {
			await emit(emitter, 'change')
		} catch (e) {
			err = e
		}
		assert
		.equal(err?.message, 'once')
		.equal(await continued, 1)
		.equal(await emit(emitter, 'change'), 0)
		.equal(calls, ['after'])
	})

	test('event names are exact and do not collide with Object.prototype', async assert => {
		var emitter = {}
		, calls = []
		, names = ['__proto__', 'constructor', 'toString']
		off({}, '__proto__', () => {})
		on(emitter, '*', () => calls.push('*'))
		names.forEach(name => on(emitter, name, () => calls.push(name)))
		assert
		.equal([
			await emit(emitter, '__proto__'),
			await emit(emitter, 'constructor'),
			await emit(emitter, 'toString'),
			await emit(emitter, 'other'),
		], [1, 1, 1, 0])
		.equal(calls, names)
	})

	test('off matches function and scope without changing the active listener list', async assert => {
		var emitter = {}
		, a = { name: 'a' }
		, b = { name: 'b' }
		, calls = []
		, handler = function() { calls.push(this.name) }
		, registered = [
			on(emitter, 'change', handler, a),
			on(emitter, 'change', handler, b),
		]
		off(emitter, 'change')
		off(emitter, 'change', () => {})
		assert
		.equal(registered, [1, 2])
		.equal(await emit(emitter, 'change'), 2)
		.equal(calls, ['a', 'b'])
		off(emitter, 'change', handler, a)
		calls = []
		assert
		.equal(await emit(emitter, 'change'), 1)
		.equal(calls, ['b'])
		on(emitter, 'change', handler, b)
		off(emitter, 'change', handler, b)
		calls = []
		assert
		.equal(await emit(emitter, 'change'), 1)
		.equal(calls, ['b'])
	})

	test('emit keeps the current listener list when listeners add or remove', async assert => {
		var emitter = {}
		, calls = []
		, added
		, removed
		, late = () => calls.push('late')
		, second = () => calls.push('second')
		, run = async type => (calls = [], [await emit(emitter, type), ...calls])
		on(emitter, 'add', () => {
			calls.push('first')
			if (!added) added = on(emitter, 'add', late)
		})
		on(emitter, 'add', second)
		on(emitter, 'remove', () => {
			calls.push('first')
			if (!removed) removed = 1, off(emitter, 'remove', second)
		})
		on(emitter, 'remove', second)
		assert
		.equal(await run('add'), [2, 'first', 'second'])
		.equal(await run('add'), [3, 'first', 'second', 'late'])
		.equal(await run('remove'), [2, 'first', 'second'])
		.equal(await run('remove'), [1, 'first'])
	})

	test('prototype listeners are snapshotted when emit is called', async assert => {
		var proto = Data()
		, obj = Data({}, proto)
		, calls = []
		, inherited = () => calls.push('remove:proto')
		on(obj, 'add', () => {
			calls.push('add:obj')
			on(proto, 'add', () => calls.push('add:proto'))
		})
		on(proto, 'remove', inherited)
		on(obj, 'remove', () => {
			calls.push('remove:obj')
			off(proto, 'remove', inherited)
		})
		assert
		.equal(await emit(obj, 'add'), 1)
		.equal(await emit(obj, 'remove'), 2)
		.equal(await emit(obj, 'remove'), 1)
		.equal(calls, ['add:obj', 'remove:obj', 'remove:proto', 'remove:obj'])
	})

	test('unlisten matches every registration field and preserves direct listeners', async assert => {
		var removed = []
		, i
		, check = async at => {
			var who = {}
			, emitter = {}
			, scope = {}
			, calls = 0
			, handler = () => calls++
			, registration = [emitter, 'change', handler, scope, 'group']
			listen(who, ...registration)
			unlisten(who, registration[at])
			await emit(emitter, 'change')
			return calls
		}
		for (i = 0; i < 5; i++) removed.push(await check(i))

		var who = { name: 'listener' }
		, emitter = { name: 'emitter' }
		, calls = []
		, handler = function() { calls.push(this.name) }
		, registered = [
			listen(who, emitter, 'default', handler),
			listen(who, emitter, 'scoped', handler, who),
		]
		unlisten(who, 'missing')
		await emit(emitter, 'default')
		await emit(emitter, 'scoped')
		on(emitter, 'direct', handler)
		registered.push(listen(who, emitter, 'direct', handler))
		unlisten(who)
		assert
		.equal(removed, [0, 0, 0, 0, 0])
		.equal(registered, [1, 2, 3])
		.equal(calls, ['emitter', 'listener'])
		.equal(await emit(emitter, 'default'), 0)
		.equal(await emit(emitter, 'scoped'), 0)
		.equal(await emit(emitter, 'direct'), 1)
		.equal(calls, ['emitter', 'listener', 'emitter'])
	})

	test('private registration state does not collide, enumerate, or spread', async assert => {
		var emitter = { _e: 'application event data' }
		, who = { _l: 'application listener data' }
		, calls = 0
		, handler = () => calls++
		on(emitter, 'direct', handler)
		listen(who, emitter, 'owned', handler)
		await emit(emitter, 'direct')
		await emit(emitter, 'owned')
		assert
		.equal(emitter._e, 'application event data')
		.equal(who._l, 'application listener data')
		.equal(Object.getOwnPropertyNames(emitter), ['_e'])
		.equal(Object.getOwnPropertyNames(who), ['_l'])
		.equal(Object.getOwnPropertySymbols(emitter).length, 1)
		.equal(Object.getOwnPropertySymbols(who).length, 1)
		.equal(await emit({ ...emitter }, 'direct'), 0)
		.equal((unlisten({ ...who }), await emit(emitter, 'owned')), 1)
		.equal(calls, 3)
	})

	test('concurrent and nested emits settle in call order across emitters', async assert => {
		var a = {}
		, b = {}
		, calls = []
		, nested
		on(a, 'first', () => {
			calls.push('first')
			nested = emit(a, 'fourth')
		})
		on(b, 'second', () => calls.push('second'))
		on(a, 'third', () => calls.push('third'))
		on(a, 'fourth', () => calls.push('fourth'))
		var first = emit(a, 'first')
		, second = emit(b, 'second')
		, third = emit(a, 'third')
		assert
		.equal(calls, [], 'every emit waits for a microtask')
		.equal(await Promise.all([first, second, third]), [1, 1, 1])
		.equal(await nested, 1)
		.equal(calls, ['first', 'second', 'third', 'fourth'])
	})

	test('emit excludes listeners registered after the call', async assert => {
		var emitter = {}
		, calls = 0
		, pending = emit(emitter, 'change')
		on(emitter, 'change', () => calls++)
		assert
		.equal(await pending, 0)
		.equal(calls, 0)
	})

	test('emit keeps listeners removed after the call', async assert => {
		var emitter = {}
		, calls = 0
		, handler = () => calls++
		on(emitter, 'change', handler)
		var pending = emit(emitter, 'change')
		off(emitter, 'change', handler)
		assert
		.equal(await pending, 1)
		.equal(calls, 1)
	})
})
