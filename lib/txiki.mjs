
import { worker } from './worker.mjs'
import { serveStatic } from './serve.mjs'

export * from './shim-cloudflare.mjs'
export { Database as DB } from '#sqlite'
export { serveRange, serveStatic } from './serve.mjs'

var listen = (app, env = {}) => {
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
	return listen(app)
}


export { Server, listen, worker }

