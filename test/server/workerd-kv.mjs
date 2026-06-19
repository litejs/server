
// KV-protocol shim for plain workerd, backed by workerd's internal Durable Object

import { DurableObject } from "cloudflare:workers"

export class KvStore extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env)
		this.sql = ctx.storage.sql
		this.sql.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)')
	}
	async fetch(req) {
		var key = new URL(req.url).pathname
		switch (req.method) {
		case 'PUT':
			this.sql.exec('INSERT OR REPLACE INTO kv VALUES (?, ?)', key, await req.text())
			return new Response()
		case 'DELETE':
			return new Response(null, { status: this.sql.exec('DELETE FROM kv WHERE key=?', key).rowsWritten ? 200 : 404 })
		default:
			var row = this.sql.exec('SELECT value FROM kv WHERE key=?', key).toArray()[0]
			return row ? new Response(row.value) : new Response(null, { status: 404 })
		}
	}
}

export default {
	fetch: (req, env) => env.KV_DO.getByName('kv').fetch(req)
}

