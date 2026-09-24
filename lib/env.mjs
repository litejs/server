
import { createReadStream, promises, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import timers from 'node:timers'
import { isArr } from '../util.mjs'
import { staticFrom } from './serve.mjs'
import { wsClient } from './ws.mjs'


var cwd = () => process.cwd()
, unrefTimeout = (...args) => timers.setTimeout(...args).unref()
, remove = file => rmSync(file, { force: true })
, stat = async file => {
	var st = await promises.stat(file)
	return { isFile: st.isFile(), size: st.size }
}
, body = file => Readable.toWeb(createReadStream(file))
, serveStatic = staticFrom({ body, cwd, resolve, sep, stat })
, env = { BIND_ADDR: '0.0.0.0', HOSTNAME: '127.0.0.1', PORT: 8080 }
, loadEnv = file => {
	Object.assign(env, file && JSON.parse(readFileSync(file, 'utf8')), process.env)
	// The canonical origin: https when HTTPS is configured, plain http otherwise.
	env.SERVER_NAME ||= env.HTTPS_KEY && env.HTTPS_CERT ?
		'https://' + env.HOSTNAME + ':' + (+env.HTTPS_PORT || 8443) :
		'http://' + env.HOSTNAME + ':' + env.PORT
}
, readFiles = (dir, root = process.cwd(), ext = '') =>
	readdirSync(join(root, dir)).filter(f => f.endsWith(ext)).sort().map(f => readFileSync(join(root, dir, f), 'utf8'))
, readCert = env => env.HTTPS_KEY && env.HTTPS_CERT && {
	key: env.HTTPS_KEY[0] === '-' ? env.HTTPS_KEY : readFileSync(env.HTTPS_KEY, 'utf8'),
	cert: env.HTTPS_CERT[0] === '-' ? env.HTTPS_CERT : readFileSync(env.HTTPS_CERT, 'utf8'),
}
, httpsRedirect = env => req => {
	var url = new URL(req.url)
	url.protocol = 'https:'
	url.port = +env.HTTPS_PORT === 443 ? '' : env.HTTPS_PORT || 8443
	return Response.redirect(url, 301)
}
, setupShutdown = (servers, opts = {}) => {
	var exiting = false
	, shutdown = code => {
		process.exitCode = code
		;(isArr(servers) ? servers : [servers]).forEach(server => {
			try {
				// Every adapter's serve() returns a uniform { name, close } controller.
				console.log('Closing', server.name || 'server')
				server.close?.()
			} catch {}
		})
		unrefTimeout(() => {
			console.log('Kill (timeout)')
			process.exit(code)
		}, opts.exitTime || 30000)
	}

	process.on('uncaughtException', e => {
		console.log('\nUNCAUGHT EXCEPTION!\n' + (e.stack || (e.name || 'Error') + ': ' + (e.message || e)))
		shutdown(1)
	})

	process.on('SIGINT', () => {
		if (exiting) {
			console.log('\nKilling from SIGINT (got Ctrl-C twice)')
			return process.exit()
		}
		exiting = true
		console.log('\nGracefully shutting down from SIGINT (Ctrl-C)')
		shutdown(0)
	})

	process.on('SIGTERM', () => {
		console.log('Gracefully shutting down from SIGTERM (kill)')
		shutdown(0)
	})

	process.on('SIGHUP', () => {
		console.log('Reloading from SIGHUP')
		;(isArr(servers) ? servers : [servers]).forEach(server => server.reload?.())
		opts.onReload?.()
	})
}
, WebSocketClient = /* @__PURE__ */ wsClient(unrefTimeout)
, localServer = serve => app => {
	loadEnv()
	var server = serve(app, env)
	setupShutdown([ server ], { exitTime: env.EXIT_TIME })
	return server
}

export { createHash } from 'node:crypto'
export { DurableObject } from './do-base.mjs'
export { serveRange } from './serve.mjs'
export {
	body, cwd, env, remove, resolve, sep, stat,
	httpsRedirect, loadEnv, localServer, readCert, readFiles, serveStatic, setupShutdown, unrefTimeout,
	WebSocketClient,
}

