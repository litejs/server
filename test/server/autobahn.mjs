
// Runs the Autobahn fuzzing client against the Node codec: npm run test:autobahn [case ...]
// Needs docker or podman; the first run pulls the 1 GB crossbario/autobahn-testsuite image.
// The container reaches the server over host networking, which is a Linux feature;
// Docker Desktop on macOS or Windows would need host.docker.internal in place of 127.0.0.1.
// The HTML report lands in the system temp dir.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fail, serve, WebSocketServer } from '../../index.mjs'

var dir = tmpdir() + '/litejs-autobahn'
, port = 9001
, agent = 'litejs-node-ws'
, cases = process.argv.slice(2)
, runner = ['docker', 'podman'].find(cmd => spawnSync(cmd, ['--version']).status === 0) || fail('Needs docker or podman')
, echo = { message: (socket, data) => socket.send(data) }
, server = serve(WebSocketServer({ '': echo }, () => 404), { PORT: port, BIND_ADDR: '0.0.0.0' })
, passRe = /^(OK|NON-STRICT|INFORMATIONAL|UNIMPLEMENTED)$/
, counts = {}
, bad = []

mkdirSync(dir + '/config', { recursive: true })
mkdirSync(dir + '/reports', { recursive: true })
writeFileSync(dir + '/config/fuzzingclient.json', JSON.stringify({
	outdir: '/reports',
	servers: [{ agent, url: 'ws://127.0.0.1:' + port }],
	cases: cases.length ? cases : ['*'],
	'exclude-cases': [],
	'exclude-agent-cases': {}
}))
// The container shares the host network to reach the port; :Z relabels the mounts for SELinux
await new Promise(resolve => spawn(runner, [
	'run', '--rm', '--network', 'host',
	'-v', dir + '/config:/config:Z', '-v', dir + '/reports:/reports:Z',
	'docker.io/crossbario/autobahn-testsuite', 'wstest', '-m', 'fuzzingclient', '-s', '/config/fuzzingclient.json'
], { stdio: 'inherit' }).on('close', resolve))
server.close()

for (var [id, r] of Object.entries(JSON.parse(readFileSync(dir + '/reports/index.json', 'utf8'))[agent])) {
	counts[r.behavior] = (counts[r.behavior] || 0) + 1
	// Compression is unimplemented on purpose, so only the rest is worth listing
	if (r.behavior !== 'OK' && r.behavior !== 'UNIMPLEMENTED' || r.behaviorClose !== 'OK') bad.push(id + ' ' + r.behavior + ', close ' + r.behaviorClose)
	if (!passRe.test(r.behavior) || !passRe.test(r.behaviorClose)) process.exitCode = 1
}
console.log(counts)
console.log(bad.join('\n'))
console.log('Report: ' + dir + '/reports/index.html')
