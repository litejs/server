
import app, { protocols } from './app.mjs'
import { S3, Server, WebSocketServer } from '../../index.mjs'

export { Counter } from './counter.mjs'
export { Room } from './room.mjs'

// Plain workerd has no wrangler assets router: serve files through the
// DiskDirectory service bound as ASSETS, mapping / to index.html.
app.get('/{path*}', (req, env) => env.ASSETS.fetch(new URL('/' + (req.param.path || 'index.html'), req.origin)))

var { fetch: handler } = Server(WebSocketServer(protocols, app))

export default {
	fetch(req, env, ctx) {
		// One room holds its sockets in a Durable Object
		if (new URL(req.url).pathname === '/room') return env.ROOM.get(env.ROOM.idFromName('e2e')).fetch(req)
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
