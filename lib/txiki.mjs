
import path from 'tjs:path'
import { Database } from 'tjs:sqlite'
import { staticFrom, toHandler } from './serve.mjs'
import { isStr } from '../util.mjs'
import { UPGRADE, wsHandlers } from './ws.mjs'


var { resolve, sep } = path
, cwd = () => tjs.cwd()
, stat = async file => {
	var st = await tjs.stat(file)
	return { isFile: st.isFile, size: st.size }
}
, body = file => tjs.readFile(file)
, remove = file => { tjs.remove(file).catch(() => {}) }
, serveStatic = staticFrom({ body, cwd, resolve, sep, stat })
, env = { ...tjs.env }
, serve = (app, env) => {
	var handle = toHandler(app, env)
	, port = +env.PORT || 8080
	, name = env.SERVER_NAME || 'http://' + (env.HOSTNAME || '127.0.0.1') + ':' + port
	, server = tjs.serve({
		fetch: (req, info) => (req[UPGRADE] = info.server, handle(req)),
		websocket: wsHandlers(
			ws => (ws.readyState = 1, ws.send = data => isStr(data) ? ws.sendText(data) : ws.sendBinary(data)),
			ws => ws.readyState = 3
		),
		hostname: env.BIND_ADDR || '0.0.0.0',
		port,
	})
	console.log('Listening', name)

	return {
		name,
		close() {
			server.close?.()
		},
	}
}
, Server = app => serve(app, env)

// tjs:sqlite is close to node:sqlite, two differences:
//  - run() returns undefined instead of { changes, lastInsertRowid }
//  - named parameters bind as $name, not :name
class DB extends Database {
	prepare(sql) {
		var stmt = super.prepare(sql)
		stmt.get || (stmt.get = (...binds) => stmt.all(...binds)[0])
		return stmt
	}
}


export { createHash } from 'tjs:hashing'
export { DurableObject } from './do-base.mjs'
export { WebSocketClient, unrefTimeout } from './default.mjs'
export { serveRange } from './serve.mjs'
export { WebSocketServer } from './ws.mjs'
export {
	body, cwd, env, remove, resolve, sep, stat,
	DB, Server, serve, serveStatic,
}

