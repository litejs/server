
import path from 'tjs:path'
import { Database } from 'tjs:sqlite'
import { worker } from './worker.mjs'
import { staticFrom } from './serve.mjs'


var { resolve, sep } = path
, cwd = () => tjs.cwd()
, stat = async file => {
	var st = await tjs.stat(file)
	return { isFile: st.isFile, size: st.size }
}
, body = file => tjs.readFile(file)
, remove = file => { tjs.remove(file).catch(() => {}) }
, serveStatic = staticFrom({ body, cwd, resolve, sep, stat })
, listen = (app, env = {}) => {
	var handle = worker(app, env)
	, port = +env.PORT || +tjs.env.PORT || 8080
	, name = env.SERVER_NAME || 'http://' + (env.HOSTNAME || tjs.env.HOSTNAME || '127.0.0.1') + ':' + port
	, server = tjs.serve({
		fetch: handle,
		hostname: env.BIND_ADDR || tjs.env.BIND_ADDR || '0.0.0.0',
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
, Server = (app, dir) => {
	if (dir) app.get('{path*}', serveStatic(dir).fetch)
	listen(app)
}

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
export { serveRange } from './serve.mjs'
export { body, cwd, remove, resolve, sep, stat }
export { DB, Server, listen, serveStatic, worker }

