
// Demo server deployed to several providers by CI

import { App, Server } from '@litejs/server'
import '#env'
import { COMMIT, RUNTIME } from './info.mjs'

// Static files, public/index.html included, come from the ASSETS binding.
var app = App({ notFound: (req, env) => env.ASSETS?.fetch(req) ?? 404 })

app.get('info', req => ({
	runtime: RUNTIME,
	commit: COMMIT,
	path: req.path,
	fullPath: req.fullPath,
	query: req.query,
	method: req.method,
}))

app.get('hello/{name}', req => 'Hello ' + req.param.name)

app.post('echo', async req => ({ echo: await req.text() }))

app.get('teapot', req => (req.resStatus = 418, 'no coffee'))

export default Server(app)

