
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

export default app

