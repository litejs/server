
// The '#runtime' fallback

import { fail } from '../util.mjs'
import { wsClient, wsServer } from './ws.mjs'


var notImpl = name => function() {
	// A function(), so `new` and `extends` throw the same message
	fail('Not Implemented: ' + name)
}
, body = notImpl('body')
, createHash = notImpl('createHash')
, cwd = notImpl('cwd')
, env = {}
, interfaces = notImpl('interfaces')
, remove = notImpl('remove')
, resolve = notImpl('resolve')
, sep = '/'
, serve = notImpl('serve')
, serveStatic = notImpl('serveStatic')
, stat = notImpl('stat')
, DB = notImpl('DB')
, DurableObject = notImpl('DurableObject')
, Server = notImpl('Server')
, udpServer = notImpl('udpServer')
, unrefTimeout = setTimeout
, WebSocketClient = /* @__PURE__ */ wsClient(unrefTimeout)
// Plain requests pass through; the first upgrade throws
, WebSocketServer = /* @__PURE__ */ wsServer(notImpl('upgrade'))


export {
	DB, DurableObject, Server, WebSocketClient, WebSocketServer,
	body, createHash, cwd, env, interfaces, remove, resolve, sep, serve, serveStatic, stat, udpServer, unrefTimeout
}

