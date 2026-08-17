
import { worker } from './worker.mjs'


var listen = (app, env = {}) => {
	var handle = worker(app, env)
	addEventListener('fetch', event => event.respondWith(handle(event.request)))
}
, Server = listen


export * from './default.mjs'
export { Server, listen, worker }

