
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	DB, KV, R2, S3, durableObject, listen, loadEnv, serveStatic, setupShutdown
} from '../../index.mjs'
import app from './app.mjs'
import { Counter } from './counter.mjs'


const db = new DB(':memory:')
const doDir = mkdtempSync(join(tmpdir(), 'litejs-do-'))
// .env.json is git-ignored and local-only; on CI the values come from process.env.
const env = loadEnv(existsSync('.env.json') && '.env.json', {
	ASSETS: serveStatic("public"),
	KV: KV(db, 'kv'),
	R2: R2(db, 'r2'),
})
env.COUNTER = durableObject(Counter, doDir, env, DB)
// Real S3 client, wired only when credentials are present (CI secrets or .env.json).
if (env.S3_AWS_ID && env.S3_AWS_SECRET) env.S3 = S3({
	region: 'eu-north-1',
	bucket: 'litejs-test',
	accessId: env.S3_AWS_ID,
	secret: env.S3_AWS_SECRET,
})
const server = listen(app, env)

// Static files that Cloudflare server from ASSETS binding
app.get("/{path*}", env.ASSETS.fetch)

// Attach SIGINT/SIGTERM/SIGHUP/uncaughtException
setupShutdown([server])

