
import { isFn } from './util.mjs'


var routeRe = /\{([\w%.]+)([^}]?)\}|\\(\{)|[^{\\]+/g
, routeEnc = s => encodeURI(s).replace(/[?#]/g, encodeURIComponent)
, routeEsc = s => routeEnc(s).replace(
	/(%)[\dA-F]{2}|[.*+?^${}()|[\]\\]/g,
	(val, pr) => pr ? val.replace(/[A-F]/g, char => '[' + char + char.toLowerCase() + ']') : '\\' + val
)
, App = opts => {
	var methods = { DELETE: 'del', GET: 'get', HEAD: 'head', PATCH: 'patch', POST: 'post', PUT: 'put', ...opts?.method }
	, exts = { '*': '(.*)', '+': '(\\d+)', '/': '((?:[^/]+/)*)', ...opts?.extensions }
	, keys = Object.keys(methods).filter(method => methods[method])
	, middleware = []
	, mounts = Router(exts)
	, addRouter = (_, method) => routers[method] || (
		(routers[method] = Router(exts)).use(...middleware),
		methods[method] ? app[methods[method]] = routers[method].add : keys.push(method)
	)
	, app = (req, env, ctx) => {
		let tmp = routers[req.method], matched = tmp?.match(req)
		if (matched || req.method === 'HEAD' && (matched = (tmp = routers.GET)?.match(req)) || (matched = (tmp = mounts).match(req))) return tmp.handle(req, env, ctx, matched)
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
		var encLen = path ? routeEnc(path).length + 1 : 0
		, raw = routeEsc(path) + '(?:/.*|)'
		, handler = (req, env, ctx) => (req.mount = path, req.path = req.path.slice(encLen) || '/', sub(req, env, ctx))
		sub.each(addRouter)
		mounts.add(path, handler, raw)
		return app.all(path, handler, raw)
	}
	app.use = (...fns) => (middleware.push(...fns), mounts.use(...fns), each(r => r.use(...fns)))

	return app
}
, Router = exts => {
	var re
	, reStr = ''
	, groups = 1
	, routes = []

	return {
		match: req => reStr && (re ||= RegExp(`^/*(?:${reStr})[/\\s]*$`)).exec(req.path || ''),
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

