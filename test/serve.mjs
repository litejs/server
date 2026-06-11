
import '@litejs/cli/test.js'
import { serveRange, serveStatic } from '../lib/serve.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testDir = path.join(__dirname, '.static-test')

describe('serveStatic', () => {
	test('setup', async (assert) => {
		await fs.rm(testDir, { recursive: true, force: true })
		await fs.mkdir(testDir, { recursive: true })
		await fs.writeFile(path.join(testDir, 'index.html'), '<h1>Home</h1>')
		await fs.writeFile(path.join(testDir, 'hello.txt'), 'hello')
		await fs.writeFile(path.join(testDir, 'data.bin'), 'binary')
		assert.ok(true)
	})

	test('fetch index.html on root', async (assert) => {
		const assets = serveStatic(testDir)
		const res = await assets.fetch(new Request('http://localhost/'))
		assert.equal(res.status, 200)
		assert.equal(await res.text(), '<h1>Home</h1>')
		assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
	})

	test('fetch file by path', async (assert) => {
		const assets = serveStatic(testDir)
		const res = await assets.fetch(new Request('http://localhost/hello.txt'))
		assert.equal(res.status, 200)
		assert.equal(await res.text(), 'hello')
		assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8')
	})

	test('fetch file with unknown extension has no content-type', async (assert) => {
		const assets = serveStatic(testDir)
		const res = await assets.fetch(new Request('http://localhost/data.bin'))
		assert.equal(res.status, 200)
		assert.equal(await res.text(), 'binary')
		assert.equal(res.headers.get('content-type'), 'application/octet-stream')
		assert.equal(res.headers.get('content-length'), '6')
	})

	test('fetch missing file returns 404', async (assert) => {
		const assets = serveStatic(testDir)
		const res = await assets.fetch(new Request('http://localhost/missing.txt'))
		assert.equal(res.status, 404)
	})

	test('fetch blocks path traversal', async (assert) => {
		const assets = serveStatic(testDir)
		const res = await assets.fetch(new Request('http://localhost/../secret.txt'))
		assert.equal(res.status, 404)
	})

	test('fetch directory returns 404', async (assert) => {
		const assets = serveStatic(testDir)
		const subDir = path.join(testDir, 'subdir')
		await fs.mkdir(subDir, { recursive: true })
		const res = await assets.fetch(new Request('http://localhost/subdir'))
		assert.equal(res.status, 404)
	})

	test('fetch with URL encoded path traversal blocked', async (assert) => {
		const assets = serveStatic(testDir)
		const res = await assets.fetch(new Request('http://localhost/%2e%2e/secret.txt'))
		assert.equal(res.status, 404)
	})

	test('fetch with encoded-slash traversal blocked', async (assert) => {
		// %2f is not a path separator to the URL parser, so `..%2f` survives
		// normalization and only the resolved-path guard stops it.
		const assets = serveStatic(testDir)
		const res = await assets.fetch(new Request('http://localhost/%2e%2e%2fsecret.txt'))
		assert.equal(res.status, 404)
	})

	test('fetch with multiple path traversals blocked', async (assert) => {
		const assets = serveStatic(testDir)
		const res = await assets.fetch(new Request('http://localhost/../../../../../../etc/passwd'))
		assert.equal(res.status, 404)
	})

	test('dotfiles are not served', async (assert) => {
		await fs.writeFile(path.join(testDir, '.env'), 'SECRET=1')
		await fs.mkdir(path.join(testDir, '.git'), { recursive: true })
		await fs.writeFile(path.join(testDir, '.git', 'config'), 'cfg')
		const assets = serveStatic(testDir)
		assert.equal((await assets.fetch(new Request('http://localhost/.env'))).status, 404)
		assert.equal((await assets.fetch(new Request('http://localhost/.git/config'))).status, 404)
	})

	test('.well-known is served', async (assert) => {
		await fs.mkdir(path.join(testDir, '.well-known'), { recursive: true })
		await fs.writeFile(path.join(testDir, '.well-known', 'security.txt'), 'Contact: x')
		const assets = serveStatic(testDir)
		const res = await assets.fetch(new Request('http://localhost/.well-known/security.txt'))
		assert.equal(res.status, 200)
		assert.equal(await res.text(), 'Contact: x')
		// A lookalike prefix is not a bypass.
		assert.equal((await assets.fetch(new Request('http://localhost/.well-known-evil'))).status, 404)
	})

	test('cleanup', async (assert) => {
		await fs.rm(testDir, { recursive: true, force: true })
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

