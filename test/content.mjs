
import '@litejs/cli/test.js'
import { content, querystring } from '../content.mjs'

describe('content', () => {
	var boundary = '--0000012345z'
	, form = [
		'This is the preamble.',
		'--' + boundary,
		'Content-Disposition: form-data; name="ab[]"',
		'',
		'123',
		'--' + boundary,
		'Content-Disposition: form-data; name="ab[]"',
		'',
		'456',
		'--' + boundary,
		'Content-Disposition:form-data;name="c[d][e]"',
		'',
		'234',
		'--' + boundary,
		'Content-Disposition: form-data; name="file_0"; filename="ABC.txt"',
		'Content-Type: application/octet-stream',
		'',
		'A',
		'--' + boundary,
		'Content-Disposition: form-data; name="file_1"; filename="abc.txt"',
		'Content-Type: text/plain',
		'',
		'abcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefghhhhhhhhhhhabcdefgh',
		'--' + boundary + '--',
		'This is the epilogue.'
	].join('\r\n')
	, formBody = {
		ab: ['123', '456'],
		c: { d: { e: '234' } }
	}
	, req = (type, body, size) => new Request('http://localhost/', {
		method: 'POST',
		headers: { 'content-type': type },
		// Split the body into fixed-size chunks so boundaries land across chunk edges
		body: body == null ? null : ReadableStream.from(body.match(RegExp('[\\s\\S]{1,' + (size || body.length) + '}', 'g')).map(s => new TextEncoder().encode(s))),
		duplex: 'half'
	})
	, fails = promise => promise.then(() => null, e => e)

	test('querystring nests keys', assert => {
		assert
		.equal(querystring(''), {})
		.equal(querystring('a=1&b=2&a=3'), { a: ['1', '3'], b: '2' })
		.equal(querystring('a[]=1&a[]=2&b[c]=3&b[d][e]=4&e=%20+'), { a: ['1', '2'], b: { c: '3', d: { e: '4' } }, e: '  ' })
		.equal(querystring('a[0]=x&a[1]=y'), { a: ['x', 'y'] })
		.equal(querystring('a'), { a: '' })
		.equal(querystring('a=%C3%A9&b=%zz'), { a: 'é', b: '%zz' }, 'UTF-8 decoded, bad escapes kept')
		.end()
	})

	test('bracket keys cannot reach Object.prototype', async assert => {
		querystring('__proto__[polluted]=1&constructor[prototype][polluted]=1')
		await content(req('multipart/form-data;boundary=' + boundary, [
			'--' + boundary,
			'Content-Disposition: form-data; name="a[__proto__][deep]"',
			'',
			'1',
			'--' + boundary + '--'
		].join('\r\n')))
		assert.strictEqual(({}).polluted, undefined)
		assert.strictEqual(({}).deep, undefined)
	})

	test('parses {0}', [
		['application/json', '{"a":1}', { a: 1 }],
		['application/json', null, {}],
		['application/x-www-form-urlencoded', 'a=1&b[c]=2', { a: '1', b: { c: '2' } }],
	], async (type, body, expected, assert) => {
		assert.equal(await content(req(type, body)), expected)
	})

	test('accept extends the built-in types', async assert => {
		var opts = { accept: { 'text/csv;header=': (str, negod) => [negod.header, str] } }
		assert.equal(await content(req('text/csv;header=present', 'a,b'), opts), ['present', 'a,b'])
		assert.equal(await content(req('application/json', '{"a":1}'), opts), { a: 1 })
	})

	test('rejects {0}', [
		['unsupported type', req('text/plain', 'a'), null, 415, 'Unsupported Media Type'],
		['bad json', req('application/json', 'a=1'), null, undefined, /JSON/],
		['too large body', req('application/json', '{"a":12345}'), { maxBodySize: 8 }, 413, 'maxBodySize exceeded'],
		['too many fields', req('multipart/form-data;boundary=' + boundary, form), { maxFields: 2 }, 413, 'maxFields exceeded'],
		['too many files', req('multipart/form-data;boundary=' + boundary, form), { maxFiles: 1 }, 413, 'maxFiles exceeded'],
		['too long field', req('multipart/form-data;boundary=' + boundary, form), { maxFieldSize: 2 }, 413, 'maxFieldSize exceeded'],
		['too large file', req('multipart/form-data;boundary=' + boundary, form), { maxFileSize: 50 }, 413, 'maxFileSize exceeded'],
		['part without disposition', req('multipart/form-data;boundary=' + boundary, form.slice(0, 120)), null, 400, 'Bad Request'],
		['multipart without boundary', req('multipart/form-data', form), null, 400, 'Bad Request'],
		['multipart without body', req('multipart/form-data;boundary=' + boundary, null), null, 400, 'Bad Request'],
	], async (name, request, opts, code, message, assert) => {
		var err = await fails(content(request, opts))
		assert.ok(err instanceof Error)
		assert.equal(err.code, code)
		assert.ok(message.test ? message.test(err.message) : err.message === message, err.message)
	})

	test('multipart in chunks of {0}', [
		[1], [2], [3], [4], [5], [8], [16], [1000]
	], async (size, assert) => {
		var files = []
		, body = await content(req('multipart/form-data;boundary=' + boundary, form, size), {
			file: async part => {
				files.push([part.name, part.filename, part.type, await new Response(part.body).text()])
				return part.filename
			}
		})
		assert
		.equal(body, { ...formBody, file_0: 'ABC.txt', file_1: 'abc.txt' })
		.equal(files, [
			['file_0', 'ABC.txt', 'application/octet-stream', 'A'],
			['file_1', 'abc.txt', 'text/plain', 'abcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefghhhhhhhhhhhabcdefgh'],
		])
	})

	test('files become File objects without a file handler', async assert => {
		var body = await content(req('multipart/form-data;boundary=' + boundary, form, 7))
		assert.equal(body.ab, formBody.ab)
		assert.ok(body.file_0 instanceof File)
		assert.equal([body.file_0.name, body.file_0.type, await body.file_0.text()], ['ABC.txt', 'application/octet-stream', 'A'])
		assert.equal([body.file_1.name, body.file_1.size], ['abc.txt', 96])
	})

	test('file handler result is the field value', async assert => {
		var body = await content(req('multipart/form-data;boundary=' + boundary, form, 7), {
			file: part => part.name === 'file_0' ? { saved: true } : undefined
		})
		assert.equal(body.file_0, { saved: true })
		assert.strictEqual(body.file_1, undefined)
	})

	test('a file body streams while later parts are still unread', async assert => {
		var seen = []
		, body = await content(req('multipart/form-data;boundary=' + boundary, form, 3), {
			file: async part => (seen.push(part.name, await new Response(part.body).text()), part.name)
		})
		assert.equal(seen, ['file_0', 'A', 'file_1', 'abcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefgabcdefghhhhhhhhhhhabcdefgh'])
		assert.equal(body.file_1, 'file_1')
	})

	test('first boundary at byte zero, no preamble', async assert => {
		var body = await content(req('multipart/form-data;boundary=' + boundary, form.slice(form.indexOf('--')), 4))
		assert.equal(body.c, formBody.c)
	})

	test('truncated multipart ends without hanging', async assert => {
		var body = await content(req('multipart/form-data;boundary=' + boundary, form.slice(0, 157), 5))
		assert.equal(body, { ab: ['123', '4'] })
	})
})
