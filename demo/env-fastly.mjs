
// Fastly and Neon bundle the entry file alone, so public/ travels inside the bundle:
// fastly:build and neon:build write assets.mjs with lj-assets and esbuild inlines the files.

import { env, serveAssets } from '@litejs/server'
import { files } from './assets.mjs'

env.ASSETS = serveAssets(files)

