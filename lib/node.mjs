
import { createServer } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { Readable } from 'node:stream'
import { worker } from './worker.mjs'
import { httpsRedirect, readCert } from './env.mjs'


var listen = (app, env = {}) => {
	var http, https
	, tlsOpt = readCert(env)
	, onRequest = fetch => async (req, res) => {
		var isHead = req.method === 'HEAD'
		, method = isHead ? 'GET' : req.method
		, proto = req.socket.encrypted ? 'https' : 'http'
		, url = new URL(req.url, proto + '://' + (req.headers.host || /* c8 ignore next */ '127.0.0.1'))
		, webReq = new Request(url, {
			method,
			headers: req.headers,
			body: method !== 'GET' ? Readable.toWeb(req) : null,
			duplex: 'half'
		})
		, webRes = await fetch(webReq, env)

		res.writeHead(webRes.status, Object.fromEntries(webRes.headers))
		if (isHead || !webRes.body) return res.end()
		Readable.fromWeb(webRes.body).pipe(res)
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


export * from './env.mjs'
export { listen }
