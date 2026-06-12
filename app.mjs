
import { isFn } from './util.mjs'


var routeRe = /\{([\w%.]+)([^}]?)\}|\\(\{)|[^{\\]+/g
, routeEsc = s => s.replace(/[.*+?^=!:${}()|\[\]\/\\]/g, '\\$&')
, routeRun = async (req, env, match, routes) => {
	req.param = {}
	// Handlers and middleware throw on error; the worker owns error -> response.
	for (var end, m, body, pos = 0, len = routes.length; pos < len; pos = end) {
		end = routes[pos + 1]
		if ((m = routes[pos++]) < 1) {
			// Middleware: [0, end, ...fns]
			for (; !body && ++pos < end; ) if ((body = await routes[pos](req, env))) end = len
		} else if (match[m] != null) {
			// Matched route: [group, end, routeStr, ...paramNames, handler]
			req.route = routes[++pos]
			for (end--; ++pos < end; ) req.param[routes[pos]] = decodeURIComponent(match[++m])
			m = routes[pos]
			body = isFn(m) ? await m(req, env) : m
			end = len
		}
	}
	return body && (body.body || body.status) ? body : { body }
}
, App = opts => {
	var methods = { DELETE: 'del', GET: 'get', PATCH: 'patch', POST: 'post', PUT: 'put', ...opts?.method }
	, keys = Object.keys(methods)
	, app = (req, env) => (routers[req.method === 'HEAD' ? 'GET' : req.method]?.handle || notAllowed)(req, env)
	, each = fn => (keys.forEach(method => fn(routers[method], method)), app)
	, notAllowed = opts?.notAllowed || (() => ({ status: 405, headers: { Allow: keys.join(', ') }}))
	, routers = app.routers = Object.create(null)

	each((_, method) => app[methods[method]] = (routers[method] = Router(opts)).add)

	app.all = (route, handler, _raw) => each(r => r.add(route, handler, _raw))
	app.mount = (path, sub) => app.all(
		path,
		(req, env) => (req.path = req.path.slice((req.mount = path).length + 1) || '/', sub(req, env)),
		routeEsc(path) + '(?:\\/.*|)'
	)
	app.use = (...fns) => each(r => r.use(...fns))

	return app
}
, Router = opts => {
	var re
	, reStr = ''
	, exts = { '*': '(.*)', '+': '(\\d+)', '/': '((?:[^/]+\\/)*)', ...opts?.extensions }
	, notFound = opts?.notFound || (() => ({ status: 404 }))
	, groups = 1
	, routes = []

	return {
		routes,
		add(route, handler, _raw) {
			var endSlot = routes.push(groups++, re = 0, route) - 2
			reStr += (reStr ? '|(' : '(') + (_raw || route.replace(routeRe, (_, expr, ext, toEsc) =>
				expr ? (routes.push(expr), groups++, exts[ext] || '([^/]+)') : routeEsc(toEsc || _)
			)) + ')'
			routes[endSlot] = routes.push(handler)
			return this
		},
		use(...fns) {
			routes.push(0, 2 + routes.length + fns.length, ...fns)
		},
		handle(req, env) {
			var match = req && (re || (re = RegExp('^\\/*(?:' + reStr + ')[\\/\\s]*$'))).exec(req.path || '')
			return match ? routeRun(req, env, match, routes) : notFound(req, env)
		}
	}
}


export { App, Router }

