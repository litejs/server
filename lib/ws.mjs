
import { UNDEF, fail, hasOwn, header, splitRe } from '../util.mjs'


var wsAttach = (socket, fns, req, env, ctx, listen = (ev, fn) => socket.addEventListener(ev, fn)) => {
	socket.binaryType = 'arraybuffer'
	listen('open', () => fns.open?.(socket, req, env, ctx))
	listen('message', e => fns.message?.(socket, e.data, env, ctx))
	listen('close', e => fns.close?.(socket, e.code, e.reason, env, ctx))
	listen('error', e => fns.error?.(socket, e.error || e, env, ctx))
	return listen
}
// A hibernated object wakes with bare sockets, socket.state is restored on first event
, wsEvent = async (fns, ev, ws, ...args) => {
	ws.state ??= ws.deserializeAttachment()
	await fns[ev]?.(ws, ...args)
	ws.state != UNDEF && ws.serializeAttachment(ws.state)
}
, wsServer = upgrade => (protocols, next) => (req, env, ctx, tmp) => (
	req.method !== 'GET' || !/^websocket$/i.test(header(req, 'upgrade')) ? next?.(req, env, ctx) :
	(tmp = header(req, 'origin')) && tmp !== req.origin && !env?.WS_ORIGINS?.split(splitRe).some(o => o === '*' || o === tmp) ? 403 :
	(tmp = header(req, 'sec-websocket-protocol').split(splitRe).find(p => hasOwn(protocols, p))) == null ? 400 :
	(req.upgraded = upgrade(req, env, ctx, tmp, protocols[tmp]))
)

, wsClient = unrefTimeout => (url, protocol, fns, { delay = [10000, 30000], env, ctx } = {}) => {
	var socket
	, queue = []
	, send = data => socket.readyState === 1 ? socket.send(data) : queue.push(data)
	// No delay left means no more dialing, also for a redial already waiting on its timer
	, connect = listen => delay && (
		listen = wsAttach(socket = new WebSocket(url, protocol), fns, url, env, ctx),
		// Registered after the map, so a handshake it sends on open goes out first
		listen('open', () => queue.splice(0).forEach(send)),
		listen('close', () => delay && unrefTimeout(connect, delay[0] + Math.random() * (delay[1] - delay[0])))
	)
	connect()
	return { send, close: () => (delay = 0, socket.close()) }
}

, UPGRADE = Symbol()
// Bun and txiki upgrade through the server; data carries the protocol map and the upgrade's own arguments
, WebSocketServer = /* @__PURE__ */ wsServer((req, env, ctx, protocol, fns) => (
	// Bun refuses an empty headers object, and an empty protocol header hangs the client
	req[UPGRADE].upgrade(req, {
		data: [fns, req, env, ctx, protocol], headers: protocol ? { 'sec-websocket-protocol': protocol } : UNDEF
	}) || fail('Not a WebSocket handshake', 400)
))
, wsHandlers = (prep, closed) => ({
	open: (ws, [fns, req, env, ctx, protocol] = ws.data) => (prep(ws), ctx.acceptWebSocket?.(ws, [protocol]), fns.open?.(ws, req, env, ctx)),
	message: (ws, data, [fns, , env, ctx] = ws.data) => fns.message?.(ws, data, env, ctx),
	close: (ws, code, reason, [fns, , env, ctx] = ws.data) => (closed?.(ws), fns.close?.(ws, code, reason, env, ctx))
})


export { UPGRADE, WebSocketServer, wsAttach, wsClient, wsEvent, wsHandlers, wsServer }

