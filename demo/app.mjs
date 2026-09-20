
// Demo server deployed to several providers by CI

import { App, negotiate, Server } from '@litejs/server'
import '#env'
import { COMMIT, RUNTIME } from './info.mjs'

// Static files, public/index.html included, come from the ASSETS binding.
var app = App({ notFound: (req, env) => env.ASSETS?.fetch(req) ?? 404 })


app.use(negotiate({
	'application/json;filename=;select=;space=': (data, negod) => JSON.stringify(
		data,
		negod.select ? negod.select.split(',') : null,
		+negod.space || negod.space
	),
	'text/csv;filename=;header=': (data, negod) => {
		var rows = [].concat(data)
		, keys = Object.keys(rows[0])
		return (negod.header === 'absent' ? [] : [keys]).concat(rows.map(row => keys.map(key => row[key]))).map(row => row.join(',')).join('\r\n')
	}
}))

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

