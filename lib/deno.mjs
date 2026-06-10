
import { worker } from './worker.mjs'
import { httpsRedirect, readCert } from './env.mjs'


var listen = (app, env = {}) => {
	var http, https
	, handler = worker(app, env)
	, tlsOpt = readCert(env)
	, serve = (port, fetch, tlsOpt) => Deno.serve({
		port, hostname: env.BIND_ADDR || '0.0.0.0', ...tlsOpt
	}, fetch)

	if (tlsOpt) {
		https = serve(+env.HTTPS_PORT || 8443, handler, tlsOpt)
		// Plain HTTP on PORT 301-redirects to HTTPS (set PORT=0 for HTTPS-only).
		if (+env.PORT) http = serve(+env.PORT, httpsRedirect(env))
	} else {
		http = serve(+env.PORT || 8080, handler)
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
			https && https.shutdown().then(() => https = serve(+env.HTTPS_PORT || 8443, handler, readCert(env)))
		},
	}
}


export * from './env.mjs'
export { listen }
