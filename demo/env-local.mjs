
// Node.js, Bun, Deno and txiki serve the demo's static files from disk.
// The path is relative to this module, which sits next to public/ both here
// and as the Deno bundle in build/deno.

import { env, mdns, serveStatic } from '@litejs/server'

env.ASSETS = serveStatic(import.meta.dirname + '/public')

mdns(env.HOSTNAME = 'demo.local')

