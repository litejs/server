
import { createServer } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { pipeline, Readable } from 'node:stream'
import { httpsRedirect, localServer, readCert } from './env.mjs'
import { toHandler } from './serve.mjs'
import { upgrade } from './node-ws.mjs'
import { UPGRADE, wsServer } from './ws.mjs'


var serve = (app, env = {}) => {
	var http, https
	, httpRe = /^https?:\/\//i
	, tlsOpt = readCert(env)
	, toRequest = req => {
		var method = req.method
		, proto = req.socket.encrypted ? 'https' : 'http'
		// A target is absolute path (origin-form) or url (absolute-form).
		// Do not let `GET //evil.com/x` choose the authority.
		, url = req.url[0] === '/'
			? proto + '://' + (req.headers.host || /* c8 ignore next */ '127.0.0.1') + req.url
			: req.url
		// llhttp lets `file:` through and Request keeps it as an opaque origin.
		if (!httpRe.test(url)) throw 0
		return new Request(url, {
			method,
			headers: req.headers,
			body: method === 'GET' || method === 'HEAD' ? null : Readable.toWeb(req),
			duplex: 'half'
		})
	}
	, onRequest = fetch => async (req, res) => {
		try {
			var webReq = toRequest(req)
		} catch (e) {
			// A path or Host cannot form a url
			res.writeHead(400)
			return res.end()
		}
		var webRes = await fetch(webReq)

		res.writeHead(webRes.status, { ...Object.fromEntries(webRes.headers), 'set-cookie': webRes.headers.getSetCookie() })
		if (!webRes.body) return res.end()
		pipeline(Readable.fromWeb(webRes.body), res, () => {})
	}
	, onUpgrade = fetch => async (req, socket, head) => {
		try {
			var webReq = toRequest(req)
		} catch (e) {
			return socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
		}
		var up = webReq[UPGRADE] = { socket, head }
		, webRes = await fetch(webReq)
		if (up.upgraded) return up.upgraded()
		socket.end(
			'HTTP/1.1 ' + webRes.status + ' ' + webRes.statusText + '\r\nconnection: close\r\n' +
			[...webRes.headers].map(([name, val]) => name + ': ' + val + '\r\n').join('') +
			'\r\n' + await webRes.text()
		)
	}
	, handler = toHandler(app, env)
	, listen = (port, fetch, tlsOpt) => (
		tlsOpt ? createSecureServer(tlsOpt, onRequest(fetch)) : createServer(onRequest(fetch))
	).on('upgrade', onUpgrade(fetch)).listen(port, env.BIND_ADDR || '0.0.0.0')

	if (tlsOpt) {
		https = listen(+env.HTTPS_PORT || /* c8 ignore next */ 8443, handler, tlsOpt)
		// Plain HTTP on PORT 301-redirects to HTTPS (set PORT=0 for HTTPS-only).
		if (+env.PORT) http = listen(+env.PORT, httpsRedirect(env))
	} else {
		http = listen(+env.PORT || /* c8 ignore next */ 8080, handler)
	}
	console.log('Listening', env.SERVER_NAME)

	return {
		name: env.SERVER_NAME,
		close() {
			http?.close().unref()
			https?.close().unref()
		},
		reload() {
			// Hot-swap key/cert for new TLS handshakes without a restart; live
			// connections keep the old cert. Wired to SIGHUP through setupShutdown.
			https?.setSecureContext(readCert(env))
		},
	}
}
, Server = localServer(serve)
, WebSocketServer = /* @__PURE__ */ wsServer(upgrade)


export * from './env.mjs'
export * from './node-sqlite.mjs'
export { Server, WebSocketServer, serve }

