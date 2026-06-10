
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'


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
, serveStatic = (baseDir = process.cwd(), { defaultMime = 'application/octet-stream' } = {}) => {
	var root = path.resolve(baseDir)
	, notFound = () => new Response(null, { status: 404 })

	return {
		async fetch(req) {
			try {
				// Self-contained: env.ASSETS.fetch may be called with new Request
				var pathname = decodeURIComponent(new URL(req.url).pathname)
				, file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))

				if (
					// Don't expose dotfiles
					/\/\.(?!well-known\/)/.test(pathname) ||
					// Keep the resolved path inside the served root
					!file.startsWith(root + path.sep)
				) return notFound()


				var stat = await fs.promises.stat(file)
				if (!stat.isFile()) return notFound()

				var ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
				, headers = {
					'content-length': '' + stat.size,
					'content-type': mime[ext] || defaultMime
				}

				return new Response(Readable.toWeb(fs.createReadStream(file)), { headers })
			} catch {
				return notFound()
			}
		}
	}
}


export { mime, serveStatic }

