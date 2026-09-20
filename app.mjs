
import { isFn } from './util.mjs'


var routeRe = /\{([\w%.]+)([^}]?)\}|\\?(.)/gu
, routeEnc = s => encodeURI(s).replace(/[?#]/g, encodeURIComponent)
, routeEsc = s => (s = routeEnc(s)).replace(s[1] ? /[A-F]/g : /[.*+$()]/, s[1] ? c => '[' + c + c.toLowerCase() + ']' : '\\$&')
, App = opts => {
	var method, router
	, mounts = Router()
	, exts = { '*': '(.*)', '+': '(\\d+)', '/': '((?:[^/]+/)*)', ...opts?.extensions }
	, routers = { DELETE: 'del', GET: 'get', HEAD: 'head', PATCH: 'patch', POST: 'post', PUT: 'put', ...opts?.method }
	, each = fn => {
		for (method in routers) if (routers[method]) fn(routers[method], method)
	}
	, match = (m, req) => (router = routers[m])?.match?.(req) || m === 'HEAD' && match('GET', req)
	, app = (req, env, ctx, m) => (
		(m = match(req.method, req) || (router = mounts).match(req)) ? router.handle(req, env, ctx, m) :
		(m = [], each(() => match(method, req) && m.push(method)), m[0]) ? (
			(req.resHeaders ??= {}).Allow = m.join(', '),
			opts?.notAllowed?.(req, env, ctx) ?? 405
		) : opts?.notFound?.(req, env, ctx) ?? 404
	)

	each(alias => app[alias] = (routers[method] = Router(exts)).add)

	app.all = (route, handler) => (each(r => r.add(route, handler)), app)
	app.use = (...fns) => (mounts.use(...fns), each(r => r.use(...fns)), app)
	app.mount = (path, sub, len) => (
		len = routeEnc(path),
		mounts.add(path, (req, env, ctx) => (req.mount = path, req.path = req.path.slice(len) || '/', sub(req, env, ctx)), len + '(?:/.*|)'),
		len = len.length + !!path,
		app
	)

	return app
}
, Router = exts => {
	var re
	// [] matches nothing, so an empty router compiles and every route can start with |
	, reStr = '^/*(?:[]'
	, groups = 1
	, routes = []

	return {
		match: req => (re ||= RegExp(reStr + ')[/\\s]*$')).exec(req.path || ''),
		add(route, handler, _raw) {
			var endSlot = routes.push(groups++, re = 0, route) - 2
			reStr += '|(' + (_raw || route.replace(routeRe, (_, expr, ext, char) =>
				expr ? (routes.push(expr), groups++, exts[ext] || '([^/]+)') : routeEsc(char)
			)) + ')'
			routes[endSlot] = routes.push(handler)
			return this
		},
		use(...fns) {
			// Group 0 is the whole match, so middleware is a route that always matches
			fns.forEach(fn => routes.push(0, routes.length + 4, 0, fn))
		},
		async handle(req, env, ctx, matched) {
			// Handlers and middleware throw on error; toHandler() owns error -> response.
			// Record: [group, end, routeStr, ...paramNames, handler]
			for (var end, m, group, pos = 0, param = req.param ??= {}; pos < routes.length; pos = end) {
				end = routes[pos + 1]
				if (matched[group = m = routes[pos]] != null) {
					req.route = routes[pos += 2]
					for (; ++pos < end - 1; ) param[routes[pos]] = decodeURIComponent(matched[++m])
					m = isFn(m = routes[pos]) ? m(req, env, ctx) : m
					if (group || (m = await m)) return m
				}
			}
		}
	}
}


export { App, Router }

