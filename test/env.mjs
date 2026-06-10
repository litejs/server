
import '@litejs/cli/test.js'
import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { httpsRedirect, readFiles, loadEnv, setupShutdown } from '../index.mjs'

var stubbable = typeof Bun === 'undefined' && typeof Deno === 'undefined'

describe('loadEnv', () => {
	test('merges layers and locks precedence: defaults < file < process.env < rest', (assert, mock) => {
		// Resolve tmpdir() before swapping process.env
		var file = join(tmpdir(), 'litejs-env-' + Date.now() + '.json')
		mock.swap(process, 'env', { PORT: 9090, ENV_ONLY: 'env', BOTH: 'env', ALL: 'env' })
		writeFileSync(file, JSON.stringify({ HOSTNAME: 'example.com', FILE_ONLY: 'file', BOTH: 'file', ALL: 'file' }))
		try {
			var env = loadEnv(file, { ALL: 'rest', EXTRA: 'rest-wins' })
			assert.equal(env.BIND_ADDR, '0.0.0.0', 'keeps defaults')
			assert.equal(env.PORT, 9090, 'process.env overrides defaults')
			assert.equal(env.HOSTNAME, 'example.com', 'file overrides defaults')
			assert.equal(env.SERVER_NAME, 'http://example.com:9090', 'SERVER_NAME uses the resolved host and port')
			assert.equal(env.FILE_ONLY, 'file', 'file is applied')
			assert.equal(env.ENV_ONLY, 'env', 'process.env is applied')
			assert.equal(env.BOTH, 'env', 'process.env overrides the file')
			assert.equal(env.ALL, 'rest', 'rest overrides process.env and the file')
			assert.equal(env.EXTRA, 'rest-wins', 'rest is applied')
		} finally {
			rmSync(file)
		}
		assert.end()
	})

	test('works without a file or overrides', (assert, mock) => {
		mock.swap(process, 'env', {})
		var env = loadEnv()
		assert.equal(env.BIND_ADDR, '0.0.0.0')
		assert.equal(env.HOSTNAME, '127.0.0.1')
		assert.equal(env.PORT, 8080)
		assert.equal(env.SERVER_NAME, 'http://127.0.0.1:8080')
		assert.end()
	})

	test('SERVER_NAME is the https origin when HTTPS is configured', (assert, mock) => {
		mock.swap(process, 'env', {})
		assert.equal(loadEnv(null, { HTTPS_KEY: 'k', HTTPS_CERT: 'c', HTTPS_PORT: 444 }).SERVER_NAME, 'https://127.0.0.1:444')
		assert.equal(loadEnv(null, { HTTPS_KEY: 'k', HTTPS_CERT: 'c' }).SERVER_NAME, 'https://127.0.0.1:8443', 'HTTPS_PORT defaults to 8443')
		assert.equal(loadEnv(null, { HTTPS_KEY: 'k' }).SERVER_NAME, 'http://127.0.0.1:8080', 'key alone does not switch the scheme')
		assert.end()
	})
})

describe('readFiles', () => {
	test('reads dir files sorted', (assert) => {
		var dir = 'server/migrations/test'
		, files = readFiles(dir, import.meta.dirname, '.sql')
		assert.equal(files.length, 2)
		assert.ok(/CREATE TABLE/.test(files[0]))
		assert.ok(/ALTER TABLE/.test(files[1]))

		assert.equal(readFiles(dir, import.meta.dirname, '.json').length, 0, 'no .json files match')
		assert.equal(readFiles(dir, import.meta.dirname).length, 2, 'empty ext reads every file')
		assert.end()
	})
})

describe('httpsRedirect', () => {
	test('301-redirects to https on HTTPS_PORT {0}', [
		[443, 'https://example.com/x?q=1'], // default https port is dropped from the url
		[8443, 'https://example.com:8443/x?q=1'],
		[undefined, 'https://example.com:8443/x?q=1'], // HTTPS_PORT defaults to 8443
	], (port, location, assert) => {
		var res = httpsRedirect({ HTTPS_PORT: port })(new Request('http://example.com/x?q=1'))
		assert.equal(res.status, 301)
		assert.equal(res.headers.get('location'), location)
		assert.end()
	})
})

describe('setupShutdown', () => {
	test('wires signal handlers that close servers', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		mock.time()
		var handlers = {}
		mock.swap(process, 'on', (name, fn) => { handlers[name] = fn })
		var exited = 0
		mock.swap(process, 'exit', () => { exited++ })

		var closed = 0
		, reloaded = 0
		, fakeServer = { close: () => (closed++, { unref() {} }), address: () => ({ address: '127.0.0.1', port: 18724 }) }

		setupShutdown([fakeServer], { onReload: () => { reloaded++ }, exitTime: 100 })

		// First SIGINT shuts down gracefully.
		handlers.SIGINT()
		assert.equal(closed, 1, 'SIGINT closes the server')
		// Second SIGINT force-exits without closing again.
		handlers.SIGINT()
		assert.equal(exited, 1, 'repeated SIGINT force-exits')
		assert.equal(closed, 1, 'repeated SIGINT does not re-close')

		handlers.SIGTERM()
		assert.equal(closed, 2, 'SIGTERM closes the server')

		handlers.uncaughtException(new Error('boom'))
		assert.equal(closed, 3, 'uncaughtException closes the server')

		// An error without a stack falls back to name/message formatting.
		handlers.uncaughtException({ message: 'no stack' })
		assert.equal(closed, 4, 'uncaughtException without a stack still shuts down')
		handlers.uncaughtException({ name: 'TypeError' })
		assert.equal(closed, 5, 'uncaughtException with only a name still shuts down')

		handlers.SIGHUP()
		assert.equal(reloaded, 1, 'SIGHUP triggers onReload')

		// The graceful-shutdown timeout eventually force-exits.
		mock.tick(100)
		assert.ok(exited > 1, 'shutdown timeout calls process.exit')
	})

	test('accepts a single server', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var handlers = {}
		mock.swap(process, 'on', (name, fn) => { handlers[name] = fn })
		var closed = 0
		setupShutdown({ close: () => (closed++, { unref() {} }), name: 'solo' })
		handlers.SIGTERM()
		assert.equal(closed, 1)
		handlers.SIGHUP()
		assert.equal(closed, 1, 'SIGHUP on a single server without reload() is a no-op')
	})

	test('swallows errors while closing a server', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var handlers = {}
		mock.swap(process, 'on', (name, fn) => { handlers[name] = fn })
		setupShutdown({ close: () => { throw new Error('close failed') }, address: () => null })
		handlers.SIGTERM()
		assert.ok(true, 'a throwing close does not crash shutdown')
	})

	test('SIGHUP reloads servers that expose reload()', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var handlers = {}
		mock.swap(process, 'on', (name, fn) => { handlers[name] = fn })
		var reloaded = 0
		// A server without reload() (e.g. plain HTTP) is skipped; one with it rotates.
		setupShutdown([{ close() {} }, { close() {}, reload: () => reloaded++ }])
		handlers.SIGHUP()
		assert.equal(reloaded, 1, 'reload() is called on servers that support it')
	})

	stubbable && test('falls back to Deno.unrefTimer for numeric timer ids', async (assert, mock) => {
		mock.swap(console, 'log', () => {})
		var handlers = {}
		mock.swap(process, 'on', (name, fn) => { handlers[name] = fn })
		mock.swap(globalThis, 'setTimeout', () => 42)
		var unreffed
		mock.swap(globalThis, 'Deno', { unrefTimer: (id) => { unreffed = id } })

		setupShutdown({ close() {} })
		handlers.SIGTERM()
		assert.equal(unreffed, 42, 'numeric timer ids are unref-ed via Deno.unrefTimer')
	})
})
