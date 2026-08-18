
import { isFn } from './util.mjs'


var routeRe = /\{([\w%.]+)([^}]?)\}|\\(\{)|[^{\\]+/g
, routeEsc = s => encodeURI(s)
	.replace(/[.*+?^=!:${}()|\[\]\/\\]/g, '\\$&')
	.replace(/%[\dA-F]{2}/g, val => val.replace(/[A-F]/g, char => '[' + char + char.toLowerCase() + ']'))
, App = opts => {
	var methods = { DELETE: 'del', GET: 'get', HEAD: 'head', PATCH: 'patch', POST: 'post', PUT: 'put', ...opts?.method }
	, exts = { '*': '(.*)', '+': '(\\d+)', '/': '((?:[^/]+\\/)*)', ...opts?.extensions }
	, keys = Object.keys(methods)
	, middleware = []
	, addRouter = (router, method) => routers[method] || (
		router = routers[method] = Router(exts),
		router.use(...middleware),
		methods[method] ? app[methods[method]] = router.add : keys.push(method)
	)
	, app = (req, env, ctx) => {
		let matched = req.method, tmp = routers[matched]
		if (matched === 'HEAD' && !tmp.match(req)) tmp = routers.GET
		if ((matched = tmp?.match(req))) return tmp.handle(req, env, ctx, matched)
		if ((tmp = keys.filter(method => routers[method].match(req) || method === 'HEAD' && routers.GET?.match(req)).join(', '))) {
			(req.resHeaders ??= {}).Allow = tmp
			return opts?.notAllowed?.(req, env, ctx) ?? 405
		}
		return opts?.notFound?.(req, env, ctx) ?? 404
	}
	, each = app.each = fn => (keys.forEach(method => fn(routers[method], method)), app)
	, routers = app.routers = Object.create(null)

	each(addRouter)

	app.all = (route, handler, _raw) => each(r => r.add(route, handler, _raw))
	app.mount = (path, sub) => {
		var encLen = path ? encodeURI(path).length + 1 : 0
		sub.each(addRouter)
		return app.all(
			path,
			(req, env, ctx) => (req.mount = path, req.path = req.path.slice(encLen) || '/', sub(req, env, ctx)),
			routeEsc(path) + '(?:\\/.*|)'
		)
	}
	app.use = (...fns) => (middleware.push(...fns), each(r => r.use(...fns)))

	return app
}
, Router = exts => {
	var re
	, reStr = ''
	, groups = 1
	, routes = []

	return {
		match: req => req && reStr && (re || (re = RegExp('^\\/*(?:' + reStr + ')[\\/\\s]*$'))).exec(req.path || ''),
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
		async handle(req, env, ctx, matched) {
			// Handlers and middleware throw on error; the worker owns error -> response.
			for (var end, m, pos = 0, len = routes.length, param = req.param ??= {}; pos < len; pos = end) {
				end = routes[pos + 1]
				if ((m = routes[pos++]) < 1) {
					// Middleware: [0, end, ...fns]
					for (; ++pos < end; ) if ((m = await routes[pos](req, env, ctx))) return m
				} else if (matched[m] != null) {
					// Matched route: [group, end, routeStr, ...paramNames, handler]
					req.route = routes[++pos]
					for (end--; ++pos < end; ) param[routes[pos]] = decodeURIComponent(matched[++m])
					m = routes[pos]
					return isFn(m) ? m(req, env, ctx) : m
				}
			}
		}
	}
}


export { App, Router }

