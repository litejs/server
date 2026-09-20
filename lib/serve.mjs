
import { header, isArr, isNum, isObj } from '../util.mjs'
import { mime } from './assets.mjs'


var noCtx = { waitUntil: p => p.catch(e => console.error(e.stack || e)) }
, parseRange = (header, size) => {
	var m = /^bytes=(\d*)-(\d*)$/.exec(header || '') || 0
	, start = m[1] ? +m[1] : size - +m[2]
	, end = m[1] && m[2] ? +m[2] : size - 1
	if (start >= 0 && start <= end && end < size) return { start, end }
}
// Emits only the requested window, so a Range never buffers the whole body
, sliceStream = (body, start, end) => {
	var pos = 0
	return body.pipeThrough(new TransformStream({
		transform(chunk, ctrl) {
			var at = pos
			pos += chunk.length
			if (pos > start) ctrl.enqueue(chunk.subarray(Math.max(0, start - at), end + 1 - at))
			if (pos > end) ctrl.terminate()
		}
	}))
}
// Honor a single `bytes=` Range on a 200 response with a known length; anything
// else (invalid/unsatisfiable ranges, If-Range validators) serves the full body.
, serveRange = async (req, res) => {
	res = await res
	var size = !header(res, 'content-range') && +header(res, 'content-length')
	, range = res.body && res.status === 200 && size > 0 && !header(req, 'if-range') && parseRange(header(req, 'range'), size)
	if (!range) return res
	var headers = new Headers(res.headers)
	headers.set('content-range', 'bytes ' + range.start + '-' + range.end + '/' + size)
	headers.set('content-length', '' + (range.end - range.start + 1))
	return new Response(sliceStream(res.body, range.start, range.end), { status: 206, headers })
}
, staticFrom = ({ body, cwd, resolve, sep, stat: fsStat }) => (baseDir = cwd(), {
	blockRe = /\/\.(?!well-known\/)/,
	defaultMime = 'application/octet-stream',
	notFound = () => 404,
} = {}) => {
	var root = resolve(baseDir) + sep

	return {
		async fetch(req) {
			try {
				// Self-contained: env.ASSETS.fetch may be called with new Request
				var pathname = decodeURIComponent(new URL(req.url).pathname)
				, file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
				, ext = file.split('.').pop().toLowerCase()
				, stat = file.startsWith(root) && !blockRe.test(pathname) && await fsStat(file)

				// A stream on node, a promise of bytes on txiki — await covers both.
				if (stat && stat.isFile) {
					return new Response(await body(file), { headers: {
						'content-length': stat.size,
						'content-type': mime[ext] || defaultMime
					}})
				}
			} catch {}
			return notFound()
		}
	}
}
, toHandler = (app, defaultEnv) => async (req, env, ctx = noCtx) => {
	var defer, done, res, url
	, isHead = req.method === 'HEAD'
	, resHeaders = req.resHeaders = {}
	req.defer = fn => ctx.waitUntil((defer ||= new Promise(r => done = r)).then(fn))
	try {
		url = new URL(req.url)

		if (url.pathname.indexOf('//') > -1) {
			// Use relative url so a client-supplied Host do not steer the redirection
			resHeaders.Location = url.pathname.replace(/\/\/+/g, '/') + url.search
			res = 301
		}

		req.isSecure = url.protocol === 'https:'
		req.origin = url.origin
		req.fullPath = decodeURI(req.path = url.pathname)
		req.query = url.search.slice(1)
		req.searchParams = url.searchParams
	} catch {
		res = 400
	}
	if (!res) try {
		res = await app(req, defaultEnv || env, ctx)
	} catch(e) {
		res = e instanceof Error ? e : Error(e)
		console.error(e.stack || e)
	}

	// Shaping throws on a bad header value or an unserializable body.
	if (!(res instanceof Response)) try {
		// Shape the handler result: a number is a status, an object/array is JSON, anything else is the body.
		// Status and extra headers come from req.resStatus / req.resHeaders.
		var negod = req.negod
		, { body, status = req.resStatus || 200, type } =
			isNum(res) ? { status: res } :
			isObj(res) || isArr(res) ? { body: (negod?.o || JSON.stringify)(res, negod), type: negod?.rule || 'application/json' } :
			res instanceof Error ? { body: res.message, status: res.code || 500 } :
			{ body: res }
		, headers = new Headers(resHeaders)
		if (!(status >= 200 && status <= 599)) status = 500
		// Do not leak internals on 5xx; the error was already logged above.
		if (res instanceof Error && status > 499) body = 'Internal Server Error'
		if (type && !headers.has('content-type')) headers.set('content-type', type)
		res = new Response(isHead ? null : body, { status, headers })
	} catch(e) {
		console.error(e.stack || e)
		res = new Response('Internal Server Error', { status: 500 })
	}
	done?.()
	return isHead && res.body ? new Response(null, res) : res
}


export { parseRange, serveRange, staticFrom, toHandler }

