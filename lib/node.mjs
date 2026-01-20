
import http from 'node:http'
import { Readable } from 'node:stream'
import { worker } from './worker.mjs'


var listen = (app, env = {}) => {
	var fetch = worker(app)
	, server = http.createServer(async (req, res) => {
		var isHead = req.method === 'HEAD'
		, method = isHead ? 'GET' : req.method
		, url = new URL(req.url, 'http://' + (req.headers.host || /* c8 ignore next */ '127.0.0.1'))
		, webReq = new Request(url, {
			method,
			headers: req.headers,
			body: method !== 'GET' ? Readable.toWeb(req) : null,
			duplex: 'half'
		})
		, webRes = await fetch(webReq, env)

		res.writeHead(webRes.status, Object.fromEntries(webRes.headers))
		if (isHead || !webRes.body) return res.end()
		Readable.fromWeb(webRes.body).pipe(res)
	})

	server.name = env.SERVER_NAME
	server.listen(+env.PORT || /* c8 ignore next */ 8080, env.BIND_ADDR || '0.0.0.0', () => {
		console.log('Listening', server.name)
	})

	return server
}


export * from './env.mjs'
export { listen }

