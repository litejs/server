
// Fastly has no filesystem, so public/ travels inside the bundle:
// fastly:build writes assets.mjs with lj-assets and esbuild inlines the files.

import { env, serveAssets } from '@litejs/server'
import { files } from './assets.mjs'

env.ASSETS = serveAssets(files)

