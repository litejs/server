
import '@litejs/cli/test.js'
import net from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import timers from 'node:timers'
import { App, WebSocketDO, durableObject, sleep } from '../index.mjs'
import { upgrade } from '../lib/node-ws.mjs'
import { UPGRADE } from '../lib/ws.mjs'

var skip = typeof Bun !== 'undefined' || typeof Deno !== 'undefined'
, serveNode = skip ? null : async (...args) => (await import('../lib/node.mjs')).serve(...args)
, wsServer = skip ? null : async (...args) => (await import('../lib/node.mjs')).WebSocketServer(...args)
, port = 18761
, until = async (fn, last) => {
	for (var i = 0; i < 100; i++) try { return await fn() } catch (e) { last = e, await sleep(20) }
	throw last
}
, connect = (protocol, url = 'ws://127.0.0.1:' + port + '/') => new Promise((resolve, reject) => {
	var ws = new WebSocket(url, protocol)
	ws.binaryType = 'arraybuffer'
	ws.onopen = () => resolve(ws)
	ws.onerror = () => reject(Error('connect failed'))
})
, once = (target, type) => new Promise(resolve => target.addEventListener(type, resolve, { once: true }))
// A raw client for frames the built-in WebSocket cannot send
, rawClient = (headers = '', opts) => new Promise(resolve => {
	var chunks = []
	, socket = net.connect({ port, host: '127.0.0.1', ...opts }, () => socket.write(
		'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' + headers + '\r\n'
	))
	socket.on('data', d => chunks.push(d))
	socket.body = () => Buffer.concat(chunks.splice(0))
	socket.settle = async () => (await sleep(50), socket.body())
	socket.done = new Promise(r => socket.on('close', () => r(Buffer.concat(chunks))))
	socket.masked = (op, data, fin = true, mask = [1, 2, 3, 4], payload = Buffer.from(data).map((b, i) => b ^ mask[i & 3])) => socket.write(Buffer.concat([
		Buffer.from(payload.length < 126 ? [(fin ? 128 : 0) | op, 128 | payload.length] :
			[(fin ? 128 : 0) | op, 254, payload.length >> 8, payload.length & 255]),
		Buffer.from(mask), payload
	]))
	socket.once('data', () => resolve(socket))
})
, accept = createHash('sha1').update('dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')

describe('WebSocket on Node', !skip && (() => {
	var server, seen, held, opens = 0
	, Room = class extends WebSocketDO {
		static ws = {
			echo: { message: (socket, data) => socket.send(data) },
			count: { message: (socket, data, env, ctx) => socket.send('' + ctx.getWebSockets().length) },
		}
		static app = App().get('room', (req, env, ctx) => ({ peers: ctx.getWebSockets().length }))
	}
	, protocols = {
		echo: {
			open: (socket, req, env, ctx) => (opens++, socket.ctx = ctx),
			message: (socket, data, env, ctx) => (seen.push(ctx === socket.ctx ? data : 'ctx mismatch'), socket.send(data)),
			close: (socket, code, reason) => seen.push(['close', code, reason]),
			error: (socket, error) => seen.push(['error', error.message]),
		},
		bye: { open: socket => socket.close(4000, 'bye'), close: (socket, code) => seen.push(['bye', code]) },
		'': { message: socket => socket.send('bare') },
		twice: { open: socket => (socket.close(), socket.close(), socket.send('late')) },
		err: { open: (socket, req) => req[UPGRADE].socket.emit('error', Error('boom')), error: (socket, error) => socket.send('err:' + error.message) },
		hold: { open: (socket, req) => held = req[UPGRADE].socket },
	}

	test('start', async assert => {
		var app = App()
		, ws = await wsServer(protocols, app)
		, room = durableObject(Room, mkdtempSync(join(tmpdir(), 'litejs-room-')), {})
		app.get('info', req => ({ path: req.path }))
		// One room holds its sockets in a shimmed Durable Object
		server = await serveNode((req, env, ctx) => req.path === '/room' ? room.getByName('e2e').fetch(req) : ws(req, env, ctx), { PORT: port, BIND_ADDR: '127.0.0.1' })
		await until(() => fetch('http://127.0.0.1:' + port + '/info'))
	})

	test('echoes text and binary, fires open once, closes cleanly from the client', async assert => {
		seen = []
		var ws = await connect('echo')
		assert.equal(ws.protocol, 'echo', 'protocol echoed')
		ws.send('hi')
		assert.equal((await once(ws, 'message')).data, 'hi')
		ws.send(new Uint8Array([1, 2, 3]))
		assert.equal(new Uint8Array((await once(ws, 'message')).data), new Uint8Array([1, 2, 3]))
		ws.send('x'.repeat(300))
		assert.equal((await once(ws, 'message')).data.length, 300, '16-bit length')
		ws.send('y'.repeat(70000))
		assert.equal((await once(ws, 'message')).data.length, 70000, '64-bit length')
		ws.close(4001, 'done')
		var ev = await once(ws, 'close')
		assert.equal([ev.code, ev.reason], [4001, 'done'], 'the server echoed the code')
		await sleep(20)
		assert.equal(opens, 1)
		assert.equal(seen.length, 5)
		assert.equal(new Uint8Array(seen[1]), new Uint8Array([1, 2, 3]))
		assert.equal(seen[4], ['close', 4001, 'done'])
	})

	test('closes from the server with a code', async assert => {
		seen = []
		var ws = await connect('bye')
		, ev = await once(ws, 'close')
		assert.equal([ev.code, ev.reason], [4000, 'bye'])
		var late = await connect('twice')
		late.send('x')
		assert.equal((await once(late, 'close')).code, 1000, 'a second close and a send after closing are dropped')
	})

	test('serves a bare client through the empty handler', async assert => {
		var ws = await connect()
		ws.send('?')
		assert.equal((await once(ws, 'message')).data, 'bare')
		ws.close()
	})

	test('answers pings and reassembles fragments', async assert => {
		seen = []
		var raw = await rawClient('Sec-WebSocket-Protocol: echo\r\n')
		assert.ok(raw.body().toString().startsWith('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\nSec-WebSocket-Protocol: echo\r\n'), 'handshake')
		raw.masked(9, 'ping')
		assert.equal(await raw.settle(), Buffer.from([0x8a, 4, ...Buffer.from('ping')]), 'pong')
		// A frame that arrives in pieces waits for its header, then its payload
		raw.write(Buffer.from([0x89, 0x84]))
		await sleep(20)
		raw.write(Buffer.from([1, 2, 3, 4, 'p'.charCodeAt() ^ 1, 'i'.charCodeAt() ^ 2]))
		await sleep(20)
		raw.write(Buffer.from(['n'.charCodeAt() ^ 3, 'g'.charCodeAt() ^ 4]))
		assert.equal(await raw.settle(), Buffer.from([0x8a, 4, ...Buffer.from('ping')]), 'pong after reassembly')
		raw.masked(10, 'pong')
		raw.masked(1, 'hel', false)
		raw.masked(0, 'lo', true)
		assert.equal(await raw.settle(), Buffer.from([0x81, 5, ...Buffer.from('hello')]), 'one message from two frames')
		raw.masked(8, '')
		assert.equal(await raw.settle(), Buffer.from([0x88, 0]), 'close without a code is echoed empty')
		assert.equal(seen, ['hello', ['close', 1005, '']])
	})

	test('reassembles a fragmented binary message', async assert => {
		seen = []
		var raw = await rawClient('Sec-WebSocket-Protocol: echo\r\n')
		raw.body()
		raw.masked(2, [1, 2, 3], false)
		raw.masked(0, [4, 5], true)
		assert.equal(await raw.settle(), Buffer.from([0x82, 5, 1, 2, 3, 4, 5]))
		assert.equal(new Uint8Array(seen[0]), new Uint8Array([1, 2, 3, 4, 5]))
		// A peer that just hangs up gets an abnormal close on this side
		raw.end()
		await raw.done
		assert.equal(seen[1], ['close', 1006, ''])
	})

	test('closes with {1} on {0}', [
		['an unmasked frame', 1002, [0x81, 2, 104, 105]],
		['a set RSV bit', 1002, [0xc1, 0x80, 1, 2, 3, 4]],
		['a reserved opcode', 1002, [0x83, 0x80, 1, 2, 3, 4]],
		['a fragmented ping', 1002, [0x09, 0x80, 1, 2, 3, 4]],
		['a control frame over 125 bytes', 1002, [0x89, 0xfe, 0, 126, 1, 2, 3, 4]],
		['a continuation without a start', 1002, [0x80, 0x81, 1, 2, 3, 4, 0x78 ^ 1]],
		['a new message inside a fragmented one', 1002, [0x01, 0x81, 1, 2, 3, 4, 0x61 ^ 1, 0x81, 0x81, 1, 2, 3, 4, 0x62 ^ 1]],
		['a one-byte close payload', 1002, [0x88, 0x81, 1, 2, 3, 4, 3 ^ 1]],
		['a reserved close code', 1002, [0x88, 0x82, 1, 2, 3, 4, 3 ^ 1, 0xec ^ 2]],
		['a close code 1005 on the wire', 1002, [0x88, 0x82, 1, 2, 3, 4, 3 ^ 1, 0xed ^ 2]],
		['invalid UTF-8 in a text message', 1007, [0x81, 0x82, 1, 2, 3, 4, 0xff ^ 1, 0xfe ^ 2]],
		['invalid UTF-8 in an unfinished text message', 1007, [0x01, 0x81, 1, 2, 3, 4, 0x61 ^ 1, 0x00, 0x81, 1, 2, 3, 4, 0xff ^ 1]],
		['invalid UTF-8 in a close reason', 1007, [0x88, 0x83, 1, 2, 3, 4, 3 ^ 1, 0xe8 ^ 2, 0xff ^ 3]],
		['an oversize frame', 1009, [0x81, 255, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]],
		['a length beyond 32 bits', 1009, [0x81, 255, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2, 3, 4]],
		['a message over the limit across fragments', 1009, [0x01, 0x81, 1, 2, 3, 4, 0x61 ^ 1, 0x80, 255, 0, 0, 0, 0, 1, 0, 0, 0, 1, 2, 3, 4]],
	], async (name, code, bytes, assert) => {
		var raw = await rawClient()
		raw.body()
		raw.write(Buffer.from(bytes))
		assert.equal(await raw.settle(), Buffer.from([0x88, 2, code >> 8, code & 255]))
	})

	test('drops a peer that never answers the close', async (assert, mock) => {
		seen = []
		mock.swap(timers, 'setTimeout', (fn, ms) => setTimeout(fn, 50))
		var raw = await rawClient('Sec-WebSocket-Protocol: bye\r\n')
		, start = Date.now()
		// The close frame may share a chunk with the handshake
		assert.equal((await raw.done).subarray(-7), Buffer.from([0x88, 5, 4000 >> 8, 4000 & 255, ...Buffer.from('bye')]), 'the close frame went out')
		assert.ok(Date.now() - start < 1000, 'the socket was destroyed on the timeout')
		assert.equal(seen, [['bye', 1006]], 'an unanswered close is abnormal')
	})

	test('drops a peer that never closes TCP after {0}', [
		['the close handshake', [0x88, 0x82, 1, 2, 3, 4, 3 ^ 1, 0xe8 ^ 2], [0x88, 2, 3, 0xe8]],
		['a protocol error', [0x81, 2, 104, 105], [0x88, 2, 1002 >> 8, 1002 & 255]],
	], async (name, bytes, reply, assert, mock) => {
		mock.swap(timers, 'setTimeout', (fn, ms) => setTimeout(fn, 200))
		var raw = await rawClient('Sec-WebSocket-Protocol: hold\r\n', { allowHalfOpen: true })
		raw.body()
		raw.write(Buffer.from(bytes))
		try {
			assert.equal(await raw.settle(), Buffer.from(reply), 'the close frame went out')
			assert.ok(!held.destroyed, 'the peer gets time to close first')
			await until(() => held.destroyed || Promise.reject(Error('still open')))
		} finally { raw.destroy() }
	})

	test('stops reading while a peer does not read its pongs', async assert => {
		var raw = await rawClient('Sec-WebSocket-Protocol: hold\r\n')
		, ping = Buffer.from([0x89, 0x80 | 125, 0, 0, 0, 0, ...Buffer.alloc(125)])
		, tail
		raw.body()
		raw.pause()
		for (var i = 0; i < 20; i++) raw.write(Buffer.concat(Array(5000).fill(ping)))
		raw.masked(9, 'last')
		await until(() => held.isPaused() || Promise.reject(Error('reading on')))
		assert.ok(held.writableLength < 1 << 18, 'pongs queued: ' + held.writableLength)
		raw.resume()
		await until(() => (tail = raw.body()).length && tail.subarray(-6).equals(Buffer.from([0x8a, 4, ...Buffer.from('last')])) || Promise.reject(Error('no last pong')))
		assert.ok(!held.isPaused(), 'reads again once drained')
		raw.destroy()
	})

	test('pings an idle peer and drops one that never answers', async (assert, mock) => {
		seen = []
		mock.swap(timers, 'setTimeout', (fn, ms) => setTimeout(fn, 50))
		var quiet = await rawClient('Sec-WebSocket-Protocol: echo\r\n')
		, live = await rawClient('Sec-WebSocket-Protocol: echo\r\n')
		, pings = 0
		quiet.body(), live.body()
		live.on('data', () => (pings++, live.masked(10, '')))
		assert.equal((await quiet.done).subarray(-2), Buffer.from([0x89, 0]), 'a ping went out before the drop')
		assert.equal(seen, [['close', 1006, '']], 'silence through a ping is an abnormal close')
		await sleep(150)
		assert.ok(pings > 1 && !live.destroyed, 'a peer that answers stays, pings: ' + pings)
		live.destroy()
	})

	test('a Durable Object holds its sockets through the shim', async assert => {
		var a = await connect('count', 'ws://127.0.0.1:' + port + '/room')
		, b = await connect('echo', 'ws://127.0.0.1:' + port + '/room')
		a.send('?')
		assert.equal((await once(a, 'message')).data, '2', 'the state lists both')
		b.send('hi')
		assert.equal((await once(b, 'message')).data, 'hi', 'served by the table')
		assert.equal(await (await fetch('http://127.0.0.1:' + port + '/room')).json(), { peers: 2 }, 'a plain request goes to the app')
		a.close(), b.close()
	})

	test('a raw socket error reaches the handler', async assert => {
		var ws = await connect('err')
		assert.equal((await once(ws, 'message')).data, 'err:boom')
		ws.close()
	})

	test('an upgrade the app does not take is answered by hand', async assert => {
		var body = (await (await rawClient('Sec-WebSocket-Protocol: nope\r\n')).done).toString()
		assert.ok(body.startsWith('HTTP/1.1 400 \r\nconnection: close\r\n'), '400 for an unknown protocol: ' + body)
		assert.ok(body.endsWith('\r\n\r\n'), 'no body')
		body = await new Promise(resolve => {
			var chunks = []
			, socket = net.connect(port, '127.0.0.1', () => socket.write('GET file:///x HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'))
			socket.on('data', d => chunks.push(d))
			socket.on('close', () => resolve(Buffer.concat(chunks).toString()))
		})
		assert.equal(body, 'HTTP/1.1 400 Bad Request\r\n\r\n', 'a bad target')
	})

	test('a handler can read the info route over the same server', async assert => {
		assert.equal(await (await fetch('http://127.0.0.1:' + port + '/info')).json(), { path: '/info' })
	})

	test('stop', assert => {
		server.close()
		assert.end()
	})

	test('upgrade() refuses a request that is not a handshake', assert => {
		var req = (h, raw) => Object.assign(new Request('http://x/', { headers: h }), raw && { [UPGRADE]: { socket: {} } })
		assert.throws(() => upgrade(req({}, 1), {}, {}), /handshake/, 'no key')
		assert.throws(() => upgrade(req({ 'sec-websocket-key': 'k', 'sec-websocket-version': '8' }, 1), {}, {}), /handshake/, 'old version')
		assert.throws(() => upgrade(req({ 'sec-websocket-key': 'k', 'sec-websocket-version': '13' }), {}, {}), /handshake/, 'no raw socket')
		assert.end()
	})
}))

