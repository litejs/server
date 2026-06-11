
import '@litejs/cli/test.js'
import {
	b64Arr, b64Dec, b64Enc, b64Url,
	fail, hasOwn, header, hex,
	isArr, isFn, isNum, isObj, isStr,
	joinBuf,
	toNum, toStr, toUint,
} from '../util.mjs'

describe('util.mjs', () => {
	var undef

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

		test('isObj', [
			[{}, true],
			[{ a: 1 }, true],
			[{ constructor: 1 }, true],
			[Object.create(null), true],
			[[], false],
			[null, false],
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

