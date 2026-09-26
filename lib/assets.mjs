
// Static files that live inside the bundle, for runtimes without a disk.

var mime = {
	html: 'text/html; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8',
	json: 'application/json',
	txt: 'text/plain; charset=utf-8',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	ico: 'image/x-icon',
	wasm: 'application/wasm'
}
// Self-contained new URL: env.ASSETS.fetch may be called with new Request
, decodePath = req => decodeURIComponent(new URL(req.url).pathname).slice(1) || 'index.html'
, serveAssets = (files, {
	defaultMime = 'application/octet-stream',
	notFound = () => 404,
} = {}) => ({
	fetch(req) {
		var file = decodePath(req)
		, body = files[file]
		return body == null ? notFound() : new Response(body, { headers: {
			'content-type': mime[file.split('.').pop().toLowerCase()] || defaultMime
		}})
	}
})

mime.jpeg = mime.jpg
mime.mjs = mime.js

export { decodePath, mime, serveAssets }

