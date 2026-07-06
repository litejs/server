

// Request coalescing, while one call for `req[key]` is in progress,
// concurrent requests for the same key wait and share its result.
var dedupe = (handler, key = 'path') => {
	var flights = new Map()
	return async (req, env, ctx) => {
		var done
		, k = req[key]
		, flight = flights.get(k)
		if (!flight) {
			// Leader: run once, snapshot the per-request state it sets.
			flight = (async () => ({
				res: await handler(req, env, ctx),
				status: req.resStatus,
				headers: req.resHeaders
			}))()
			flights.set(k, flight)
			flight.then(done = () => flights.delete(k), done)
		}
		done = await flight
		req.resStatus = done.status
		req.resHeaders = done.headers
		return done.res instanceof Response ? done.res.clone() : done.res
	}
}

export { dedupe }

