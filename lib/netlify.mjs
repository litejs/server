
// Netlify Functions run on Node and take the handler directly as the module export
// The `config` export must stays in the entry file

import { env } from './env.mjs'
import { toHandler } from './serve.mjs'


var Server = app => toHandler(app, env)


export * from './env.mjs'
export * from './node-sqlite.mjs'
export { Server }

