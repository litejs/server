
import '@litejs/cli/test.js'
import { S3, awsApi, awsVerify, r2Object } from '../lib/s3.mjs'


var testOpts = {
	endpoint: 's3.us-east-1.amazonaws.com',
	region: 'us-east-1',
	bucket: 'test-bucket',
	accessId: 'AKIAIOSFODNN7EXAMPLE',
	secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
}
var opts = { region: 'us-east-1', accessId: 'AKID', secret: 'SECRET', service: 's3' }

function mock(handler) {
	return S3(Object.assign({ fetch: handler }, testOpts))
}

describe('s3.mjs', () => {

	test('signing produces correct Authorization header', async (assert) => {
		var s3 = mock(function(url, opts) {
			assert.ok(opts.headers.authorization.startsWith('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/'))
			assert.ok(opts.headers.authorization.indexOf('SignedHeaders=') > -1)
			assert.ok(opts.headers.authorization.indexOf('Signature=') > -1)
			assert.ok(opts.headers['x-amz-date'])
			assert.ok(opts.headers['x-amz-content-sha256'])
			return new Response('')
		})
		await s3.get('test.txt')

	})

	test('get returns Response with R2 metadata', async (assert) => {
		var s3 = mock(function(url, opts) {
			assert.equal(opts.method, 'GET')
			assert.ok(url.indexOf('/test-bucket/hello.txt') > -1)
			return new Response('Hello!', {
				headers: {
					'content-type': 'text/plain',
					'content-length': '6',
					'etag': '"abc123"',
					'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT'
				}
			})
		})
		var res = await s3.get('hello.txt')
		assert.equal(res.key, 'hello.txt')
		assert.equal(res.size, 6)
		assert.equal(res.etag, 'abc123')
		assert.equal(res.httpMetadata.contentType, 'text/plain')
		assert.equal(await res.text(), 'Hello!')

	})

	test('writeHttpMetadata copies contentType when set, skips when empty', async (assert) => {
		var withType = mock(function() {
			return new Response('x', { headers: { 'content-type': 'text/html' } })
		})
		, res = await withType.get('k')
		, h = new Headers()
		res.writeHttpMetadata(h)
		assert.equal(h.get('content-type'), 'text/html')

		var noType = mock(function() {
			return new Response(null)
		})
		, res2 = await noType.head('k')
		, h2 = new Headers()
		res2.writeHttpMetadata(h2)
		assert.equal(h2.get('content-type'), null)

	})

	test('get returns null for 404', async (assert) => {
		var s3 = mock(function() {
			return new Response('Not Found', { status: 404 })
		})
		assert.equal(await s3.get('missing'), null)

	})

	test('get with custom metadata from headers', async (assert) => {
		var s3 = mock(function() {
			return new Response('data', {
				headers: {
					'content-length': '4',
					'etag': '"e1"',
					'x-amz-meta-owner': 'test',
					'x-amz-meta-env': 'dev'
				}
			})
		})
		var res = await s3.get('key')
		assert.equal(res.customMetadata.owner, 'test')
		assert.equal(res.customMetadata.env, 'dev')

	})

	test('put sends body and returns metadata', async (assert) => {
		var s3 = mock(function(url, opts) {
			assert.equal(opts.method, 'PUT')
			assert.ok(url.indexOf('/test-bucket/file.txt') > -1)
			assert.equal(opts.headers['content-type'], 'text/plain')
			return new Response('', {
				headers: { 'etag': '"put-etag"' }
			})
		})
		var res = await s3.put('file.txt', 'content', { contentType: 'text/plain' })
		assert.equal(res.key, 'file.txt')
		assert.equal(res.size, 7)
		assert.equal(res.etag, 'put-etag')
		assert.equal(res.httpMetadata.contentType, 'text/plain')
		assert.ok(res.uploaded instanceof Date)

	})

	test('put with httpMetadata and customMetadata', async (assert) => {
		var s3 = mock(function(url, opts) {
			assert.equal(opts.headers['content-type'], 'image/png')
			assert.equal(opts.headers['x-amz-meta-author'], 'test')
			return new Response('', { headers: { 'etag': '"e2"' } })
		})
		var res = await s3.put('img.png', 'data', {
			httpMetadata: { contentType: 'image/png' },
			customMetadata: { author: 'test' }
		})
		assert.equal(res.httpMetadata.contentType, 'image/png')
		assert.equal(res.customMetadata.author, 'test')

	})

	test('put with null value sends empty body', async (assert) => {
		var s3 = mock(function(url, opts) {
			assert.equal(opts.body, '')
			return new Response('', { headers: { 'etag': '"e0"' } })
		})
		var res = await s3.put('empty', null)
		assert.equal(res.size, 0)

	})

	test('head returns metadata', async (assert) => {
		var s3 = mock(function(url, opts) {
			assert.equal(opts.method, 'HEAD')
			return new Response(null, {
				headers: {
					'content-length': '42',
					'etag': '"head-etag"',
					'content-type': 'application/json',
					'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT'
				}
			})
		})
		var res = await s3.head('data.json')
		assert.equal(res.key, 'data.json')
		assert.equal(res.size, 42)
		assert.equal(res.etag, 'head-etag')
		assert.equal(res.httpMetadata.contentType, 'application/json')

	})

	test('head returns null for 404', async (assert) => {
		var s3 = mock(function() {
			return new Response(null, { status: 404 })
		})
		assert.equal(await s3.head('missing'), null)

	})

	test('delete single key', async (assert) => {
		var deleted = []
		var s3 = mock(function(url, opts) {
			assert.equal(opts.method, 'DELETE')
			deleted.push(url)
			return new Response('')
		})
		await s3.delete('key1')
		assert.equal(deleted.length, 1)
		assert.ok(deleted[0].indexOf('/test-bucket/key1') > -1)

	})

	test('delete array of keys', async (assert) => {
		var deleted = []
		var s3 = mock(function(url, opts) {
			assert.equal(opts.method, 'DELETE')
			deleted.push(url)
			return new Response('')
		})
		await s3.delete(['a', 'b', 'c'])
		assert.equal(deleted.length, 3)

	})

	test('list parses XML response', async (assert) => {
		var s3 = mock(function(url, opts) {
			assert.equal(opts.method, 'GET')
			assert.ok(url.indexOf('list-type=2') > -1)
			return new Response(
				'<ListBucketResult>' +
				'<IsTruncated>false</IsTruncated>' +
				'<Contents><Key>a.txt</Key><Size>10</Size><ETag>"e1"</ETag><LastModified>2024-01-01T00:00:00Z</LastModified></Contents>' +
				'<Contents><Key>b.txt</Key><Size>20</Size><ETag>"e2"</ETag><LastModified>2024-01-02T00:00:00Z</LastModified></Contents>' +
				'</ListBucketResult>'
			)
		})
		var res = await s3.list()
		assert.equal(res.objects.length, 2)
		assert.equal(res.objects[0].key, 'a.txt')
		assert.equal(res.objects[0].size, 10)
		assert.equal(res.objects[0].etag, 'e1')
		assert.equal(res.objects[1].key, 'b.txt')
		assert.equal(res.truncated, false)
		assert.equal(res.cursor, undefined)

	})

	test('list with prefix and limit', async (assert) => {
		var s3 = mock(function(url) {
			assert.ok(url.indexOf('prefix=img%2F') > -1)
			assert.ok(url.indexOf('max-keys=10') > -1)
			return new Response(
				'<ListBucketResult>' +
				'<IsTruncated>false</IsTruncated>' +
				'<Contents><Key>img/a.png</Key><Size>100</Size><ETag>"e1"</ETag><LastModified>2024-01-01T00:00:00Z</LastModified></Contents>' +
				'</ListBucketResult>'
			)
		})
		var res = await s3.list({ prefix: 'img/', limit: 10 })
		assert.equal(res.objects.length, 1)
		assert.equal(res.objects[0].key, 'img/a.png')

	})

	test('list with pagination', async (assert) => {
		var s3 = mock(function(url) {
			if (url.indexOf('start-after=') === -1) {
				return new Response(
					'<ListBucketResult>' +
					'<IsTruncated>true</IsTruncated>' +
					'<Contents><Key>a</Key><Size>1</Size><ETag>"e1"</ETag><LastModified>2024-01-01T00:00:00Z</LastModified></Contents>' +
					'<Contents><Key>b</Key><Size>2</Size><ETag>"e2"</ETag><LastModified>2024-01-02T00:00:00Z</LastModified></Contents>' +
					'</ListBucketResult>'
				)
			}
			return new Response(
				'<ListBucketResult>' +
				'<IsTruncated>false</IsTruncated>' +
				'<Contents><Key>c</Key><Size>3</Size><ETag>"e3"</ETag><LastModified>2024-01-03T00:00:00Z</LastModified></Contents>' +
				'</ListBucketResult>'
			)
		})
		var page1 = await s3.list({ limit: 2 })
		assert.equal(page1.objects.length, 2)
		assert.equal(page1.truncated, true)
		assert.equal(page1.cursor, 'b')

		var page2 = await s3.list({ limit: 2, cursor: page1.cursor })
		assert.equal(page2.objects.length, 1)
		assert.equal(page2.objects[0].key, 'c')
		assert.equal(page2.truncated, false)

	})

	test('list empty bucket', async (assert) => {
		var s3 = mock(function() {
			return new Response(
				'<ListBucketResult>' +
				'<IsTruncated>false</IsTruncated>' +
				'</ListBucketResult>'
			)
		})
		var res = await s3.list()
		assert.equal(res.objects.length, 0)
		assert.equal(res.truncated, false)

	})

	test('url returns presigned URL string', async (assert) => {
		var s3 = S3(Object.assign({}, testOpts))
		var url = await s3.url('my/file.txt')
		assert.ok(url.startsWith('https://s3.us-east-1.amazonaws.com/test-bucket/my/file.txt?'))
		assert.ok(url.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'))
		assert.ok(url.includes('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE'))
		assert.ok(url.includes('X-Amz-Signature='))
	})

	test('url with custom method and expires', async (assert) => {
		var s3 = S3(Object.assign({}, testOpts))
		var url = await s3.url('key', { method: 'PUT', expires: 600 })
		assert.ok(url.startsWith('https://'))
		assert.ok(url.includes('X-Amz-Expires=600'))
	})

	test('default endpoint from region', async (assert) => {
		var s3 = S3({
			region: 'eu-west-1',
			bucket: 'b',
			accessId: 'AKID',
			secret: 'SECRET',
			fetch: function(url) {
				assert.ok(url.startsWith('https://s3.eu-west-1.amazonaws.com/b/'))
				return new Response('')
			}
		})
		await s3.get('k')
	})

	test('no bucket option', async (assert) => {
		var s3 = S3({
			endpoint: 's3.us-east-1.amazonaws.com',
			region: 'us-east-1',
			accessId: 'AKID',
			secret: 'SECRET',
			fetch: function(url) {
				assert.ok(url.startsWith('https://s3.us-east-1.amazonaws.com/k'))
				return new Response('')
			}
		})
		await s3.get('k')
	})

	test('put with Uint8Array body', async (assert) => {
		var s3 = mock(function(url, opts) {
			return new Response('', { headers: { 'etag': '"bin"' } })
		})
		var buf = new Uint8Array([1, 2, 3, 4])
		var res = await s3.put('bin', buf)
		assert.equal(res.size, 4)
		assert.equal(res.etag, 'bin')
	})

	test('put with ReadableStream body', async (assert) => {
		var s3 = mock(function() {
			return new Response('', { headers: { 'etag': '"rs"' } })
		})
		var res = await s3.put('rs', new Response('hello').body)
		assert.equal(res.size, 5)
		assert.equal(res.etag, 'rs')
	})

	test('r2Object parses string customMetadata', async (assert) => {
		var o = r2Object({}, { key: 'k', size: 0, custom: '{"a":"b"}' })
		assert.equal(o.customMetadata.a, 'b')
	})

	test('list single object wraps in array', async (assert) => {
		var s3 = mock(function() {
			return new Response(
				'<ListBucketResult>' +
				'<IsTruncated>false</IsTruncated>' +
				'<Contents><Key>only.txt</Key><Size>5</Size><ETag>"e1"</ETag><LastModified>2024-01-01T00:00:00Z</LastModified></Contents>' +
				'</ListBucketResult>'
			)
		})
		var res = await s3.list()
		assert.equal(res.objects.length, 1)
		assert.equal(res.objects[0].key, 'only.txt')
	})

	test('list with three objects collects repeated tags', async (assert) => {
		var s3 = mock(function() {
			return new Response(
				'<ListBucketResult>' +
				'<IsTruncated>false</IsTruncated>' +
				'<Contents><Key>a</Key><Size>1</Size><ETag>"e1"</ETag><LastModified>2024-01-01T00:00:00Z</LastModified></Contents>' +
				'<Contents><Key>b</Key><Size>2</Size><ETag>"e2"</ETag><LastModified>2024-01-02T00:00:00Z</LastModified></Contents>' +
				'<Contents><Key>c</Key><Size>3</Size><ETag>"e3"</ETag><LastModified>2024-01-03T00:00:00Z</LastModified></Contents>' +
				'</ListBucketResult>'
			)
		})
		var res = await s3.list()
		assert.equal(res.objects.length, 3)
		assert.equal(res.objects[2].key, 'c')
	})

	test('list tolerates a response without ListBucketResult', async (assert) => {
		var s3 = mock(function() {
			return new Response('')
		})
		var res = await s3.list()
		assert.equal(res.objects.length, 0)
		assert.equal(res.truncated, false)
		assert.equal(res.cursor, undefined)
	})

	test('list handles empty and zero values', async (assert) => {
		var s3 = mock(function() {
			return new Response(
				'<ListBucketResult>' +
				'<IsTruncated>false</IsTruncated>' +
				'<Contents><Key>a</Key><Size>0</Size><ETag></ETag><LastModified>2024-01-01T00:00:00Z</LastModified></Contents>' +
				'</ListBucketResult>'
			)
		})
		var res = await s3.list()
		assert.equal(res.objects.length, 1)
		assert.equal(res.objects[0].etag, '')
		assert.equal(res.objects[0].size, 0)
	})

	test('get with missing headers uses defaults', async (assert) => {
		var s3 = mock(function() {
			return new Response('data')
		})
		var res = await s3.get('k')
		assert.equal(res.key, 'k')
		assert.equal(res.size, 0)
		assert.equal(res.etag, '')
	})

	test('url without bucket', async (assert) => {
		var s3 = S3({
			endpoint: 's3.us-east-1.amazonaws.com',
			region: 'us-east-1',
			accessId: 'AKID',
			secret: 'SECRET',
		})
		var url = await s3.url('my-key')
		assert.ok(url.startsWith('https://s3.us-east-1.amazonaws.com/my-key?'))
	})

	test('request escape hatch for unwrapped S3 calls', async (assert) => {
		var s3 = mock(function(url, opts) {
			assert.equal(opts.method, 'POST')
			assert.ok(url.indexOf('/test-bucket/big.bin?uploads') > -1)
			assert.ok(opts.headers.authorization)
			return new Response('')
		})
		var res = await s3.request('POST', 'big.bin', null, 'uploads')
		assert.equal(res.status, 200)
	})

	test('custom endpoint and region', async (assert) => {
		var s3 = S3({
			endpoint: 'minio.local:9000',
			region: 'us-west-2',
			bucket: 'custom',
			accessId: 'minioadmin',
			secret: 'minioadmin',
			fetch: function(url, opts) {
				assert.ok(url.startsWith('https://minio.local:9000/custom/'))
				assert.ok(opts.headers.authorization.indexOf('us-west-2') > -1)
				return new Response('')
			}
		})
		await s3.get('test')

	})
})


describe('awsApi', () => {
	function getSecret(id) {
		return id === 'AKID' ? 'SECRET' : null
	}

	test('sign and verify roundtrip', async (assert) => {
		var req
		, api = awsApi(Object.assign({
			fetch: (url, init) => (req = new Request(url, { headers: init.headers }), new Response())
		}, opts))
		await api.request('GET', 'bucket/key', 'hello')
		assert.equal(await awsVerify(req, getSecret), 'AKID')
	})

	test('verify rejects {0}', [
		['unknown access id', '', '/', null, null],
		['wrong secret', '', '/', 'WRONG', false],
		['tampered path', 'bucket/key', '/bucket/other', 'SECRET', false],
	], async function(name, signKey, verifyPath, sec, expected, assert) {
		var headers
		, api = awsApi(Object.assign({
			fetch: (url, init) => (headers = init.headers, new Response())
		}, opts))
		await api.request('GET', signKey, '')
		assert.equal(
			await awsVerify(new Request('https://s3.us-east-1.amazonaws.com' + verifyPath, { headers }), function() { return sec }),
			expected
		)
	})

	test('presigned url', async (assert) => {
		var sign = awsApi({
			endpoint: 's3-eu-central-1.amazonaws.com',
			bucket: 'buck-1',
			region: 'eu-central-1',
			accessId: 'AKIAIOSFODNN7EXAMPLE',
			secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
		})
		assert.equal(
			await sign.url('hello.txt', { expires: 86400, date: '20220423T130929Z' }),
			'https://s3-eu-central-1.amazonaws.com/buck-1/hello.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20220423%2Feu-central-1%2Fs3%2Faws4_request&X-Amz-Date=20220423T130929Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=f73cf5288c0c7049b17fb136505359fecb13051e67c42d77e657f15d63c3edef'
		)
	})

	test('presigned url default expires', async (assert) => {
		var sign = awsApi(opts)
		, url = await sign.url('bucket/key')
		assert.ok(url.indexOf('X-Amz-Expires=604800') > -1)
		assert.ok(url.indexOf('X-Amz-Signature=') > -1)
	})

	test('verify accepts presigned url, rejects tampered one', async (assert) => {
		var sign = awsApi(opts)
		, url = await sign.url('bucket/key')
		assert.equal(await awsVerify(new Request(url), getSecret), 'AKID')
		assert.equal(await awsVerify(new Request(url.replace('/key', '/other')), getSecret), false)
	})

	test('verify accepts presigned url carrying extra query params', async (assert) => {
		var sign = awsApi(opts)
		, url = await sign.url('bucket/key', { query: 'versionId=42' })
		assert.equal(await awsVerify(new Request(url), getSecret), 'AKID')
		assert.equal(await awsVerify(new Request(url.replace('versionId=42', 'versionId=43')), getSecret), false, 'tampered param rejected')
	})

	test('verify rejects request with neither header nor query auth', async (assert) => {
		assert.notOk(await awsVerify(new Request('https://s3.us-east-1.amazonaws.com/bucket/key'), getSecret))
		assert.notOk(await awsVerify(new Request('https://s3.us-east-1.amazonaws.com/bucket/key', { headers: { authorization: 'Basic xyz' } }), getSecret), 'unparseable header')
	})
})

