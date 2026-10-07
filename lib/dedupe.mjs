
import { anyObj, fail, jsonParse, sleep } from '../util.mjs'


// Request coalescing, while one call for `req[key]` is in progress,
// concurrent requests for the same key wait and share its result.
var dedupe = (handler, key = 'path', flights = new Map()) => async (req, env, ctx, k, res, buf) => (
	[res, req.resStatus, req.resHeaders, buf] = await (flights.get(k = req[key]) || (
		flights.set(k, res = (
			async res => [
				res = await handler(req, env, ctx),
				req.resStatus, req.resHeaders,
				// Cloudflare bind a body stream to the request that made it, others get: Cannot perform I/O on behalf of a different request.
				// Leader reads body once and other build own Responses
				res instanceof Response && res.body && await res.arrayBuffer()
			]
		)().finally(() => flights.delete(k))),
		res
	)),
	res instanceof Response ? new Response(buf, res) : res
)
// A record stays in memory for cache ms after last holder, so requests soon after share it instead of reading the store,
// and state kept on it in memory, as a device's previous key, outlives the request that made it
, sharedKV = (kv, opts, map = new Map(), cache = 1e3) => async (req, key, rec, done, put = () => kv.put(key, rec[1], opts)) => (
	rec = await (map.get(key) || (
		map.set(key, rec = kv.get(key).then(
			(str, res) => anyObj(res = jsonParse(str)) ? [res, str, 0] : [{}, '{}', 0],
			e => (map.delete(key), fail(e))
		)),
		rec
	)),
	rec[2]++,
	req.defer(done = stamp => --rec[2] || (
		// A kv.put holds the record same as request
		rec[1] !== (rec[1] = JSON.stringify(rec[0])) ? put(rec[2]++).catch(() => sleep(1e3).then(put)).finally(done) :
		// Free and written, it goes after cache ms, unless a new request started a new wait
		stamp = rec[3] = sleep(cache).then(() => rec[2] || rec[3] !== stamp || map.delete(key))
	)),
	rec[0]
)

export { dedupe, sharedKV }

