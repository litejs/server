
// Vercel Functions run on Node and take a { fetch } module export

import { worker } from './env.mjs'


var Server = app => ({ fetch: worker(app) })


export * from './node.mjs'
export { Server }

