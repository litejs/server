
import { isNum, isStr } from '../util.mjs'


var worker = (app, defaultEnv) => async (req, env, ctx) => {
	try {
		env = { ...defaultEnv, ...env }
		var res
		, isHead = req.method === 'HEAD'
		, resHeaders = req.resHeaders = {}
		, url = new URL(req.url)

		req.header = name => req.headers.get(name)
		req.origin = url.origin
		req.path = req.fullPath = decodeURI(url.pathname)
		req.query = url.search.slice(1)
		req.searchParams = url.searchParams

		res = await app(req, env)
	} catch(e) {
		res = { body: e, status: 400 }
	}

	if (!(res instanceof Response)) {
		var type
		, { body = null, status = 200, headers } = isNum(res) ? { status: res } : res || {}
		if (body instanceof Error) {
			body = JSON.stringify({ error: body.message || body })
			type = 'application/json'
		} else if (isStr(body)) {
			type = 'text/plain'
		} else if (body && !body.getReader) {
			body = JSON.stringify(body)
			type = 'application/json'
		}
		var merged = new Headers(resHeaders)
		new Headers(headers).forEach((v, k) => merged[k === 'set-cookie' ? 'append' : 'set'](k, v))
		if (type && !merged.has('content-type')) merged.set('content-type', type)
		res = new Response(body ?? null, { status, headers: merged })
	}
	return isHead ? new Response(null, { status: res.status, headers: res.headers }) : res
}


export { worker }

