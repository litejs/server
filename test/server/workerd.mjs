
import app from './app.mjs'
import { worker } from '../../index.mjs'

export { Counter } from './counter.mjs'

// Plain workerd has no wrangler assets router: serve files through the
// DiskDirectory service bound as ASSETS, mapping / to index.html.
app.get('/{path*}', (req, env) => env.ASSETS.fetch(new URL('/' + (req.param.path || 'index.html'), req.origin)))

export default {
	fetch: worker(app),
}
