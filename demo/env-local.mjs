
// Node.js, Bun and Deno serve the demo's static files from disk.
// The path is relative to this module, which sits next to public/ both here
// and as the Deno bundle in build/deno.

import { env, serveStatic } from '@litejs/server'

env.ASSETS = serveStatic(import.meta.dirname + '/public')

