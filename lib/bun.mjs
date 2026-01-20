
import { worker } from './worker.mjs'


var listen = (app, env = {}) => {
	var server = Bun.serve({
		port: +env.PORT || 8080,
		hostname: env.BIND_ADDR || '0.0.0.0',
		fetch: worker(app, env),
	})
	server.name = env.SERVER_NAME
	console.log('Listening', server.name)
	return server
}


export * from './env.mjs'
export { listen }

