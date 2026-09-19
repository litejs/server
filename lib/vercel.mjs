
// Vercel Functions run on Node and take a { fetch } module export

import { env } from './env.mjs'
import { toHandler } from './serve.mjs'


var Server = app => ({ fetch: toHandler(app, env) })


export * from './env.mjs'
export * from './node-sqlite.mjs'
export { Server }

