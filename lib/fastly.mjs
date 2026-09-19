
import { env } from './default.mjs'
import { toHandler } from './serve.mjs'


var serve = (app, env = {}) => {
	var handle = toHandler(app, env)
	addEventListener('fetch', event => event.respondWith(handle(event.request)))
}
, Server = app => serve(app, env)


export * from './default.mjs'
export { Server, serve }

