
import '@litejs/cli/test.js'
import { serveStatic } from '../lib/static.mjs'
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

