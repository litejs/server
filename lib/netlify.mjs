
// Netlify Functions run on Node and take the handler directly as the module export
// The `config` export must stays in the entry file

import { worker } from './env.mjs'


var Server = worker


export * from './node.mjs'
export { Server }

