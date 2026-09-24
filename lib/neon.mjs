
// Neon Functions run on Node and take a { fetch } module export like Vercel

import { upgradeWebSocket } from '@neon/functions'
import { env } from './env.mjs'
import { toHandler } from './serve.mjs'
import { wsAttach, wsServer } from './ws.mjs'


var Server = app => ({ fetch: toHandler(app, env) })
, WebSocketServer = /* @__PURE__ */ wsServer((req, env, ctx, protocol, fns) => {
	var up = upgradeWebSocket(req, { protocol })
	wsAttach(up.socket, fns, req, env, ctx)
	ctx.acceptWebSocket?.(up.socket, [protocol])
	return up.response
})


export * from './env.mjs'
export * from './node-sqlite.mjs'
export { Server, WebSocketServer }

