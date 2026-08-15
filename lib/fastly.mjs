
import { worker } from './worker.mjs'

export { DurableObject } from './default.mjs'

var listen = (app, env = {}) => {
	var handle = worker(app, env)
	addEventListener('fetch', event => event.respondWith(handle(event.request)))
}
, Server = listen

export { Server, listen, worker }

