
import { interfaces, udpServer } from '#runtime'

var mdns = name => {
	var MDNS = '224.0.0.251'
	, ipNum = ip => ip.split('.').reduce((n, b) => n * 256 + +b, 0)
	, q = name.toLowerCase().split('.').map(l => String.fromCharCode(l.length) + l).join('') + '\0\0\x01'
	, sock = udpServer(5353, (data, addr, port) => {
		var ip
		, str = String.fromCharCode(...data)
		if (data[2] < 128 && str.toLowerCase().indexOf(q, 12) > 0 && (ip = interfaces().find(
			i => i.family == 'IPv4' && !i.internal && !((ipNum(i.address) ^ ipNum(addr)) & ipNum(i.netmask))
		))) sock.send(Uint8Array.from(
			str[0] + str[1] + '\x84\0\0\0\0\x01\0\0\0\0' + q + String.fromCharCode(128,1,0,0,0,120,0,4, ...ip.address.split('.')),
			c => c.charCodeAt()
		), port == 5353 ? MDNS : addr, port)
	}, { group: MDNS, reuseAddr: true })
	return sock
}

export { mdns }

