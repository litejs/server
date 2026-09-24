
// A Durable Object that holds WebSockets through the hibernation API

import { App, WebSocketDO } from '../../index.mjs'

export class Room extends WebSocketDO {
	static ws = {
		echo: { message: (socket, data) => socket.send(data) },
		'': { message: socket => socket.send('bare') },
		// Only the object's state knows every live socket
		count: { message: (socket, data, env, ctx) => socket.send('' + ctx.getWebSockets().length) },
		// Per-socket state lives on the socket, through hibernation on Cloudflare
		tally: { open: socket => socket.state = { n: 0 }, message: socket => socket.send('' + ++socket.state.n) },
	}
	// A plain request reaches the object's own routes
	static app = App().get('room', (req, env, ctx) => ({ peers: ctx.getWebSockets().length }))
}
