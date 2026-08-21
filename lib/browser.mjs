
import { worker } from './worker.mjs'


var serve = (app, env = {}) => {
	var cf = worker(app, env)

	addEventListener('install', () => skipWaiting())
	addEventListener('activate', event => event.waitUntil(clients.claim()))
	addEventListener('fetch', event => event.respondWith(cf(event.request)))
}
, serveCache = (cacheName = 'static') => ({
	async fetch(req) {
		var cache = await caches.open(cacheName)
		return await cache.match(req) || fetch(req).then((res) => {
			if (res.ok) cache.put(req, res.clone())
			return res
		})
	}
})
, Server = serve


export * from './default.mjs'
export { Server, serve, serveCache, worker }

