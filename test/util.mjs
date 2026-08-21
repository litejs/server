
import '@litejs/cli/test.js'
import {
	Data,
	b64Arr, b64Dec, b64Enc, b64Url,
	each, fail, hasOwn, hide, header, hex,
	isArr, isFn, isNum, anyObj, isObj, isStr,
	getProto, joinBuf, ownSlot,
	toNum, toStr, toUint,
} from '../util.mjs'

describe('util.mjs', () => {
	var undef

	test('Data sets the prototype in place', assert => {
		var proto = Data({ inherited: 1 })
		, obj = { own: 2 }
		assert
		.equal(Data(), {})
		.strictEqual(getProto(Data()), null, 'null prototype by default')
		.strictEqual(Data(obj, proto), obj, 'the same object, not a copy')
		.strictEqual(getProto(obj), proto)
		.equal([obj.own, obj.inherited], [2, 1])
		.equal(Object.keys(obj), ['own'], 'inherited keys stay on the prototype')
		.end()
	})

	test('each iterates strings, arrays, and own object values', (assert, mock) => {
		var scope = { name: 'scope' }
		, inherited = { inherited: 0 }
		, obj = Object.assign(Object.create(inherited), { a: 1, b: 2 })
		, arr = ['d']
		, fn = mock.fn()
		each(null, fn, scope)
		each('a, b\nc', fn, scope)
		each(arr, fn, scope)
		each(obj, fn, scope)
		assert
		.equal(fn.calls.map(call => [call.scope, call.args]), [
			[scope, ['a', 0, ['a', 'b', 'c']]],
			[scope, ['b', 1, ['a', 'b', 'c']]],
			[scope, ['c', 2, ['a', 'b', 'c']]],
			[scope, ['d', 0, arr]],
			[scope, [1, 'a', obj]],
			[scope, [2, 'b', obj]],
		])
		.end()
	})

	test('Base64', assert => {
		assert.equal(b64Arr('+//+'), new Uint8Array([0xfb, 0xff, 0xfe]))
		assert.equal(b64Arr('-__-'), new Uint8Array([0xfb, 0xff, 0xfe]))
		assert.equal(b64Enc(new Uint8Array([0xfb, 0xff, 0xfe])), '+//+')
		assert.equal(b64Url([0xfb, 0xff, 0xfe]), '-__-')

		assert.equal(b64Dec('aGk'), 'hi')
		assert.equal(b64Dec('aGk='), 'hi')
		assert.equal(b64Enc('hi'), 'aGk=')
		assert.equal(b64Url('hi'), 'aGk')

		assert.equal(b64Enc(new Uint8Array([0xc3, 0xa9])), 'w6k=')
		assert.equal(b64Url('é'), 'w6k')
		assert.equal(b64Arr('w6k'), new Uint8Array([0xc3, 0xa9]))

		assert.equal(b64Dec('!!!'), '')
		assert.end()
	})

	test('fail', (assert) => {
		assert.throws(() => fail('bad name'))
		assert.end()
	})

	test('hasOwn', [
		[{a:1}, 'a', true],
		[{}, 'a', false],
		[{a:null}, 'a', true],
	], (obj, key, expected, assert) => assert.equal(hasOwn(obj, key), expected).end())

	test('hide defines a property that does not show', assert => {
		var obj = { visible: 1 }
		, key = Symbol('hidden')
		assert
		.strictEqual(hide(obj, 'secret', 42), obj, 'returns the object')
		.equal(obj.secret, 42)
		.equal(Object.keys(obj), ['visible'])
		.equal(JSON.stringify(obj), '{"visible":1}')
		.equal({ ...obj }, { visible: 1 }, 'a copy does not carry it')
		.equal(Object.getOwnPropertyDescriptor(obj, 'secret'),
			{ value: 42, writable: false, enumerable: false, configurable: false })
		.equal(hide(obj, key, 'by symbol')[key], 'by symbol')
		.end()
	})

	test('ownSlot makes a hidden slot once per object', assert => {
		var made = 0
		, make = () => (made++, [])
		, proto = {}
		, obj = Object.create(proto)
		, protoSlot = ownSlot(proto, 'slot', make)
		, slot = ownSlot(obj, 'slot', make)
		protoSlot.push('proto')
		slot.push('own')
		assert
		.equal(made, 2, 'an inherited slot is not reused')
		.strictEqual(ownSlot(obj, 'slot', make), slot, 'later calls return the same slot')
		.equal(made, 2, 'make runs once per object')
		.equal([protoSlot, slot], [['proto'], ['own']])
		.equal(hasOwn(obj, 'slot'), true)
		.equal(Object.keys(obj), [], 'the slot is hidden')
		.end()
	})

	test('header', (assert) => {
		var req = new Request('http://localhost/', { headers: { range: 'bytes=0-1' } })
		, res = new Response('', { headers: { 'Content-Type': 'text/plain' } })
		assert.equal(header(req, 'range'), 'bytes=0-1')
		assert.equal(header(res, 'content-type'), 'text/plain')
		assert.equal(header(res, 'Content-Type'), 'text/plain', 'case-insensitive')
		assert.equal(header(res, 'x-missing'), '', 'missing header')
		assert.equal(header(null, 'range'), '', 'no request')
		assert.equal(header({}, 'range'), '', 'no headers')
		assert.end()
	})

	test('hex {0}', [
		[ '00010f10ff', [0, 1, 15, 16, 255] ],
	], (str, arr, assert) => {
		assert.equal(hex(arr), str)
		assert.equal(hex(new Uint8Array(arr)), str)
		assert.equal(hex(new Uint8Array(arr).buffer), str, 'accepts ArrayBuffer')
		assert.end()
	})

	describe('type checkers', () => {
		test('isArr', [
			[[], true],
			[null, false],
		], (value, expected, assert) => assert.equal(isArr(value), expected).end())

		test('isFn', [
			[() => {}, true],
			[function() {}, true],
			[async () => {}, true],
			[123, false],
			['string', false],
			[{}, false],
			[[], false],
			[null, false],
		], (value, expected, assert) => assert.equal(isFn(value), expected).end())

		test('isNum', [
			[123, true],
			[0, true],
			[-5, true],
			[1.5, true],
			['123', false],
			[NaN, false],
			[Infinity, true],
			[null, false],
			[[], false],
			['', false],
		], (value, expected, assert) => assert.equal(isNum(value), expected).end())

		// anyObj takes anything that can hold a property, isObj only plain data
		test('anyObj', [
			[{}, true],
			[Data(), true],
			[Object.create(null), true],
			[[], true],
			[new Date(), true],
			[new (class K {})(), true],
			[Object(123), true],
			// typeof calls a function a function and null an object, anyObj neither
			[() => {}, false],
			[Date, false],
			[null, false],
			[undef, false],
			[Symbol(), false],
			['', false],
			['string', false],
			[0, false],
			[123, false],
			[false, false],
		], (value, expected, assert) => assert.equal(anyObj(value), expected).end())

		test('isObj', [
			[{}, true],
			[Data(), true],
			[{ a: 1 }, true],
			[{ constructor: 1 }, true],
			[Object.create(null), true],
			[Object.create(Object.create(null)), true],
			[[], false],
			[new Date(), false],
			[Date, false],
			[() => {}, false],
			[async () => {}, false],
			[null, false],
			['', false],
			['string', false],
			[123, false],
		], (value, expected, assert) => assert.equal(isObj(value), expected).end())

		test('isStr', [
			['string', true],
			['', true],
			[123, false],
			[null, false],
			[{}, false],
		], (value, expected, assert) => assert.equal(isStr(value), expected).end())

	})

	test('joinBuf concatenates Uint8Arrays', (assert) => {
		var out = joinBuf(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5]))
		assert.equal([...out], [1, 2, 3, 4, 5])
		assert.equal([...joinBuf()], [])
		assert.end()
	})

	test('toNum {0}', [
		[ undef, null ],
		[ 0, 0 ],
		[ '0', 0 ],
		[ 1, 1 ],
		[ '1', 1 ],
		[ 123, 123 ],
		[ '123', 123 ],
		[ '12k', 12000 ],
		[ '126 km', 126*1000 ],
		[ '127kiB', 127*1024 ],
		[ '128 ki', 128*1024 ],
		[ '2M',  2*1000*1000 ],
		[ '3Mi', 3*1024*1024 ],
		[ '4G',  4*1000*1000*1000 ],
		[ '5Gi', 5*1024*1024*1024 ],
		[ '6T',  6*1000*1000*1000*1000 ],
		[ '7Ti', 7*1024*1024*1024*1024 ],
		[ '8P',  8*1000*1000*1000*1000*1000 ],
		[ '9Pi', 9*1024*1024*1024*1024*1024 ],
		[ '1 sec', 1000 ],
		[ '2min', 120000 ],
		[ '3 hr', 10800000 ],
		[ '4 days', 345600000 ],
		[ '5weeks', 3024000000 ],
		[ '6 months', 15778454400 ],
		[ '7 years', 220898361600 ],
		[ 'notnumber', null ],
		[ {}, null ],
	], (input, expected, assert) => assert.equal(toNum(input), expected).end())

	test('toStr {0}', [
		[ '', '' ],
		[ new Uint8Array([0xC3,0xA9]), 'é' ],
	], (input, expected, assert) => assert.equal(toStr(input), expected).end())

	test('toUint {0}', [
		[ 'é', new Uint8Array([0xC3,0xA9]) ],
		[ {a:1}, new Uint8Array([123,34,97,34,58,49,125]) ],
	], (input, expected, assert) => assert.equal(toUint(input), expected).end())
})

