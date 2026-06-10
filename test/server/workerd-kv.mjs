
// Minimal KV-protocol shim for plain workerd: a kvNamespace binding turns
// env.KV calls into HTTP requests against this service (get -> GET /key,
// put -> PUT /key, delete -> DELETE /key, 404 means missing).
var store = new Map()

export default {
	async fetch(req) {
		var key = new URL(req.url).pathname
		switch (req.method) {
		case 'PUT':
			store.set(key, await req.text())
			return new Response()
		case 'DELETE':
			return new Response(null, { status: store.delete(key) ? 200 : 404 })
		default:
			return store.has(key) ? new Response(store.get(key)) : new Response(null, { status: 404 })
		}
	}
}
