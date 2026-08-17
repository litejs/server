
import { isFn } from './util.mjs'


var routeRe = /\{([\w%.]+)([^}]?)\}|\\(\{)|[^{\\]+/g
, routeEsc = s => encodeURI(s).replace(/[.*+?^=!:${}()|\[\]\/\\]/g, '\\$&')
, App = opts => {
	var methods = { DELETE: 'del', GET: 'get', HEAD: 'head', PATCH: 'patch', POST: 'post', PUT: 'put', ...opts?.method }
	, keys = Object.keys(methods)
	, notAllowed = opts?.notAllowed || (req => ((req.resHeaders ??= {}).Allow = keys.join(', '), 405))
	, app = (req, env, ctx) => ((req.method === 'HEAD' && !routers.HEAD?.match(req) ? routers.GET : routers[req.method])?.handle || notAllowed)(req, env, ctx)
	, each = fn => (keys.forEach(method => fn(routers[method], method)), app)
	, routers = app.routers = Object.create(null)

	each((_, method) => app[methods[method]] = (routers[method] = Router(opts)).add)

	app.all = (route, handler, _raw) => each(r => r.add(route, handler, _raw))
	app.mount = (path, sub) => {
		var encLen = path ? encodeURI(path).length + 1 : 0
		return app.all(
			path,
			(req, env, ctx) => (req.mount = path, req.path = req.path.slice(encLen) || '/', sub(req, env, ctx)),
			routeEsc(path) + '(?:\\/.*|)'
		)
	}
	app.use = (...fns) => each(r => r.use(...fns))

	return app
}
, Router = opts => {
	var re
	, reStr = ''
	, exts = { '*': '(.*)', '+': '(\\d+)', '/': '((?:[^/]+\\/)*)', ...opts?.extensions }
	, groups = 1
	, match = req => req && reStr && (re || (re = RegExp('^\\/*(?:' + reStr + ')[\\/\\s]*$'))).exec(req.path || '')
	, routes = []

	return {
		routes,
		match,
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
		async handle(req, env, ctx) {
			var end, m, pos = 0, len = routes.length, param = req.param ??= {}
			, matched = match(req)
			// Handlers and middleware throw on error; the worker owns error -> response.
			if (matched) for (; pos < len; pos = end) {
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
			return opts?.notFound?.(req, env, ctx) ?? 404
		}
	}
}


export { App, Router }

