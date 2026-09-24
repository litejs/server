
// Shared by Cloudflare DurableObject and the local shim; #runtime resolves accordingly

import { isArr } from '../util.mjs'
import { DurableObject, WebSocketServer } from '#runtime'
import { toHandler } from './serve.mjs'
import { wsEvent } from './ws.mjs'


// Sync migrate for sqlite-backed D1 and Durable Object sql
var migrate = (db, schema, migrations_table = '_migrations') => {
	if (isArr(schema)) {
		db.exec('CREATE TABLE IF NOT EXISTS ' + migrations_table + ' (id INTEGER PRIMARY KEY, applied_at DATETIME)')
		var q = 'SELECT COUNT(id) AS v FROM ' + migrations_table
		, i = (db.prepare?.(q).get() || db.exec(q).one()).v
		for (; i < schema.length; ) {
			db.exec(schema[i++])
			db.exec('INSERT INTO ' + migrations_table + ' (id, applied_at) VALUES (' + i + ", '" + new Date().toJSON() + "')")
		}
	}
}
, HANDLER = Symbol()
, dispatch = (wsDo, ev, ws, ...args) => wsEvent(wsDo.constructor.ws[wsDo.ctx.getTags(ws)[0]], ev, ws, ...args, wsDo.env, wsDo.ctx)

class DO extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env)
		migrate(ctx.storage.sql, this.constructor.schema)
	}
}

class WebSocketDO extends DO {
	fetch(req) {
		var wsDo = this
		, constr = wsDo.constructor
		return (constr[HANDLER] ??= toHandler(WebSocketServer(constr.ws, constr.app)))(req, wsDo.env, wsDo.ctx)
	}
	webSocketMessage(ws, data) { return dispatch(this, 'message', ws, data) }
	webSocketClose(ws, code, reason) { return dispatch(this, 'close', ws, code, reason) }
	webSocketError(ws, error) { return dispatch(this, 'error', ws, error) }
}

export { DO, WebSocketDO, migrate }

