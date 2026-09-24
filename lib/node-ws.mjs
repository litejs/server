
// RFC 6455 framing over the raw socket

import { createHash } from 'node:crypto'
import { fail, header, isStr, joinBuf, toUint } from '../util.mjs'
import { unrefTimeout } from './env.mjs'
import { UPGRADE } from './ws.mjs'


var utf8 = () => new TextDecoder('utf-8', { fatal: true })
, upgrade = (req, env, ctx, protocol, fns) => {
	var alive, fragOp, timer
	, up = req[UPGRADE] || 0
	, raw = up.socket
	, key = header(req, 'sec-websocket-key')
	, chunks = []
	, have = 0
	, frags = []
	, size = 0
	, text = ''
	// A new decoder as `close` reason may arrive while a message is still streaming
	, dec = utf8()
	, send = (op, data, len = data.length) => raw.write(joinBuf([128 | op],
		len < 126 ? [len] :
		len < 65536 ? [126, len >> 8, len & 255] :
		[127, 0, 0, 0, 0, len >>> 24, len >> 16 & 255, len >> 8 & 255, len & 255]
	, data)) || raw.pause()
	, wait = fn => (clearTimeout(timer), timer = unrefTimeout(fn, 30000))
	, sendClose = (code, reason) => send(8, joinBuf([code >> 8, code & 255], reason))
	, soc = {
		readyState: 0,
		send: data => soc.readyState === 1 && send(isStr(data) ? 1 : 2, toUint(data)),
		close: (code = 1000, reason = '') => soc.readyState === 1 && (
			soc.readyState = 2, sendClose(code, reason), wait(kill)
		)
	}
	, end = (code, reason = '') => (clearTimeout(timer), raw.end(), soc.readyState < 3 && (soc.readyState = 3, fns.close?.(soc, code, reason, env, ctx)))
	, hangup = () => end(1006)
	, kill = () => (hangup(), raw.destroy())
	, drop = (code, reason) => (end(code, reason), wait(kill))
	, abort = code => (sendClose(code, ''), drop(code))
	// A ping every 30s
	, ping = () => alive ? (alive = 0, send(9, ''), wait(ping)) : kill()
	, onData = chunk => {
		alive = 1
		chunks.push(chunk)
		have += chunk.length
		for (var buf, b0, len, pos, data, op, code, i; have > 1; ) {
			// A first chunk shorter than the longest header may hold only part of it
			if (chunks[0].length < 14 && chunks.length > 1) chunks = [joinBuf(...chunks)]
			buf = chunks[0]
			b0 = buf[0]
			op = b0 & 15
			len = buf[1] & 127
			pos = len < 126 ? 2 : len === 126 ? 4 : 10
			// Unmasked, a reserved bit or opcode (3-7 and 11-15 share their low bits), a long or fragmented control frame, or a message out of order
			if (!(buf[1] & 128) || b0 & 0x70 || (op & 7) > 2 || (op > 7 ? len > 125 || !(b0 & 128) : op ? fragOp : !fragOp)) return abort(1002)
			if (pos > 2) for (len = 0, i = 2; i < pos; i++) len = len * 256 + (buf[i] | 0)
			if (len > (16 << 20) - size) return abort(1009)
			if (have < pos + 4 + len) return
			if (chunks.length > 1) buf = joinBuf(...chunks)
			data = buf.subarray(pos + 4, pos + 4 + len)
			for (i = 0; i < len; i++) data[i] ^= buf[pos + (i & 3)]
			chunks = (have -= pos += 4 + len) ? [buf.subarray(pos)] : []
			if (op === 8) {
				// No payload means 1005 and is not checked, a one-byte payload lands on reserved 1004 and is
				code = len > 1 ? data[0] << 8 | data[1] : 1005 - len
				if (len && (code < 1000 || code > 1003 && code < 1007 || code > 1014 && code < 3000 || code > 4999)) return abort(1002)
				try { var reason = utf8().decode(data.subarray(2)) } catch { return abort(1007) }
				// Echo the peer's close unless it answers our own
				if (soc.readyState === 1) send(8, data)
				return drop(code, reason)
			}
			if (op === 9) send(10, data)
			else if (op < 3) {
				fragOp ||= op
				size += len
				// Text is checked on every fragment
				if (fragOp === 1) try { text += dec.decode(data, { stream: !(b0 & 128) }) } catch { return abort(1007) }
				else frags.push(data)
				if (b0 & 128) {
					fns.message?.(soc, fragOp === 1 ? text : joinBuf(...frags.splice(0)).buffer, env, ctx)
					text = ''
					size = fragOp = 0
				}
			}
		}
	}
	raw && key && header(req, 'sec-websocket-version') === '13' || fail('Not a WebSocket handshake', 400)
	return up.upgraded = () => {
		raw.write(
			'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
			createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') +
			(protocol && '\r\nSec-WebSocket-Protocol: ' + protocol) + '\r\n\r\n'
		)
		// http leaves its sockets half-open, so a peer's FIN needs answering as well
		raw.on('data', onData).on('drain', () => raw.resume()).on('end', hangup).on('close', hangup).on('error', error => fns.error?.(soc, error, env, ctx))
		wait(ping)
		soc.readyState = 1
		ctx.acceptWebSocket?.(soc, [protocol])
		fns.open?.(soc, req, env, ctx)
		onData(up.head)
	}
}


export { upgrade }

