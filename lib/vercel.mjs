
// Vercel Functions run on Node and take a { fetch } module export

import { env, loadEnv } from './env.mjs'
import { toHandler } from './serve.mjs'


var Server = app => (loadEnv(), { fetch: toHandler(app, env) })


export * from './env.mjs'
export * from './node-sqlite.mjs'
export { Server }

