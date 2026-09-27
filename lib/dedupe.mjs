
// Request coalescing, while one call for `req[key]` is in progress,
// concurrent requests for the same key wait and share its result.
var dedupe = (handler, key = 'path', flights = new Map()) => async (req, env, ctx, k, res) => (
	[res, req.resStatus, req.resHeaders] = await (flights.get(k = req[key]) || (
		flights.set(k, res = (
			async () => [await handler(req, env, ctx), req.resStatus, req.resHeaders]
		)().finally(() => flights.delete(k))),
		res
	)),
	res instanceof Response ? res.clone() : res
)

export { dedupe }

