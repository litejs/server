
import app from './app.mjs'
import { S3, worker } from '../../index.mjs'

export { Counter } from './counter.mjs'

// Plain workerd has no wrangler assets router: serve files through the
// DiskDirectory service bound as ASSETS, mapping / to index.html.
app.get('/{path*}', (req, env) => env.ASSETS.fetch(new URL('/' + (req.param.path || 'index.html'), req.origin)))

var handler = worker(app)

export default {
	fetch(req, env, ctx) {
		// S3 creds arrive as fromEnvironment bindings (null when unset); wire env.S3 like run.mjs.
		if (env.S3_AWS_ID) env = { ...env, S3: S3({
			region: 'eu-north-1',
			bucket: 'litejs-test',
			accessId: env.S3_AWS_ID,
			secret: env.S3_AWS_SECRET,
		}) }
		return handler(req, env, ctx)
	},
}
