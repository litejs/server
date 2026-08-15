
// Cloudflare Workers take a { fetch } module export, and pass a real ctx.

import { worker } from './worker.mjs'


var Server = app => ({ fetch: worker(app) })


export { DurableObject } from 'cloudflare:workers'
export { Server, worker }

