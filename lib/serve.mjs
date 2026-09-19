
import { header, isArr, isNum, isObj } from '../util.mjs'
import { mime } from './assets.mjs'


var noCtx = { waitUntil() {} }
, parseRange = (header, size) => {
	var m = /^bytes=(\d*)-(\d*)$/.exec(header || '') || 0
	, start = m[1] ? +m[1] : size - +m[2]
	, end = m[1] && m[2] ? +m[2] : size - 1
	if (start >= 0 && start <= end && end < size) return { start, end }
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
	return new Response((await res.arrayBuffer()).slice(range.start, range.end + 1), { status: 206, headers })
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
	try {
		var res
		, isHead = req.method === 'HEAD'
		, resHeaders = req.resHeaders = {}
		, url = new URL(req.url)

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
	} catch(e) {
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
		var { body = null, status = req.resStatus || 200, type } =
			isNum(res) ? { status: res } :
			isObj(res) || isArr(res) ? { body: JSON.stringify(res), type: 'application/json' } :
			res instanceof Error ? { body: res.message, status: res.code || 500 } :
			{ body: res }
		, headers = new Headers(resHeaders)
		if (!(status >= 200 && status <= 599)) status = 500
		// Do not leak internals on 5xx; the error was already logged above.
		if (res instanceof Error && status > 499) body = 'Internal Server Error'
		if (type && !headers.has('content-type')) headers.set('content-type', type)
		res = new Response(body ?? null, { status, headers })
	} catch(e) {
		console.error(e.stack || e)
		res = new Response('Internal Server Error', { status: 500 })
	}
	return isHead ? new Response(null, { status: res.status, headers: res.headers }) : res
}


export { parseRange, serveRange, staticFrom, toHandler }

