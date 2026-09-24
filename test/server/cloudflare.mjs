
import app, { protocols } from './app.mjs'
import { Server, WebSocketServer } from '../../index.mjs'

export { Counter } from './counter.mjs'
export { Room } from './room.mjs'

var { fetch } = Server(WebSocketServer(protocols, app))

// One room holds its sockets in a Durable Object
export default {
	fetch: (req, env, ctx) => new URL(req.url).pathname === '/room' ? env.ROOM.get(env.ROOM.idFromName('e2e')).fetch(req) : fetch(req, env, ctx)
}
