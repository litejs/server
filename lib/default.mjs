
// The '#runtime' fallback

import { fail } from '../util.mjs'


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
, worker = notImpl('worker')
, DB = notImpl('DB')
, DurableObject = notImpl('DurableObject')
, Server = notImpl('Server')


export {
	DB, DurableObject, Server,
	body, createHash, cwd, env, remove, resolve, sep, serve, serveStatic, stat, worker
}

