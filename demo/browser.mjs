// Static server for the Service Worker test page.
//
//   npm run bundle:sw && node demo/browser.mjs
//   open http://127.0.0.1:8080/
//
// It serves public/ and nothing else — no app routes. Every check on the page
// therefore fails until the Service Worker is controlling it, which is what
// makes a pass meaningful.

import { App, Server, env, serveStatic } from '@litejs/server'

env.ASSETS = serveStatic('public')
Server(App({ notFound: (req, env) => env.ASSETS.fetch(req) }))
