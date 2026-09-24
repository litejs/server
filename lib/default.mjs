
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
, remove = notImpl('remove')
, resolve = notImpl('resolve')
, sep = '/'
, serve = notImpl('serve')
, serveStatic = notImpl('serveStatic')
, stat = notImpl('stat')
, DB = notImpl('DB')
, DurableObject = notImpl('DurableObject')
, Server = notImpl('Server')
, unrefTimeout = setTimeout
, WebSocketClient = /* @__PURE__ */ wsClient(unrefTimeout)
// Plain requests pass through; the first upgrade throws
, WebSocketServer = /* @__PURE__ */ wsServer(notImpl('upgrade'))


export {
	DB, DurableObject, Server, WebSocketClient, WebSocketServer,
	body, createHash, cwd, env, remove, resolve, sep, serve, serveStatic, stat, unrefTimeout
}

