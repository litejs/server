
import { worker } from './worker.mjs'


var listen = (app, env = {}) => {
	var cf = worker(app, env)

	addEventListener('install', () => skipWaiting())
	addEventListener('activate', (event) => event.waitUntil(clients.claim()))
	addEventListener('fetch', (event) => event.respondWith(cf(event.request)))
}
// Cache-first asset handler: the service-worker counterpart to the filesystem
// serveStatic, with the same { fetch } (CF ASSETS binding) shape.
, serveCache = (cacheName = 'static') => ({
	async fetch(req) {
		var cache = await caches.open(cacheName)
		return await cache.match(req) || fetch(req).then((res) => {
			if (res.ok) cache.put(req, res.clone())
			return res
		})
	}
})


export { listen, serveCache }

