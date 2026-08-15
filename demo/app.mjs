
// Demo server deployed to several providers by CI

import { App, Server } from '@litejs/server'
import { COMMIT, RUNTIME } from './info.mjs'

var app = App()
, page = runtime => `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>LiteJS Server demo</title>
</head>
<body>
	<h1>LiteJS Server</h1>
	<p>Served by <strong>${runtime}</strong>.</p>
	<p>One app, one entrypoint, five providers. Only Server() differs.</p>
	<ul>
		<li><a href="/info">/info</a></li>
		<li><a href="/hello/moon">/hello/moon</a></li>
		<li><a href="/teapot">/teapot</a></li>
	</ul>
</body>
</html>
`

app.get('', req => (
	req.resHeaders['content-type'] = 'text/html; charset=utf-8',
	page(RUNTIME)
))

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

// fastly:build warns "import.meta is not available with the iife output
// format" because js-compute-runtime re-bundles as iife. Expected: the value
// is only read by the runtimes that have a disk, and Fastly is not one.
export default Server(app, import.meta.dirname + '/public')

