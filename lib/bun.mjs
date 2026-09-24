
import { Database as DB } from 'bun:sqlite'
import { httpsRedirect, localServer, readCert } from './env.mjs'
import { toHandler } from './serve.mjs'


var serve = (app, env = {}) => {
	var http, https
	, handler = toHandler(app, env)
	, tlsOpt = readCert(env)
	, listen = (port, fetch, tlsOpt) => Bun.serve({
		port, hostname: env.BIND_ADDR || '0.0.0.0', fetch, tls: tlsOpt
	})

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
			http?.stop()
			https?.stop()
		},
		reload() {
			https?.reload({ tls: readCert(env) })
		},
	}
}
, Server = localServer(serve)


export * from './env.mjs'
export { DB, Server, serve }

