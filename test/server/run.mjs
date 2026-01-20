
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	DB, KV, durableObject, listen, loadEnv, serveStatic, setupShutdown
} from '../../index.mjs'
import app from './app.mjs'
import { Counter } from './counter.mjs'


const db = new DB(':memory:')
const doDir = mkdtempSync(join(tmpdir(), 'litejs-do-'))
const env = loadEnv('.env.json', {
	ASSETS: serveStatic("public"),
	KV: KV(db, 'kv'),
})
env.COUNTER = durableObject(Counter, doDir, env, DB)
const server = listen(app, env)

// Static files that Cloudflare server from ASSETS binding
app.get("/{path*}", env.ASSETS.fetch)

// Attach SIGINT/SIGTERM/SIGHUP/uncaughtException
setupShutdown([server])

