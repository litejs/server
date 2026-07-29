
import { UNDEF, header, hex, isFn, isStr, toUint } from '../util.mjs'


var awsHash = async data => hex(await crypto.subtle.digest('SHA-256', toUint(data)))
, hmac = async (key, data) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey(
	'raw', toUint(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
), toUint(data))
, longDate = () => new Date().toJSON().replace(/-|:|\.\d*/g, '')
// R2Object envelope, shared by S3 and the local R2 shim
// Accepts values as stored: JSON string custom, string dates
, writeHttpMetadata = function(headers) {
	if (this.httpMetadata.contentType) headers.set('content-type', this.httpMetadata.contentType)
}
, r2Object = (out, { key, size, etag = '', type = '', custom = {}, uploaded }) => (
	etag = etag.replace(/"/g, ''),
	Object.assign(out, {
		key, size, etag,
		httpEtag: '"' + etag + '"',
		httpMetadata: { contentType: type },
		customMetadata: isStr(custom) ? JSON.parse(custom) : custom,
		uploaded: new Date(uploaded || Date.now()),
		writeHttpMetadata
	})
)
, putType = opts => opts?.httpMetadata?.contentType || opts?.contentType || 'application/octet-stream'
// Returns Uint8Array directly for sync KV, a Promise for stream-like ones
, r2Body = val => (
	val instanceof ReadableStream && (val = new Response(val)),
	isFn(val?.arrayBuffer) ? val.arrayBuffer().then(toUint) : val ? toUint(val) : ''
)
, sigV4 = async (secret, scope, signedHeaders, method, url, headers) => {
	url.searchParams.delete('X-Amz-Signature')
	var key = 'AWS4' + secret
	, canonical = [
		method, url.pathname,
		url.search.slice(1).split('&').sort().join('&'),
		signedHeaders.map(k => k + ':' + headers[k]).join('\n') + '\n',
		signedHeaders.join(';'), headers['x-amz-content-sha256'] || 'UNSIGNED-PAYLOAD',
	].join('\n')
	for (var part of scope.split('/')) key = await hmac(key, part)
	return hex(await hmac(key, 'AWS4-HMAC-SHA256\n' + headers['x-amz-date'] + '\n' + scope + '\n' + await awsHash(canonical)))
}
, awsApi = ({
	accessId, secret, bucket,
	region = 'auto', service = 's3', endpoint = service + '.' + region + '.amazonaws.com',
	fetch = globalThis.fetch,
	S = date => date.slice(0, 8) + '/' + region + '/' + service + '/aws4_request',
	U = (key, query) => new URL(
		'https://' + endpoint + '/' + (bucket ? bucket + '/' : '') + encodeURIComponent(key || '').replace(/%2F/g, '/') + (query ? '?' + query : '')
	)
}) => ({
	// Body is not hashed by default; pass a x-amz-content-sha256 header in extra for integrity-sensitive writes
	request: async (method, key, body, query, extra) => {
		var url = U(key, query)
		, headers = {
			host: url.host,
			'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
			'x-amz-date': longDate(),
			...extra
		}
		, scope = S(headers['x-amz-date'])
		, signedHeaders = Object.keys(headers).sort()
		headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + accessId + '/' + scope
			+ ', SignedHeaders=' + signedHeaders.join(';')
			+ ', Signature=' + await sigV4(secret, scope, signedHeaders, method, url, headers)
		delete headers.host
		return fetch('' + url, { method, headers, body })
	},
	// Returns the presigned URL for a key
	url: async (key, { method = 'GET', expires = 604800, date = longDate(), query } = {}) => {
		var url = U(key, query)
		, setParam = (name, value) => url.searchParams.set('X-Amz-' + name, value)
		, scope = S(date)
		, signedHeaders = ['host']
		setParam('Algorithm', 'AWS4-HMAC-SHA256')
		setParam('Credential', accessId + '/' + scope)
		setParam('Date', date)
		setParam('Expires', expires)
		setParam('SignedHeaders', signedHeaders)
		setParam('Signature', await sigV4(secret, scope, signedHeaders, method, url, { host: url.host, 'x-amz-date': date }))
		return '' + url
	},
})
, awsRe = /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=(\w+)$/
// longDate() is ISO 8601 basic, which Date.parse does not accept
, awsDate = date => Date.parse(date.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'))
// skew is the clock-drift allowance, and the whole validity window of a header-signed request
, awsVerify = async (req, getSecret, skew = 900) => {
	var url = new URL(req.url)
	, param = name => url.searchParams.get('X-Amz-' + name) || ''
	, [, credential, signedHeaders, signature] = awsRe.exec(header(req, 'authorization')) ||
		[, param('Credential'), param('SignedHeaders'), param('Signature')]
	, [id, ...scope] = credential.split('/')
	, signedAt = awsDate(header(req, 'x-amz-date') || param('Date'))
	, now = Date.now()
	, secret = id
		&& now >= signedAt - 1000 * skew
		&& now <= signedAt + 1000 * (+param('Expires') || skew)
		&& await getSecret(id)
	return secret && signature === await sigV4(
		secret, scope.join('/'), signedHeaders.split(';'), req.method, url,
		{ host: url.host, 'x-amz-date': param('Date'), ...Object.fromEntries(req.headers) }
	) && id
}
, S3 = opts => {
	var { request, url } = awsApi(opts)
	, meta = (method, key, target) => request(method, key).then(res => {
		if (res.status === 404) return null
		var custom = {}
		res.headers.forEach((val, k) => {
			if (k.startsWith('x-amz-meta-')) custom[k.slice(11)] = val
		})
		return r2Object(target || res, {
			key,
			size: +header(res, 'content-length') || 0,
			etag: header(res, 'etag'),
			type: header(res, 'content-type'),
			custom,
			uploaded: header(res, 'last-modified')
		})
	})

	return {
		request,
		url,
		get: key => meta('GET', key),
		head: key => meta('HEAD', key, {}),
		async put(key, value, opts = {}) {
			var body = await r2Body(value)
			, type = putType(opts)
			, extra = { 'content-type': type }
			for (var k in opts.customMetadata) extra['x-amz-meta-' + k] = opts.customMetadata[k]
			var res = await request('PUT', key, body, '', extra)
			return r2Object({}, {
				key,
				size: body.length,
				etag: header(res, 'etag'),
				type,
				custom: opts.customMetadata
			})
		},
		async delete(keys) {
			await Promise.all([].concat(keys).map(key => request('DELETE', key)))
		},
		async list(opts = {}) {
			var query = 'list-type=2'
			if (opts.prefix) query += '&prefix=' + encodeURIComponent(opts.prefix)
			if (opts.limit) query += '&max-keys=' + opts.limit
			if (opts.cursor) query += '&start-after=' + encodeURIComponent(opts.cursor)
			var xml = await (await request('GET', '', null, query)).text()
			, tags = block => Object.fromEntries(Array.from(block.matchAll(/<(\w+)>([^<]*)<\/\1>/g), m => [m[1] == 'LastModified' ? 'uploaded' : m[1].toLowerCase(), m[2]]))
			, objects = (xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || []).map(block => {
				var o = tags(block)
				o.size = +o.size || 0
				return r2Object({}, o)
			})
			, truncated = xml.includes('<IsTruncated>true<')
			return { objects, truncated, cursor: truncated ? objects.at(-1)?.key : UNDEF }
		}
	}
}

export { S3, awsApi, awsVerify, putType, r2Body, r2Object }

