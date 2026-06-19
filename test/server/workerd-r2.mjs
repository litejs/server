
// R2-protocol shim for plain workerd, backed by workerd's internal Durable Object

import { DurableObject } from "cloudflare:workers"

var enc = new TextEncoder()
, dec = new TextDecoder()
, hex = buf => Array.from(new Uint8Array(buf), c => (c < 16 ? '0' : '') + c.toString(16)).join('')
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
, rowMeta = row => ({
	size: row.size,
	etag: row.etag,
	version: row.version,
	uploaded: row.uploaded,
	httpFields: JSON.parse(row.http),
	customFields: JSON.parse(row.custom),
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

export class R2Store extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env)
		this.sql = ctx.storage.sql
		this.sql.exec('CREATE TABLE IF NOT EXISTS r2 (key TEXT PRIMARY KEY, data BLOB, size INTEGER, etag TEXT, version TEXT, uploaded INTEGER, http TEXT, custom TEXT)')
	}
	async fetch(req) {
		var sql = this.sql
		, header = req.headers.get('cf-r2-request')
		, metaSize = +req.headers.get('cf-r2-metadata-size')
		, bytes = header ? null : new Uint8Array(await req.arrayBuffer())
		, op = JSON.parse(header || dec.decode(bytes.subarray(0, metaSize)))
		, data = bytes && bytes.subarray(metaSize)
		switch (op.method) {
		case 'put':
			var rec = {
				size: data.length,
				etag: (await sha('e' + op.object + data.length)).slice(0, 32),
				version: (await sha('v' + op.object + Date.now())).slice(0, 32),
				uploaded: Date.now(),
				httpFields: op.httpFields,
				customFields: op.customFields,
			}
			sql.exec(
				'INSERT OR REPLACE INTO r2 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
				op.object, data.slice().buffer, rec.size, rec.etag, rec.version, rec.uploaded,
				JSON.stringify(rec.httpFields || {}), JSON.stringify(rec.customFields || [])
			)
			return reply(metaOf(op.object, rec))
		case 'get':
		case 'head':
			var row = sql.exec('SELECT * FROM r2 WHERE key=?', op.object).toArray()[0]
			return row ? reply(metaOf(op.object, rowMeta(row)), op.method === 'get' ? new Uint8Array(row.data) : null) : missing()
		case 'delete':
			;[].concat(op.object || op.objects || []).forEach(k => sql.exec('DELETE FROM r2 WHERE key=?', k))
			return new Response(null)
		case 'list':
			var rows = op.prefix
				? sql.exec('SELECT * FROM r2 WHERE key LIKE ?', op.prefix + '%').toArray()
				: sql.exec('SELECT * FROM r2').toArray()
			return reply({ objects: rows.map(r => metaOf(r.key, rowMeta(r))), truncated: false, delimitedPrefixes: [] })
		default:
			return missing()
		}
	}
}

export default {
	fetch: (req, env) => env.R2_DO.getByName('r2').fetch(req)
}

