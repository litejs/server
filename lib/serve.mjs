
import { header } from '../util.mjs'
import { mime } from './assets.mjs'


var parseRange = (header, size) => {
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
	, range = res.body && res.status === 200 && size > 0 && !header(req, 'if-range') && parseRange(header(req, 'range'), size)
	if (!range) return res
	var headers = new Headers(res.headers)
	headers.set('content-range', 'bytes ' + range.start + '-' + range.end + '/' + size)
	headers.set('content-length', '' + (range.end - range.start + 1))
	return new Response((await res.arrayBuffer()).slice(range.start, range.end + 1), { status: 206, headers })
}
, staticFrom = ({ body, cwd, resolve, sep, stat: fsStat }) => (baseDir = cwd(), {
	blockRe = /\/\.(?!well-known\/)/,
	defaultMime = 'application/octet-stream',
	notFound = () => 404,
} = {}) => {
	var root = resolve(baseDir) + sep

	return {
		async fetch(req) {
			try {
				// Self-contained: env.ASSETS.fetch may be called with new Request
				var pathname = decodeURIComponent(new URL(req.url).pathname)
				, file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
				, ext = file.split('.').pop().toLowerCase()
				, stat = file.startsWith(root) && !blockRe.test(pathname) && await fsStat(file)

				// A stream on node, a promise of bytes on txiki — await covers both.
				if (stat && stat.isFile) {
					return new Response(await body(file), { headers: {
						'content-length': stat.size,
						'content-type': mime[ext] || defaultMime
					}})
				}
			} catch {}
			return notFound()
		}
	}
}


export { header, mime, parseRange, serveRange, staticFrom }

