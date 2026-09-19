
// Cloudflare Workers take a { fetch } module export, and pass a real ctx.

import { toHandler } from './serve.mjs'


var Server = app => ({ fetch: toHandler(app) })


export * from './default.mjs'
export { DurableObject, env } from 'cloudflare:workers'
export { Server }

