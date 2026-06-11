

var UNDEF
, ENC = new TextEncoder()
, DEC = new TextDecoder()
, O_PROTO = Object.prototype
, b64Raw = str => {
	try {
		return atob(str.replace(/-/g, '+').replace(/_/g, '/'))
	} catch {
		return ''
	}
}
, b64Arr = str => Uint8Array.from(b64Raw(str), c => c.charCodeAt(0))
, b64Dec = str => decodeURIComponent(escape(b64Raw(str)))
, b64Enc = buf => btoa(isStr(buf) ? unescape(encodeURIComponent(buf)) : String.fromCharCode(...toUint(buf)))
, b64Url = buf => b64Enc(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
, fail = msg => { throw Error(msg) }
, hasOwn = Object.hasOwn
, header = (req, name) => req?.headers?.get(name) || ''
, hex = val => Array.from(toUint(val), c => (c < 16 ? '0' : '') + c.toString(16)).join('')
, isArr = Array.isArray
, isFn = fn => typeof fn === 'function'
, isNum = num => typeof num === 'number' && num === num
, isObj = obj => !!obj && (Object.getPrototypeOf(obj) || O_PROTO) === O_PROTO
, isStr = str => typeof str === 'string'
, joinBuf = (...p) => {
	for (var out, i = p.length, j = i, len = 0; i--;) len += (p[i] = toUint(p[i])).length
	for (out = new Uint8Array(len); j--;) out.set(p[j], len -= p[j].length)
	return out
}
, toNum = ((NUM_RE, NUM_MAP) => a => isNum(a) ? a : isStr(a) && (a = NUM_RE.exec(a)) ? a[1] * NUM_MAP[a[2]] : null)(
	/^(-?\d+(?:\.\d*)?) *([kMGTP]i?|sec|min|hr|day|week|month|year|).?$/,
	{
		'': 1,
		sec: 1e3, min: 6e4, hr: 36e5, day: 864e5, week: 6048e5, month: 2629742400, year: 31556908800,
		k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15,
		ki: 1024, Mi: 1048576, Gi: 1073741824, Ti: 1099511627776, Pi: 1125899906842624
	}
)
, toStr = val => isStr(val) ? val : DEC.decode(toUint(val))
, toUint = val => (
	val instanceof Uint8Array ? val :
	val instanceof ArrayBuffer || isArr(val) ? new Uint8Array(val) :
	ENC.encode(isStr(val) ? val : JSON.stringify(val))
)


export {
	UNDEF,
	b64Arr, b64Dec, b64Enc, b64Url,
	fail, hasOwn, header, hex,
	isArr, isFn, isNum, isObj, isStr,
	joinBuf,
	toNum, toStr, toUint,
}

