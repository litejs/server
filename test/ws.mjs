
import '@litejs/cli/test.js'
import { UPGRADE, WebSocketServer as serverUpgrade, wsHandlers, wsServer } from '../lib/ws.mjs'
import { WebSocketClient } from '../lib/env.mjs'
import timers from 'node:timers'

var upgrade = (req, env, ctx, protocol, fns) => (fns.open?.({ protocol, ctx }, req, env, ctx), 'UP:' + protocol)
, WebSocketServer = wsServer(upgrade)
// toHandler stamps the request's own origin on it
, req = (headers, method = 'GET') => Object.assign(new Request('http://x/', { method, headers }), { origin: 'http://x' })
, ws = (protocol, extra) => req({ upgrade: 'WebSocket', 'sec-websocket-protocol': protocol, ...extra })

describe('WebSocketServer negotiation', () => {
	test('passes a plain request through', assert => {
		var seen = []
		, next = (req, env, ctx) => (seen.push(req, env, ctx), 'NEXT')
		, mw = WebSocketServer({ '': {} })
		, r = req({})
		assert.equal(mw(r, 1, 2), undefined, 'no next: undefined, so the chain continues')
		assert.equal(WebSocketServer({ '': {} }, next)(r, 1, 2), 'NEXT', 'next is called')
		assert.equal(seen, [r, 1, 2], 'with the same arguments')
		assert.equal(WebSocketServer({ '': {} }, next)(req({ upgrade: 'websocket' }, 'POST'), 1, 2), 'NEXT', 'a POST is never an upgrade')
		assert.equal(WebSocketServer({ '': {} }, next)(req({ upgrade: 'h2c' })), 'NEXT', 'another upgrade is not ours')
		assert.end()
	})

	test('picks the first offered protocol the table has {0}', [
		['child-node', 'child-node'],
		['other, child-node', 'child-node'],
		['child-node, echo', 'child-node'],
		['echo,child-node', 'echo'],
		['  echo , x ', 'echo'],
	], (offered, expected, assert) => {
		var got = {}
		, mw = WebSocketServer({ echo: { open: s => got.echo = s }, 'child-node': { open: s => got.node = s }, '': { open: () => got.bare = 1 } })
		assert.equal(mw(ws(offered), 'ENV', 'CTX'), 'UP:' + expected)
		assert.equal(got[expected === 'echo' ? 'echo' : 'node'].protocol, expected)
		assert.equal(got.bare, undefined)
		assert.end()
	})

	test('a bare client gets the empty handler and its own arguments', assert => {
		var args
		, mw = WebSocketServer({ '': { open: (...a) => args = a } })
		, r = req({ upgrade: 'websocket' })
		assert.equal(mw(r, 'ENV', 'CTX'), 'UP:')
		assert.equal(r.upgraded, 'UP:', 'the response is marked on the request for toHandler')
		assert.equal(args, [{ protocol: '', ctx: 'CTX' }, r, 'ENV', 'CTX'])
		assert.end()
	})

	test('answers 400 when no handler fits', assert => {
		var mw = WebSocketServer({ echo: { open: () => assert.fail('must not run') } })
		assert.equal(mw(ws('other')), 400, 'only unknown names')
		assert.equal(mw(req({ upgrade: 'websocket' })), 400, 'bare client without an empty key')
		assert.equal(mw(ws('constructor')), 400, 'prototype keys are not handlers')
		assert.end()
	})

	test('a page from another origin is refused, {0}', [
		['a different host is 403', { origin: 'http://evil' }, undefined, 403],
		['a different port is another origin', { origin: 'http://x:8080' }, undefined, 403],
		['a null origin is another origin', { origin: 'null' }, undefined, 403],
		['the same origin passes', { origin: 'http://x' }, undefined, 'UP:echo'],
		['a bare client sends no Origin', {}, undefined, 'UP:echo'],
		['WS_ORIGINS lists it', { origin: 'http://evil' }, { WS_ORIGINS: 'http://a, http://evil' }, 'UP:echo'],
		['WS_ORIGINS is *', { origin: 'http://evil' }, { WS_ORIGINS: '*' }, 'UP:echo'],
		['WS_ORIGINS lists another', { origin: 'http://evil' }, { WS_ORIGINS: 'http://a' }, 403],
	], (name, extra, env, expected, assert) => {
		assert.equal(WebSocketServer({ echo: {} })(ws('echo', extra), env, 'CTX'), expected)
		assert.end()
	})

	test('a throwing handler surfaces to the caller', assert => {
		var mw = WebSocketServer({ echo: { open: () => { throw Error('boom') } } })
		assert.throws(() => mw(ws('echo')), /boom/)
		assert.end()
	})
})

describe('WebSocketServer through the server on the request, Bun and txiki', () => {
	test('hands the map and arguments over as data, {0}', [
		['the protocol is echoed', 'echo', { 'sec-websocket-protocol': 'echo' }],
		['a bare client sends no protocol header', '', undefined],
	], (name, protocol, headers, assert) => {
		var got
		, fns = {}
		, r = protocol ? ws(protocol) : req({ upgrade: 'websocket' })
		r[UPGRADE] = { upgrade: (...a) => (got = a, true) }
		assert.equal(serverUpgrade({ [protocol]: fns })(r, 'ENV', 'CTX'), true)
		assert.equal(got, [r, { data: [fns, r, 'ENV', 'CTX', protocol], headers }])
		assert.end()
	})

	test('answers 400 when the server refuses the handshake', assert => {
		var r = ws('echo')
		r[UPGRADE] = { upgrade: () => false }
		assert.throws(() => serverUpgrade({ echo: {} })(r), /Not a WebSocket handshake/)
		assert.end()
	})

	test('socket events reach the map with the upgrade arguments', assert => {
		var seen = []
		, fns = {
			open: (...a) => seen.push(['open', ...a]),
			message: (...a) => seen.push(['message', ...a]),
			close: (...a) => seen.push(['close', ...a]),
		}
		, ctx = { acceptWebSocket: (s, tags) => seen.push(['accept', tags]) }
		, socket = { data: [fns, 'REQ', 'ENV', ctx, 'echo'] }
		, handlers = wsHandlers(s => seen.push(['prep', s === socket]), s => seen.push(['closed', s === socket]))
		handlers.open(socket)
		handlers.message(socket, 'D')
		handlers.close(socket, 1000, 'bye')
		assert.equal(seen, [
			['prep', true], ['accept', ['echo']], ['open', socket, 'REQ', 'ENV', ctx],
			['message', socket, 'D', 'ENV', ctx],
			['closed', true], ['close', socket, 1000, 'bye', 'ENV', ctx],
		])
		assert.end()
	})

	test('every listener and the close hook are optional', assert => {
		var socket = { data: [{}, 'REQ', 'ENV', {}, ''] }
		, handlers = wsHandlers(() => {})
		handlers.open(socket)
		handlers.message(socket, 'D')
		handlers.close(socket, 1000, '')
		assert.end()
	})
})

describe('WebSocketClient', () => {
	var sockets
	, FakeWebSocket = class extends EventTarget {
		constructor(url, protocol) {
			super()
			this.url = url
			this.protocol = protocol
			this.readyState = 0
			this.sent = []
			sockets.push(this)
		}
		send(data) { this.sent.push(data) }
		close() { this.emit('close', { code: 1000, reason: 'bye' }) }
		emit(type, init) {
			this.readyState = type === 'open' ? 1 : type === 'close' ? 3 : this.readyState
			this.dispatchEvent(Object.assign(new Event(type), init))
		}
	}

	test('dials, queues until open and flushes after the handler', (assert, mock) => {
		sockets = []
		mock.swap(globalThis, 'WebSocket', FakeWebSocket)
		var calls = []
		, link = WebSocketClient('ws://x/', 'child-node', {
			open: (socket, url, env, ctx) => (calls.push([url, env, ctx]), socket.send('hello')),
			message: (socket, data, env, ctx) => calls.push([data, env, ctx]),
			close: (socket, code, reason, env, ctx) => calls.push([code, reason, env, ctx]),
		}, { env: 'ENV', ctx: 'CTX' })
		assert.equal(sockets.length, 1, 'dialed at once')
		assert.equal([sockets[0].url, sockets[0].protocol, sockets[0].binaryType], ['ws://x/', 'child-node', 'arraybuffer'])
		assert.equal(calls, [], 'the map waits for open')
		link.send('a')
		link.send('b')
		assert.equal(sockets[0].sent, [], 'queued while connecting')
		sockets[0].emit('open')
		assert.equal(calls, [['ws://x/', 'ENV', 'CTX']])
		sockets[0].emit('message', { data: 'hi' })
		assert.equal(calls[1], ['hi', 'ENV', 'CTX'], 'message data is passed as is, with env and ctx')
		assert.equal(sockets[0].sent, ['hello', 'a', 'b'], 'handshake first, then the queue')
		link.send('c')
		assert.equal(sockets[0].sent, ['hello', 'a', 'b', 'c'], 'sent directly when open')
		link.close()
		assert.equal(sockets[0].readyState, 3)
		assert.equal(calls[2], [1000, 'bye', 'ENV', 'CTX'], 'close gets the code and reason, with env and ctx')
		assert.end()
	})

	test('reconnects after a close with a delay in range, until closed', (assert, mock) => {
		sockets = []
		mock.swap(globalThis, 'WebSocket', FakeWebSocket)
		mock.time()
		mock.swap(timers, 'setTimeout', (fn, ms) => setTimeout(fn, ms))
		var link = WebSocketClient('ws://x/', 'echo', { open: socket => socket.send('hi') }, { delay: [100, 200] })
		link.send('queued')
		sockets[0].emit('close', { code: 1006 })
		mock.tick(99)
		assert.equal(sockets.length, 1, 'not before the minimum delay')
		mock.tick(101)
		assert.equal(sockets.length, 2, 'redialed within the range')
		sockets[1].emit('open')
		assert.equal(sockets[1].sent, ['hi', 'queued'], 'the queue survived the reconnect')
		link.close()
		mock.tick(1000)
		assert.equal(sockets.length, 2, 'close() stops the loop')
		assert.end()
	})

	test('default delay is between 10 and 30 seconds', (assert, mock) => {
		sockets = []
		mock.swap(globalThis, 'WebSocket', FakeWebSocket)
		mock.time()
		mock.swap(timers, 'setTimeout', (fn, ms) => setTimeout(fn, ms))
		var link = WebSocketClient('ws://x/', 'echo', {})
		sockets[0].emit('close', {})
		mock.tick(9999)
		assert.equal(sockets.length, 1)
		mock.tick(20001)
		assert.equal(sockets.length, 2)
		link.close()
		assert.end()
	})
})

