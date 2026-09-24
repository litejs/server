
// txiki entrypoint. Same wiring as run.mjs, but built from what this runtime
// has: no loadEnv (sync filesystem), no setupShutdown, no node:os tmpdir. The
// env is assembled by hand and the DO directory is a fixed relative path that
// run:txiki creates.
//
// serve() rather than Server(), so the fixture hands its own env through
// instead of the shared one.

import {
	DB, KV, R2, S3, WebSocketServer, durableObject, serve, serveStatic
} from '../../index.mjs'
import app, { protocols } from './app.mjs'
import { Counter } from './counter.mjs'
import { Room } from './room.mjs'


const db = new DB(':memory:')
const doDir = 'build/do'
// tjs.env is this runtime's process.env; on CI the S3 values come from there.
const env = {
	...tjs.env,
	ASSETS: serveStatic('public'),
	KV: KV(db, 'kv'),
	R2: R2(db, 'r2'),
}
env.COUNTER = durableObject(Counter, doDir, env)
env.ROOM = durableObject(Room, doDir, env)
// Real S3 client, wired only when credentials are present.
if (env.S3_AWS_ID && env.S3_AWS_SECRET) env.S3 = S3({
	region: 'eu-north-1',
	bucket: 'litejs-test',
	accessId: env.S3_AWS_ID,
	secret: env.S3_AWS_SECRET,
})

const ws = WebSocketServer(protocols, app)
// One room holds its sockets in a Durable Object
serve((req, env, ctx) => req.path === '/room' ? env.ROOM.getByName('e2e').fetch(req) : ws(req, env, ctx), env)

// Static files that Cloudflare serves from the ASSETS binding
app.get('/{path*}', env.ASSETS.fetch)
