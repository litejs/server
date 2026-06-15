
// End-to-end smoke test: launch the real per-runtime servers and make requests.

import '@litejs/cli/test.js'
import { command } from '@litejs/cli'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

// Surface local .env.json values (S3 creds, PORT) to spawned runtimes — workerd
// only sees them via fromEnvironment bindings, not the file that run.mjs reads.
// On CI the file is absent and these already come from the job environment.
try {
	var localEnv = JSON.parse(readFileSync(cwd + '/.env.json', 'utf8'))
	for (var k in localEnv) process.env[k] ??= '' + localEnv[k]
} catch {}

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
			// TODO: if an unrelated HTTP server is already on `port`, this passes
			// against it (we only check for a response, not that it's our child).
			// Headroom over the poll deadline so the framework timeout never races
			// the throw below into a confusing "ended multiple times".
			assert.setTimeout(bootTime + 2000)
			// node/bun/deno read PORT from env; workerd/wrangler ignore it and use
			// their own config. Pass it so every runtime binds the port we probe.
			child = spawn('npm', ['run', '--silent', script], {
				cwd, detached: true,
				env: { ...process.env, PORT: '' + port },
			})
			var output = ''
			child.stdout.on('data', d => output += d)
			child.stderr.on('data', d => output += d)
			child.on('error', err => output += '\nspawn error: ' + err)
			var deadline = Date.now() + bootTime
			// Stop polling as soon as the launcher exits, so a failed build or a
			// missing binary surfaces its output instead of a bare timeout.
			while (Date.now() < deadline && child.exitCode === null) {
				try { return await get('/') } catch { await sleep(100) }
			}
			// Let the child's dying stdout/stderr flush before we report it.
			await sleep(100)
			throw new Error(
				(child.exitCode === null ? 'server did not respond' : 'server exited with code ' + child.exitCode)
				+ '\n' + output
			)
		})
		test('GET /', async assert => {
			// Static file: serveStatic (node/bun/deno) or the assets binding (cloudflare).
			var res = await get('/')
			, html = await res.text()
			assert.equal(res.status, 200, 'GET / status')
			assert.ok(html.includes('LiteJS Test Server'), 'GET / serves index.html')
		})
		test('GET /info', async assert => {
			// Dynamic route.
			var info = await (await get('/info')).json()
			assert.equal(info.path, '/info', 'GET /info body')
		})
		test('GET /kv', async assert => {
			// KV round-trip: PUT stores a random value, GET reads the same back.
			var value = 'kv-' + Math.random().toString(36).slice(2)
			, put = await fetch(base + '/kv', { method: 'PUT', body: value })
			assert.equal(put.status, 204, 'PUT /kv status')
			var kv = await (await get('/kv')).json()
			assert.equal(kv.value, value, 'GET /kv returns the stored value')

		})
		test('GET /counter', async assert => {
			// Durable Object round-trip: each POST /counter increments persistent state.
			var c1 = await (await fetch(base + '/counter', { method: 'POST' })).json()
			, c2 = await (await fetch(base + '/counter', { method: 'POST' })).json()
			assert.equal(c2.value, c1.value + 1, 'POST /counter increments')
			var read = await (await get('/counter')).json()
			assert.equal(read.value, c2.value, 'GET /counter reads stored value')

		})
		test('GET /s3', async assert => {
			assert.setTimeout(20000)
			// S3 round-trip — real network to AWS (three round-trips), so allow generous time.
			var probe = await (await get('/s3', 10000)).json()
			if (probe.configured) {
				var s3val = 's3-' + Math.random().toString(36).slice(2)
				, s3put = await fetch(base + '/s3', { method: 'PUT', body: s3val })
				assert.equal(s3put.status, 204, 'PUT /s3 status')
				var s3read = await (await get('/s3', 10000)).json()
				assert.equal(s3read.value, s3val, 'GET /s3 returns the stored value')
			}

		})
		test('GET /r2', async assert => {
			// R2 round-trip — every runtime that has an R2 binding wired (shim or native).
			var r2probe = await (await get('/r2')).json()
			if (r2probe.configured) {
				var r2val = 'r2-' + Math.random().toString(36).slice(2)
				, r2put = await fetch(base + '/r2', { method: 'PUT', body: r2val })
				assert.equal(r2put.status, 204, 'PUT /r2 status')
				var r2read = await (await get('/r2')).json()
				assert.equal(r2read.value, r2val, 'GET /r2 returns the stored value')
			}
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
			// The next runtime reuses the port, so require it to actually stop answering.
			var stopped = false
			, deadline = Date.now() + 4000
			while (!stopped && Date.now() < deadline) {
				try { await (await get('/info')).text(); await sleep(100) } catch { stopped = true }
			}
			assert.ok(stopped, 'server stopped, port is free')
		})
	}))
})

