
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
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	ico: 'image/x-icon',
	wasm: 'application/wasm'
}
, serveAssets = (files, {
	defaultMime = 'application/octet-stream',
	notFound = () => 404,
} = {}) => ({
	fetch(req) {
		var pathname = decodeURIComponent(new URL(req.url).pathname)
		, key = pathname === '/' ? '/index.html' : pathname
		, file = files[key]
		return file == null ? notFound() : new Response(file, { headers: {
			'content-type': mime[key.split('.').pop().toLowerCase()] || defaultMime
		}})
	}
})


export { mime, serveAssets }

