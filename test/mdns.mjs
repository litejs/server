import '@litejs/cli/test.js'
import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { mdns } from '../lib/mdns.mjs'

describe('mdns', () => {
	var pkt = (head, name, type) => Buffer.from(head + '\0\x01\0\0\0\0\0\0' + name.split('.').map(l => String.fromCharCode(l.length) + l).join('') + '\0\0' + type + '\0\x01', 'latin1')
	// The responder binds in the background, so a query repeats until answered, as resolvers do.
	, retry = (client, fn, timer = setInterval(fn, 50)) => client.on('close', () => clearInterval(timer))
	, ask = (name, type, from, cb) => {
		var client = createSocket('udp4')
		client.on('message', msg => (client.close(), cb(msg)))
		client.bind(0, from, () => retry(client, () => client.send(pkt('\x12\x34\0\0', name, type), 5353, from)))
	}
	// LAN and any VPN on this host: each must be answered with its own address.
	, addrs = [].concat(...Object.values(networkInterfaces())).filter(i => i.family == 'IPv4' && !i.internal).map(i => i.address)

	test('answers each asker with the address on its subnet', assert => {
		var sock = mdns('litejs-test.local')
		, next = (i, addr = addrs[i]) => addr ? ask('LiteJS-Test.local', '\x01', addr, msg => {
			assert.equal(msg.readUInt16BE(0), 0x1234, 'id echoed for a one-shot resolver')
			assert.equal(msg.readUInt16BE(6), 1, 'one answer')
			assert.equal(msg.readUInt16BE(msg.length - 12), 0x8001, 'cache-flush IN class')
			assert.equal(msg.readUInt32BE(msg.length - 10), 120, 'ttl')
			assert.equal([...msg.subarray(-4)].join('.'), addr, 'asked from ' + addr)
			next(i + 1)
		}) : (sock.close(), assert.end())
		next(0)
	})

	test('ignores loopback, other names, other types and responses', assert => {
		// The responder handles datagrams in order, so a reply to any ignored query would arrive before the last one's.
		var sock = mdns('litejs-test.local')
		, client = createSocket('udp4')
		client.on('message', msg => {
			client.close()
			sock.close()
			assert.equal(msg.readUInt16BE(0), 5, 'only the last query answered')
			assert.end()
		})
		client.bind(0, () => retry(client, () => [
			['\0\x01\0\0', 'litejs-test.local', '\x01', '127.0.0.1'],
			['\0\x02\0\0', 'other.local', '\x01', addrs[0]],
			['\0\x03\0\0', 'litejs-test.local', '\x1c', addrs[0]],
			['\0\x04\x84\0', 'litejs-test.local', '\x01', addrs[0]],
			['\0\x05\0\0', 'litejs-test.local', '\x01', addrs[0]]
		].forEach(a => client.send(pkt(a[0], a[1], a[2]), 5353, a[3]))))
	})

	test('answers a query from port 5353 by multicast', assert => {
		var sock = mdns('litejs-test.local')
		, client = createSocket({ type: 'udp4', reuseAddr: true })
		client.on('message', msg => {
			if (msg.readUInt16BE(0) == 0x4321 && msg[2] & 128) {
				client.close()
				sock.close()
				assert.equal([...msg.subarray(-4)].join('.'), addrs[0], 'address on the sending interface')
				assert.end()
			}
		})
		client.bind(5353, () => {
			client.addMembership('224.0.0.251')
			client.setMulticastInterface(addrs[0])
			retry(client, () => client.send(pkt('\x43\x21\0\0', 'litejs-test.local', '\x01'), 5353, '224.0.0.251'))
		})
	})
})

