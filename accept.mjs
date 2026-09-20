
import { hasOwn, isObj, isStr } from './util.mjs'


var accept = choices => {
	var rules = isObj(choices) ? Object.keys(choices) : choices
	, paramRe = /;\s*(\w+)(=|\*=utf-8'\w*')("([^"]*)"|[^\s,;]*)/gi
	, tokenRe = /(?:^|,)\s*([^\s;,]+)(?=(?:[^,"]|"[^"]*")*?;\s*q=([\d.]+)|)((?:[^,"]|"[^"]*")*)/g
	, parseParams = (str, map, init) => {
		for (var m, val; (m = paramRe.exec(str)); ) if (init || hasOwn(map, m[1])) {
			val = m[4] ?? m[3]
			try {
				val = decodeURIComponent(val)
			} catch {}
			map[m[1]] = val
		}
		return map
	}
	, defs = [
		...('' + rules).matchAll(/([^\s,;]+)((?:\s*;\s*(?:[^,"\s]|"[^"]*")*)?)/g)
	].map(([all, rule, params]) => parseParams(params, { rule, o: rules === choices ? all : choices[all] }, 1))

	rules = defs.map(def => RegExp('^(?:\\*(?:/\\*)?|' + def.rule.replace(/\W/g, c => c == '*' ? '[^/+]+' : '\\' + c) + ')$', 'i'))

	return h => {
		if (isStr(h)) for (var m, w, i, best, bestI, params, q = tokenRe.lastIndex = 0; q < 1 && (m = tokenRe.exec(h)); ) {
			if ((w = m[2] < 1 ? +m[2] : 1) > q && (i = rules.findIndex(re => re.test(m[1]))) > -1) {
				best = m
				bestI = i
				q = w
			}
		}
		if (best) {
			params = parseParams(best[3], { ...defs[bestI] })
			params.q = q
			if ((m = ((params.match = best[1]) + '++').split(/[/+]/))[1]) {
				params.type = m[0]
				params.subtype = m[1]
				params.suffix = m[2]
			}
		}
		return params || null
	}
}


export { accept }

