
// Netlify Functions run on Node and take the handler directly as the module export

import { env, loadEnv } from './env.mjs'
import { toHandler } from './serve.mjs'


var Server = app => (loadEnv(), toHandler(app, env))


export * from './env.mjs'
export * from './node-sqlite.mjs'
export { Server }

