
import { App } from '../../index.mjs'

var app = App()

app.get('/info', (req) => {
	return {
		path: req.fullPath,
	}
})

app.put('/kv', async (req, env) => {
	await env.KV.put('e2e', await req.text())
	return { status: 204 }
})

app.get('/kv', async (req, env) => {
	return { value: await env.KV.get('e2e') }
})

// Durable Object round-trip: POST increments the counter, GET reads it back.
app.post('/counter', async (req, env) => {
	var stub = env.COUNTER.get(env.COUNTER.idFromName('e2e'))
	return { value: (await stub.increment()).val }
})

app.get('/counter', async (req, env) => {
	var stub = env.COUNTER.get(env.COUNTER.idFromName('e2e'))
	return { value: (await stub.getVal()).val }
})

// S3 round-trip: PUT stores a value to the real bucket, GET reads it back.
// env.S3 is wired only where credentials are configured (see run.mjs).
app.put('/s3', async (req, env) => {
	if (!env.S3) return { status: 501 }
	await env.S3.put('e2e.txt', await req.text(), { contentType: 'text/plain' })
	return { status: 204 }
})

app.get('/s3', async (req, env) => {
	if (!env.S3) return { configured: false }
	var obj = await env.S3.get('e2e.txt')
	return { configured: true, value: obj && await obj.text() }
})

// R2 round-trip: PUT stores a value, GET reads it back. env.R2 is the SQLite
// shim on node/bun/deno and the native binding on the Cloudflare runtimes.
app.put('/r2', async (req, env) => {
	if (!env.R2) return { status: 501 }
	await env.R2.put('e2e.txt', await req.text())
	return { status: 204 }
})

app.get('/r2', async (req, env) => {
	if (!env.R2) return { configured: false }
	var obj = await env.R2.get('e2e.txt')
	return { configured: true, value: obj && await obj.text() }
})

export default app

