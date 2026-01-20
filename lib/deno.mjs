
import { worker } from './worker.mjs'


var listen = (app, env = {}) => {
	var server = Deno.serve({
		port: +env.PORT || 8080,
		hostname: env.BIND_ADDR || '0.0.0.0',
	}, worker(app, env))
	server.name = env.SERVER_NAME
	return server
}


export * from './env.mjs'
export { listen }

