
import { UNDEF, Data, getProto, hasOwn, hide, isExtensible, isFn, ownSlot } from './util.mjs'


var emitting
, EV = Symbol()
, LI = Symbol()
, ONE = Symbol()
, on = (src, ev, fn, scope) => ev && isFn(fn) && isExtensible(src) && (ownSlot(src, EV, Data)[ev] ??= []).push(fn, scope) / 2
, one = (src, ev, fn, scope) => isFn(fn) && on(src, ev, hide(function once(...args) {
	off(src, ev, once, scope)
	return fn.apply(this, args)
}, ONE, fn), scope)
, off = (src, ev, fn, scope, arr, i) => {
	if (src && ev && hasOwn(src, EV) && isFn(fn) && (arr = src[EV][ev])) {
		for (i = arr.length; i > 0; ) {
			if ((arr[i -= 2] === fn || arr[i][ONE] === fn) && arr[i + 1] === scope) {
				arr.splice(i, 2)
				break
			}
		}
	}
}
, emit = async (src, ev, ...args) => {
	for (var arr, release, list = [], i = 0, obj = src; obj; obj = getProto(obj)) {
		if (hasOwn(obj, EV) && (arr = obj[EV][ev])) list.push(...arr)
	}
	await emitting
	try {
		for (emitting = new Promise(resolve => release = resolve); i < list.length; i += 2) {
			list[i].apply(list[i + 1] || src, args)
		}
	} finally {
		release()
	}
	return list.length / 2
}
, listen = (who, src, ev, fn, scope, group) => isExtensible(who) && on(src, ev, fn, scope) && ownSlot(who, LI, Array).push(src, ev, fn, scope, group) / 5
, unlisten = (who, key, arr, i) => {
	if (who && hasOwn(who, LI)) for (arr = who[LI], i = arr.length; (i -= 5) >= 0; ) {
		if (key == UNDEF || arr.slice(i, i + 5).includes(key)) off(...arr.splice(i, 5))
	}
}


export { on, one, off, emit, listen, unlisten }

