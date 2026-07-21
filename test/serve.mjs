
import '@litejs/cli/test.js'
import { serveRange, serveStatic } from '../lib/serve.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('serveStatic', () => {
	var assets
	, testDir = path.join(__dirname, '_static-test')
	, pubDir = path.join(testDir, 'pub')
	, subDir = path.join(pubDir, 'sub')
	, siblingDir = pubDir + '2'

	test('setup', (assert) => {
		fs.rmSync(testDir, { recursive: true, force: true })

		fs.mkdirSync(subDir, { recursive: true })
		fs.writeFileSync(path.join(subDir, 'img.png'), 'PNG')

		fs.writeFileSync(path.join(pubDir, '.env'), 'SECRET=1')
		fs.writeFileSync(path.join(pubDir, 'index.html'), '<h1>Home</h1>')
		fs.writeFileSync(path.join(pubDir, 'hello.txt'), 'hello')
		fs.writeFileSync(path.join(pubDir, 'data.bin'), 'binary')

		fs.mkdirSync(siblingDir, { recursive: true })
		fs.writeFileSync(path.join(testDir, 'secret.txt'), 'SECRET1')
		fs.writeFileSync(path.join(siblingDir, 'secret.txt'), 'SECRET2')

		fs.mkdirSync(path.join(pubDir, '.git'), { recursive: true })
		fs.writeFileSync(path.join(pubDir, '.git', 'config'), 'cfg')

		fs.mkdirSync(path.join(pubDir, '.well-known'), { recursive: true })
		fs.writeFileSync(path.join(pubDir, '.well-known', 'security.txt'), 'Contact: x')

		fs.mkdirSync(path.join(pubDir, '.well-known2'), { recursive: true })
		fs.writeFileSync(path.join(pubDir, '.well-known2', 'evil.txt'), 'Evil')

		assets = serveStatic(pubDir)
		assert.type(assets.fetch, 'asyncfunction')
		assert.end()
	})

	test('200 - {0}fetch index.html on root', [
		[ 'index.html on root', 'http://localhost/', '<h1>Home</h1>', 'text/html; charset=utf-8' ],
		[ 'file', 'http://localhost/hello.txt', 'hello', 'text/plain; charset=utf-8' ],
		[ 'subdir', 'http://localhost/sub/img.png', 'PNG', 'image/png' ],
		[ 'unknown extension', 'http://localhost/data.bin', 'binary', 'application/octet-stream' ],
		[ '.well-known is served', 'http://localhost/.well-known/security.txt', 'Contact: x', 'text/plain; charset=utf-8' ]
	], async (name, url, text, type, assert) => {
		const res = await assets.fetch(new Request(url))
		assert.equal(res.status, 200)
		assert.equal(await res.text(), text)
		assert.equal(res.headers.get('content-type'), type)
	})

	test('404 - {0}', [
		[ 'missing file', 'http://localhost/missing.txt' ],
		[ 'path traversal', 'http://localhost/../secret.txt' ],
		[ 'path traversal same root prefix', 'http://localhost/../pub2/secret.txt' ],
		[ 'URL encoded path traversal', 'http://localhost/%2e%2e/secret.txt' ],
		[ 'encoded-slash path traversal', 'http://localhost/%2e%2e%2fsecret.txt' ],
		[ 'multiple path traversals', 'http://localhost/../../tsconfig.json' ],
		[ 'fetch directory', 'http://localhost/sub' ],
		[ 'dotfiles', 'http://localhost/.env' ],
		[ 'dotdir', 'http://localhost/.git/config' ],
		[ '.well-known prefix', 'http://localhost/.well-known2/evil.txt'],
	], async (desc, url, assert) => {
		try {
			var file = decodeURIComponent(url.slice(17))
			, exists = file === 'missing.txt' || !!fs.statSync(path.join(pubDir, file), { throwIfNoEntry: false })
			//console.log(exists, file, path.join(pubDir, file))
			assert.equal(exists, true)
		} catch {}
		assert.equal(await assets.fetch(new Request(url)), 404)
	})

	test('cleanup', async (assert) => {
		fs.rmSync(testDir, { recursive: true, force: true })
		assert.ok(true)
	})
})

describe('serveRange', () => {
	var body = '0123456789'
	, full = () => new Response(body, { headers: { 'content-length': '10', 'content-type': 'text/plain' } })
	, get = headers => new Request('http://localhost/f', { headers })

	it('serves {0} as bytes {1}', [
		['bytes=0-3', '0-3/10', '0123'],
		['bytes=4-', '4-9/10', '456789'],
		['bytes=-3', '7-9/10', '789'],
		['bytes=0-0', '0-0/10', '0'],
	], async (range, contentRange, expected, assert) => {
		var res = await serveRange(get({ range }), full())
		assert.equal(res.status, 206)
		assert.equal(await res.text(), expected)
		assert.equal(res.headers.get('content-range'), 'bytes ' + contentRange)
		assert.equal(res.headers.get('content-length'), '' + expected.length)
		assert.equal(res.headers.get('content-type'), 'text/plain', 'other headers are kept')
	})

	it('serves the full body for {1}', [
		[{}, 'no Range header'],
		[{ range: 'bytes=4-2' }, 'a backwards range'],
		[{ range: 'bytes=10-' }, 'an unsatisfiable range'],
		[{ range: 'bytes=0-99' }, 'an over-long range'],
		[{ range: 'bytes=-99' }, 'an over-long suffix'],
		[{ range: 'bytes=-' }, 'an empty range'],
		[{ range: 'bytes=0-1,3-4' }, 'multiple ranges'],
		[{ range: 'items=0-1' }, 'unknown units'],
		[{ range: 'bytes=0-3', 'if-range': '"v1"' }, 'If-Range (validators are not tracked)'],
	], async (headers, name, assert) => {
		var res = full()
		assert.strictEqual(await serveRange(get(headers), res), res, 'response passes through untouched')
	})

	test('passes through when status or length disqualify', async (assert) => {
		var missing = new Response(null, { status: 404 })
		assert.strictEqual(await serveRange(get({ range: 'bytes=0-1' }), Promise.resolve(missing)), missing, 'non-200 and promised responses')
		// An upstream (R2, assets, a nested serveRange) may have honored Range already.
		var partial = new Response('23', { status: 206, headers: { 'content-length': '2', 'content-range': 'bytes 2-3/10' } })
		assert.strictEqual(await serveRange(get({ range: 'bytes=2-3' }), partial), partial, 'an already-ranged 206 is not sliced again')
		var unsized = new Response(body, { headers: { 'content-type': 'text/plain' } })
		unsized.headers.delete('content-length')
		assert.strictEqual(await serveRange(get({ range: 'bytes=0-1' }), unsized), unsized, 'unknown content-length')
	})
})

