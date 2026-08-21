
import { worker } from './worker.mjs'


var serve = (app, env = {}) => {
	var handle = worker(app, env)
	addEventListener('fetch', event => event.respondWith(handle(event.request)))
}
, Server = serve


export * from './default.mjs'
export { Server, serve, worker }

