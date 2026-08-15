
import { createServer } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { pipeline, Readable } from 'node:stream'
import { httpsRedirect, localServer, readCert, worker } from './env.mjs'


var listen = (app, env = {}) => {
	var http, https
	, httpRe = /^https?:\/\//i
	, tlsOpt = readCert(env)
	, onRequest = fetch => async (req, res) => {
		var webReq, webRes
		, isHead = req.method === 'HEAD'
		, method = isHead ? 'GET' : req.method
		, proto = req.socket.encrypted ? 'https' : 'http'
		// A target is absolute path (origin-form) or url (absolute-form).
		// Do not let `GET //evil.com/x` choose the authority.
		, url = req.url[0] === '/'
			? proto + '://' + (req.headers.host || /* c8 ignore next */ '127.0.0.1') + req.url
			: req.url

		try {
			// llhttp lets `file:` through and Request keeps it as an opaque origin.
			if (!httpRe.test(url)) throw 0
			webReq = new Request(url, {
				method,
				headers: req.headers,
				body: method !== 'GET' ? Readable.toWeb(req) : null,
				duplex: 'half'
			})
		} catch (e) {
			// A path or Host cannot form a url
			res.writeHead(400)
			return res.end()
		}
		webRes = await fetch(webReq, env)

		res.writeHead(webRes.status, Object.fromEntries(webRes.headers))
		if (isHead || !webRes.body) return res.end()
		pipeline(Readable.fromWeb(webRes.body), res, () => {})
	}
	, handler = onRequest(worker(app))
	, serve = (port, handler, tlsOpt) => (
		tlsOpt ? createSecureServer(tlsOpt, handler) : createServer(handler)
	).listen(port, env.BIND_ADDR || '0.0.0.0')

	if (tlsOpt) {
		https = serve(+env.HTTPS_PORT || /* c8 ignore next */ 8443, handler, tlsOpt)
		// Plain HTTP on PORT 301-redirects to HTTPS (set PORT=0 for HTTPS-only).
		if (+env.PORT) http = serve(+env.PORT, onRequest(httpsRedirect(env)))
	} else {
		http = serve(+env.PORT || /* c8 ignore next */ 8080, handler)
	}
	console.log('Listening', env.SERVER_NAME)

	return {
		name: env.SERVER_NAME,
		close() {
			http && http.close().unref()
			https && https.close().unref()
		},
		reload() {
			// Hot-swap key/cert for new TLS handshakes without a restart; live
			// connections keep the old cert. Wired to SIGHUP through setupShutdown.
			https && https.setSecureContext(readCert(env))
		},
	}
}
, Server = localServer(listen)


export * from './env.mjs'
export { Server, listen }

