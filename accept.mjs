
import { Data, hasOwn, isObj, isStr } from './util.mjs'


var accept = choices => {
	var rules = isObj(choices) ? Object.keys(choices) : choices
	, escapeRe = /[.+?^!:${}()|[\]/\\]/g
	, paramRe = /;\s*(\w+)(=|\*=utf-8\'\w*\')("([^"]*)"|[^\s,;]*)/gi
	, parseParams = (str, map, init) => {
		for (var m, u, val; (m = paramRe.exec(str)); ) if (init || hasOwn(map, m[1])) {
			val = m[4] === u ? m[3] : m[4]
			try {
				val = decodeURIComponent(val)
			} catch {}
			map[m[1]] = val
		}
		return map
	}
	, qPos = 1
	, re = RegExp('(?:^|,\\s*)(?:(\\*(?:\\/\\*)?|' + (rules + '').replace(/,|\s*([^\s,;]+)(;(?:[^,"]|"[^"]*")*)?\s*/g, (all, rule, params) => {
		if (rule) {
			params = parseParams[qPos++] = params ? parseParams(params, Data(), 1) : {}
			params.rule = rule
			if (choices !== rules) params.o = choices[all]
			return rule.replace(escapeRe, '\\$&').replace(/\*/g, '[^,;\\s\\/+]+')
		}
		return ')|('
	}) + '))(?=[\\s;,]|$)(?=(?:[^,"]|"[^"]*")*?;\\s*q=([\\d.]+)|)((?:[^,"]|"[^"]*")*)', 'gi')

	return h => {
		if (isStr(h) && qPos > 1) {
			for (var m, w, best, q = re.lastIndex = 0, params; (m = re.exec(h)) && q < 1; ) {
				if ((w = (w = m[qPos]) && w >= 0 && w < 1 ? +w : 1) > q) {
					best = m
					q = w
				}
			}
			if (best) {
				for (m = qPos; m > 1 && !best[--m]; );
				params = parseParams(best[qPos + 1], { ...parseParams[m] })
				params.q = q
				m = ((params.match = best[m]) + '++').split(/[\/+]/)
				if (m[1]) {
					params.type = m[0]
					params.subtype = m[1]
					params.suffix = m[2]
				}
			}
		}
		return params || null
	}
}


export { accept }

