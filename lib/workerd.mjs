
// Cloudflare Workers take a { fetch } module export, and pass a real ctx.

import { toHandler } from './serve.mjs'
import { wsAttach, wsEvent, wsServer } from './ws.mjs'


var Server = app => ({ fetch: toHandler(app) })
, WebSocketServer = /* @__PURE__ */ wsServer(async (req, env, ctx, protocol, fns) => {
	var { 0: webSocket, 1: socket } = new WebSocketPair()
	// the protocol travels as the socket's first tag, to find its map again
	ctx.acceptWebSocket ? ctx.acceptWebSocket(socket, [protocol]) : (socket.accept(), wsAttach(socket, fns, req, env, ctx))
	// An accepted socket `open` never fires
	await wsEvent(fns, 'open', socket, req, env, ctx)
	return new Response(null, { status: 101, webSocket, headers: protocol ? { 'sec-websocket-protocol': protocol } : {} })
})


export * from './default.mjs'
export { DurableObject, env } from 'cloudflare:workers'
export { Server, WebSocketServer }

