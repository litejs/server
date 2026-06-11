
// Minimal R2-protocol shim for plain workerd, mirroring workerd-kv.mjs: an
// r2Bucket binding turns env.R2 calls into HTTP requests. get/head/delete/list
// carry the op JSON in the cf-r2-request header; put frames it as the first
// cf-r2-metadata-size bytes of the body, with the object data after. Success
// replies frame metadata the same way; a missing object is a 404 + CF-R2-Error.
// get/put/head are exercised by the e2e; delete/list are best-effort.
var store = new Map()
, enc = new TextEncoder()
, dec = new TextDecoder()
, hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
, sha = async str => hex(await crypto.subtle.digest('SHA-256', enc.encode(str)))
, metaOf = (name, o) => ({
	name,
	version: o.version,
	size: o.size,
	etag: o.etag,
	uploaded: o.uploaded,
	httpFields: o.httpFields || {},
	customFields: o.customFields || [],
	range: { offset: 0, length: o.size },
	storageClass: 'Standard',
})
, reply = (meta, data) => {
	var head = enc.encode(JSON.stringify(meta))
	, body = head
	if (data) {
		body = new Uint8Array(head.length + data.length)
		body.set(head)
		body.set(data, head.length)
	}
	return new Response(body, { headers: { 'CF-R2-Metadata-Size': '' + head.length } })
}
, missing = () => new Response(null, { status: 404, headers: {
	'CF-R2-Error': JSON.stringify({ version: 1, v4code: 10007, message: 'The specified key does not exist.' })
} })

export default {
	async fetch(req) {
		var header = req.headers.get('cf-r2-request')
		, metaSize = +req.headers.get('cf-r2-metadata-size')
		, bytes = header ? null : new Uint8Array(await req.arrayBuffer())
		, op = JSON.parse(header || dec.decode(bytes.subarray(0, metaSize)))
		, data = bytes && bytes.subarray(metaSize)
		switch (op.method) {
		case 'put':
			var rec = {
				data,
				size: data.length,
				etag: (await sha('e' + op.object + data.length)).slice(0, 32),
				version: (await sha('v' + op.object + Date.now())).slice(0, 32),
				uploaded: Date.now(),
				httpFields: op.httpFields,
				customFields: op.customFields,
			}
			store.set(op.object, rec)
			return reply(metaOf(op.object, rec))
		case 'get':
		case 'head':
			var o = store.get(op.object)
			return o ? reply(metaOf(op.object, o), op.method === 'get' ? o.data : null) : missing()
		case 'delete':
			;[].concat(op.object || op.objects || []).forEach(k => store.delete(k))
			return new Response(null)
		case 'list':
			var objects = []
			for (var [k, v] of store) if (!op.prefix || k.startsWith(op.prefix)) objects.push(metaOf(k, v))
			return reply({ objects, truncated: false, delimitedPrefixes: [] })
		default:
			return missing()
		}
	}
}
