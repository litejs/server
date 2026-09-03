
import { isArr, isNum, isObj } from '../util.mjs'


var worker = (app, defaultEnv) => async (req, env, ctx) => {
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

		req.header = name => req.headers.get(name)
		req.isSecure = url.protocol === 'https:'
		req.origin = url.origin
		req.fullPath = decodeURI(req.path = url.pathname)
		req.query = url.search.slice(1)
		req.searchParams = url.searchParams
	} catch(e) {
		res = 400
	}
	if (!res) try {
		env = { ...defaultEnv, ...env }
		res = await app(req, env, ctx)
	} catch(e) {
		res = e
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


export { worker }

