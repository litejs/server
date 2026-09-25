
import '@litejs/cli/test.js'
import {
	Data,
	b32Dec, b32Enc, b64Arr, b64Dec, b64Enc, b64Url,
	each, fail, getCookie, hasOwn, hide, header, hex, hmac,
	isArr, isFn, isNum, anyObj, isObj, isStr,
	getProto, joinBuf, now, ownSlot, rand, sha256, sleep, ts,
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

	test('b32Dec decodes {0}', [
		[ 'the RFC secret', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '12345678901234567890' ],
		[ 'lower case with spaces and padding', 'mzxw 6yq=', 'foob' ],
		[ 'the RFC 4648 vector', 'MZXW6YTBOI======', 'foobar' ],
	], (_, str, out, assert) => {
		assert.equal(new TextDecoder().decode(b32Dec(str)), out).end()
	})

	test('b32Enc RFC 4648 {0}', [
		[ '', '' ],
		[ 'f', 'MY' ],
		[ 'fo', 'MZXQ' ],
		[ 'foo', 'MZXW6' ],
		[ 'foob', 'MZXW6YQ' ],
		[ 'fooba', 'MZXW6YTB' ],
		[ 'foobar', 'MZXW6YTBOI' ],
	], (str, out, assert) => {
		assert
		.equal(b32Enc(str), out)
		.equal(new TextDecoder().decode(b32Dec(out)), str, 'b32Dec reverses it')
		.end()
	})

	test('b32Enc and b32Dec take another alphabet', assert => {
		var hex32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV'
		assert
		.equal(b32Enc('foobar', hex32), 'CPNMUOJ1E8')
		.equal(new TextDecoder().decode(b32Dec('CPNMUOJ1E8======', hex32)), 'foobar')
		.end()
	})

	test('b32Enc roundtrips random bytes', assert => {
		for (var len = 0; len < 42; len++) {
			var buf = rand(len)
			assert.equal(b32Dec(b32Enc(buf)), buf)
		}
		assert.end()
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
		try {
			fail('Payload Too Large', 413)
		} catch (e) {
			assert.equal([e.message, e.code], ['Payload Too Large', 413])
		}
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
		assert.equal(header({}, 'range'), '', 'no headers')
		assert.end()
	})

	test('getCookie {1} from {0}', [
		[ 'a=1; b=2; c=3', 'a', '1', 'first' ],
		[ 'a=1; b=2; c=3', 'b', '2', 'middle' ],
		[ 'a=1; b=2; c=3', 'c', '3', 'last' ],
		[ 'a=1; b=; c=3', 'b', '', 'empty value' ],
		[ 'a=1', 'x', '', 'missing name' ],
		[ 'ab=1', 'b', '', 'name is whole, not a suffix' ],
		[ 'a=1;b=2', 'b', '', 'a missing space is not a separator' ],
		[ 'a=%C3%A9%20x', 'a', 'é x', 'value is percent-decoded' ],
		[ 'a=%E0%A4%A', 'a', '', 'a bad escape reads as absent' ],
		[ 'a=1; a=2', 'a', '', 'a repeated name is fixation' ],
		[ '', 'a', '', 'empty header' ],
	], (cookie, name, expected, _, assert) => {
		assert.equal(getCookie(new Request('http://localhost/', { headers: { cookie } }), name), expected)
		assert.end()
	})

	test('getCookie without a cookie header', (assert) => {
		assert.equal(getCookie(new Request('http://localhost/'), 'a'), '')
		assert.equal(getCookie({}, 'a'), '', 'no headers')
		assert.end()
	})

	test('getCookie takes the name from a cookie spec', (assert) => {
		var req = new Request('http://localhost/', { headers: { cookie: 'a=1; b=2' } })
		, spec = { name: 'b', path: '/', httpOnly: true, sameSite: 'strict', maxAge: 34560000000 }
		assert.equal(getCookie(req, spec), '2')
		assert.equal(getCookie({}, spec), '', 'no headers')
		assert.end()
	})

	test('now is milliseconds and ts whole seconds since the epoch', assert => {
		var ms = Date.now()
		assert
		.ok(now() >= ms && now() - ms < 1000)
		.ok(ts() >= ms / 1000 >>> 0 && ts() - ms / 1000 < 1)
		.strictEqual(ts() % 1, 0)
		.end()
	})

	test('rand gives fresh random bytes', assert => {
		var a = rand(16)
		assert
		.ok(a instanceof Uint8Array)
		.equal(a.length, 16)
		.equal(rand(0).length, 0)
		.notEqual(hex(a), hex(rand(16)))
		.end()
	})

	test('sleep resolves after the given milliseconds', async (assert, mock) => {
		var done = 0
		mock.time()
		sleep(10).then(() => done = 1)
		mock.tick(9)
		await Promise.resolve()
		assert.equal(done, 0, 'not yet')
		mock.tick(1)
		await Promise.resolve()
		assert.equal(done, 1)
	})

	test('sha256 returns the raw digest of {0}, the caller picks the format', [
		[ 'a string', 'abc' ],
		[ 'bytes', new Uint8Array([97, 98, 99]) ],
	], async (_, input, assert) => {
		var digest = await sha256(input)
		assert
		.ok(digest instanceof ArrayBuffer)
		.equal(digest.byteLength, 32)
		.equal(hex(digest), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
		.equal(b64Url(digest), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
	})

	test('getCookie {0} a value that {1} spec.re', [
		[ 'keeps', 'matches', 'a=1; b=abc', 'abc' ],
		[ 'drops', 'fails', 'a=1; b=ab1', '' ],
		[ 'drops', 'fails after decoding', 'a=1; b=%61bc%2F', '' ],
	], (_, __, cookie, expected, assert) => {
		var req = new Request('http://localhost/', { headers: { cookie } })
		assert.equal(getCookie(req, { name: 'b', re: /^[a-z]+$/ }), expected)
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

	// RFC 4231 section 4, case 5 is published truncated to 128 bits
	test('hmac RFC 4231 case {0}', [
		[ 1, new Uint8Array(20).fill(0x0b), 'Hi There',
			'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7' ],
		[ 2, 'Jefe', 'what do ya want for nothing?',
			'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843' ],
		[ 3, new Uint8Array(20).fill(0xaa), new Uint8Array(50).fill(0xdd),
			'773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe' ],
		[ 4, Uint8Array.from({ length: 25 }, (_, i) => i + 1), new Uint8Array(50).fill(0xcd),
			'82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b' ],
		[ 5, new Uint8Array(20).fill(0x0c), 'Test With Truncation',
			'a3b6167473100ee06e0c796c2955552b' ],
		[ 6, new Uint8Array(131).fill(0xaa), 'Test Using Larger Than Block-Size Key - Hash Key First',
			'60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54' ],
		[ 7, new Uint8Array(131).fill(0xaa), 'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
			'9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2' ],
	], async (_, key, data, expected, assert) => assert.equal(hex(await hmac(key, data)).slice(0, expected.length), expected))

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

