
// Vercel Functions run on Node and take a { fetch } module export

import { env, worker } from './env.mjs'


var Server = app => ({ fetch: worker(app, env) })


export * from './env.mjs'
export * from './node-sqlite.mjs'
export { Server }

