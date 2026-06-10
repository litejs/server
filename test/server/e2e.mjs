
// End-to-end smoke test: launch the real per-runtime servers and make requests.

import '@litejs/cli/test.js'
import { command } from '@litejs/cli'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

var cwd = dirname(fileURLToPath(import.meta.url))
, port = 8081
, base = 'http://127.0.0.1:' + port
, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
, get = async (path, timeout = 1000) => {
	var ac = new AbortController()
	, timer = setTimeout(() => ac.abort(), timeout)
	try {
		return await fetch(base + path, { signal: ac.signal })
	} finally {
		clearTimeout(timer)
	}
}

describe('e2e {0} ' + base, [
	[ 'node', process.execPath, 'run:node', 10000 ],
	[ 'bun', 'bun', 'run:bun', 10000 ],
	[ 'deno', 'deno', 'run:deno', 10000 ],
	[ 'workerd', cwd + '/node_modules/.bin/workerd', 'run:workerd', 20000 ],
	[ 'wrangler', 'wrangler', 'run:wrangler', 60000 ],
], (name, cmd, script, bootTime) => {

	describe(name, command(cmd) && (() => {
		var child
		test('start', async assert => {
			assert.setTimeout(bootTime)
			child = spawn('npm', ['run', '--silent', script], { cwd, detached: true })
			var errors = ''
			child.stderr.on('data', d => errors += d)
			var deadline = Date.now() + bootTime
			// Stop polling as soon as the launcher exits, so a failed build or a
			// missing binary surfaces its stderr instead of a bare timeout.
			while (Date.now() < deadline && child.exitCode === null) {
				try { return await get('/') } catch { await sleep(100) }
			}
			throw new Error('server did not respond\n' + errors)
		})
		test('run', async assert => {
			assert.setTimeout(5000)
			// Dynamic route.
			var info = await (await get('/info')).json()
			assert.equal(info.path, '/info', 'GET /info body')

			// Static file: serveStatic (node/bun/deno) or the assets binding (cloudflare).
			var res = await get('/')
			, html = await res.text()
			assert.equal(res.status, 200, 'GET / status')
			assert.ok(html.includes('LiteJS Test Server'), 'GET / serves index.html')

			// KV round-trip: PUT stores a random value, GET reads the same back.
			var value = 'kv-' + Math.random().toString(36).slice(2)
			, put = await fetch(base + '/kv', { method: 'PUT', body: value })
			assert.equal(put.status, 204, 'PUT /kv status')
			var kv = await (await get('/kv')).json()
			assert.equal(kv.value, value, 'GET /kv returns the stored value')

			// Durable Object round-trip: each POST /counter increments persistent state.
			var c1 = await (await fetch(base + '/counter', { method: 'POST' })).json()
			, c2 = await (await fetch(base + '/counter', { method: 'POST' })).json()
			assert.equal(c2.value, c1.value + 1, 'POST /counter increments')
			var read = await (await get('/counter')).json()
			assert.equal(read.value, c2.value, 'GET /counter reads stored value')

		})
		test('stop', async assert => {
			assert.setTimeout(bootTime)
			// A server that crashed on startup has already exited; only signal a live one.
			if (child && child.exitCode === null && child.signalCode === null) {
				// SIGTERM the whole group first so wrangler can tear down its workerd child
				// cleanly (SIGKILL would orphan it). Force-kill the group only if it hangs.
				try { process.kill(-child.pid, 'SIGTERM') } catch {}
				await Promise.race([
					new Promise(resolve => child.once('exit', resolve)),
					new Promise(resolve => setTimeout(resolve, 8000)),
				])
				try { process.kill(-child.pid, 'SIGKILL') } catch {}
			}
			// Poll until the port stops answering, so the next runtime can bind it.
			var deadline = Date.now() + 4000
			while (Date.now() < deadline) {
				try { await (await get('/info')).text(); await sleep(100) } catch { break }
			}
		})
	}))
})

