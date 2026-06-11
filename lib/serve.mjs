
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
, header = (req, name) => req?.headers?.get(name) || ''
, parseRange = (header, size) => {
	var m = /^bytes=(\d*)-(\d*)$/.exec(header || '') || 0
	, start = m[1] ? +m[1] : size - +m[2]
	, end = m[1] && m[2] ? +m[2] : size - 1
	if (start >= 0 && start <= end && end < size) return { start, end }
}
// Honor a single `bytes=` Range on a 200 response with a known length; anything
// else (invalid/unsatisfiable ranges, If-Range validators) serves the full body.
, serveRange = async (req, res) => {
	res = await res
	var size = !header(res, 'content-range') && +header(res, 'content-length')
	, range = res.status === 200 && size > 0 && !header(req, 'if-range') && parseRange(header(req, 'range'), size)
	if (!range) return res
	var headers = new Headers(res.headers)
	headers.set('content-range', 'bytes ' + range.start + '-' + range.end + '/' + size)
	headers.set('content-length', '' + (range.end - range.start + 1))
	return new Response((await res.arrayBuffer()).slice(range.start, range.end + 1), { status: 206, headers })
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


export { header, mime, parseRange, serveRange, serveStatic }

