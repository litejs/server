
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isArr, isFn } from '../util.mjs'


var loadEnv = (file, rest) => {
	var env = {
		BIND_ADDR: '0.0.0.0',
		HOSTNAME: '127.0.0.1',
		PORT: 8080,
		...(file && JSON.parse(readFileSync(file, 'utf8'))),
		...process.env,
	}
	return {
		SERVER_NAME: 'http://' + env.HOSTNAME + ':' + env.PORT,
		...env,
		...rest,
	}
}
, readFiles = (dir, root = process.cwd(), ext = '') =>
	readdirSync(join(root, dir)).filter(f => f.endsWith(ext)).sort().map(f => readFileSync(join(root, dir, f), 'utf8'))
, setupShutdown = (servers, opts = {}) => {
	var exiting = false
	, shutdown = code => {
		process.exitCode = code
		;(isArr(servers) ? servers : [servers]).forEach(server => {
			try {
				// Node exposes close(), Bun stop(), Deno shutdown()
				var stop = server.close || server.stop || server.shutdown
				console.log('Closing', server.name || 'server')
				stop?.call(server)
				server.unref?.()
			} catch {}
		})
		var timer = setTimeout(() => {
			console.log('Kill (timeout)')
			process.exit(code)
		}, opts.exitTime || 30000)
		isFn(timer.unref) ? timer.unref() : globalThis.Deno?.unrefTimer(timer)
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
		opts.onReload?.()
	})
}

export * from './shim-cloudflare.mjs'
export { Database as DB } from '#sqlite'
export { loadEnv, readFiles, setupShutdown }
export { serveStatic } from './static.mjs'

