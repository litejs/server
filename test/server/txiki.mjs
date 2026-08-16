
// txiki entrypoint. Same wiring as run.mjs, but built from what this runtime
// has: no loadEnv (sync filesystem), no setupShutdown, no node:os tmpdir. The
// env is assembled by hand and the DO directory is a fixed relative path that
// run:txiki creates.
//
// listen() rather than Server(), because Server(app, dir) takes a static root
// and this fixture has to pass its own bindings through as the env.

import {
	DB, KV, R2, S3, durableObject, listen, serveStatic
} from '../../index.mjs'
import app from './app.mjs'
import { Counter } from './counter.mjs'


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
// Real S3 client, wired only when credentials are present.
if (env.S3_AWS_ID && env.S3_AWS_SECRET) env.S3 = S3({
	region: 'eu-north-1',
	bucket: 'litejs-test',
	accessId: env.S3_AWS_ID,
	secret: env.S3_AWS_SECRET,
})

listen(app, env)

// Static files that Cloudflare serves from the ASSETS binding
app.get('/{path*}', env.ASSETS.fetch)
