
import { httpsRedirect, localServer, readCert, worker } from './env.mjs'


var serve = (app, env = {}) => {
	var http, https
	, handler = worker(app, env)
	, tlsOpt = readCert(env)
	, listen = (port, fetch, tlsOpt) => Deno.serve({
		port, hostname: env.BIND_ADDR || '0.0.0.0', ...tlsOpt
	}, fetch)

	if (tlsOpt) {
		https = listen(+env.HTTPS_PORT || 8443, handler, tlsOpt)
		// Plain HTTP on PORT 301-redirects to HTTPS (set PORT=0 for HTTPS-only).
		if (+env.PORT) http = listen(+env.PORT, httpsRedirect(env))
	} else {
		http = listen(+env.PORT || 8080, handler)
	}
	console.log('Listening', env.SERVER_NAME)

	return {
		name: env.SERVER_NAME,
		close() {
			http && http.shutdown()
			https && https.shutdown()
		},
		reload() {
			// Deno cannot hot-swap certs; drain the TLS listener and rebind with fresh ones.
			https && https.shutdown().then(() => https = listen(+env.HTTPS_PORT || 8443, handler, readCert(env)))
		},
	}
}
, Server = localServer(serve)


export * from './env.mjs'
export { DatabaseSync as DB } from 'node:sqlite'
export { Server, serve }

