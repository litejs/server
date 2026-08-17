
// The '#runtime' fallback

import { fail } from '../util.mjs'


var notImpl = name => function() {
	// A function(), so `new` and `extends` throw the same message
	fail('Not Implemented: ' + name)
}
, body = notImpl('body')
, createHash = notImpl('createHash')
, cwd = notImpl('cwd')
, listen = notImpl('listen')
, remove = notImpl('remove')
, resolve = notImpl('resolve')
, sep = '/'
, serveStatic = notImpl('serveStatic')
, stat = notImpl('stat')
, worker = notImpl('worker')
, DB = notImpl('DB')
, DurableObject = notImpl('DurableObject')
, Server = notImpl('Server')


export {
	DB, DurableObject, Server,
	body, createHash, cwd, listen, remove, resolve, sep, serveStatic, stat, worker
}

