
import { UNDEF, header, hex, hmac, isFn, isStr, toUint } from '../util.mjs'


var longDate = () => new Date().toJSON().replace(/-|:|\.\d*/g, '')
, rfc3986Enc = str => encodeURIComponent(str).replace(/[!'()]/g, escape).replace(/\*/g, '%2A')
, toQuery = pairs => pairs.filter(p => p[0] != 'X-Amz-Signature' && p[1] != UNDEF).map(p => p.map(rfc3986Enc).join('=')).sort().join('&')
// R2Object envelope, shared by S3 and the local R2 shim
, r2Object = (out, { key, size, etag = '', type = '', custom = {}, uploaded }) => Object.assign(out, {
	key,
	size: +size || 0,
	etag: etag = etag.replace(/"/g, ''),
	httpEtag: '"' + etag + '"',
	httpMetadata: { contentType: type },
	customMetadata: isStr(custom) ? JSON.parse(custom) : custom,
	uploaded: new Date(uploaded || Date.now()),
	writeHttpMetadata: headers => type && headers.set('content-type', type)
})
, putType = opts => opts?.httpMetadata?.contentType || opts?.contentType || 'application/octet-stream'
// Returns Uint8Array directly for sync KV, a Promise for stream-like ones
, r2Body = val => (
	isFn(val?.getReader) && (val = new Response(val)),
	isFn(val?.arrayBuffer) ? val.arrayBuffer().then(toUint) : val ? toUint(val) : ''
)
, checkStatus = res => {
	if (res.ok) return res
	var err = Error('S3 request failed: ' + res.status)
	err.code = res.status
	err.response = res
	throw err
}
, sigV4 = async (secret, scope, signedHeaders, method, url, headers) => {
	var key = 'AWS4' + secret
	, canonical = [
		method, url.pathname,
		toQuery([...url.searchParams]),
		signedHeaders.map(k => k + ':' + headers[k]).join('\n') + '\n',
		signedHeaders.join(';'), headers['x-amz-content-sha256'] || 'UNSIGNED-PAYLOAD',
	].join('\n')
	for (var part of scope.split('/')) key = await hmac(key, part)
	return hex(await hmac(key, 'AWS4-HMAC-SHA256\n' + headers['x-amz-date'] + '\n' + scope + '\n' + hex(await crypto.subtle.digest('SHA-256', toUint(canonical)))))
}
, awsApi = ({
	accessId, secret, bucket,
	region = 'auto', service = 's3', endpoint = service + '.' + region + '.amazonaws.com',
	fetch = globalThis.fetch,
	S = date => date.slice(0, 8) + '/' + region + '/' + service + '/aws4_request',
	U = (key, query) => new URL(
		'https://' + endpoint + '/' + (bucket ? bucket + '/' : '') + rfc3986Enc(key || '').replace(/%2F/g, '/') + (query ? '?' + toQuery(Object.entries(query)) : '')
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
	url: async (key, { method = 'GET', expires = 604800, date = longDate(), query } = {}) => {
		var scope = S(date)
		, url = U(key, {
			...query,
			'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
			'X-Amz-Credential': accessId + '/' + scope,
			'X-Amz-Date': date,
			'X-Amz-Expires': expires,
			'X-Amz-SignedHeaders': 'host'
		})
		return url + '&X-Amz-Signature=' + await sigV4(secret, scope, ['host'], method, url, { host: url.host, 'x-amz-date': date })
	},
})
// skew is the clock-drift allowance, and the whole validity window of a header-signed request
, awsVerify = async (req, getSecret, skew = 900) => {
	var url = new URL(req.url)
	, param = name => url.searchParams.get('X-Amz-' + name) || ''
	, [, credential, signedHeaders, signature] = /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=(\w+)$/.exec(header(req, 'authorization')) ||
		[, param('Credential'), param('SignedHeaders'), param('Signature')]
	, [id, ...scope] = credential.split('/')
	// longDate() is ISO 8601 basic, which Date.parse does not accept
	, signedAt = Date.parse((header(req, 'x-amz-date') || param('Date')).replace(/(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)/, '$1-$2-$3T$4:$5:'))
	, age = Date.now() - signedAt
	, secret = id
		&& age >= -1000 * skew
		&& age <= 1000 * (+param('Expires') || skew)
		&& await getSecret(id)
	return secret && signature === await sigV4(
		secret, scope.join('/'), signedHeaders.split(';'), req.method, url,
		{ host: url.host, 'x-amz-date': param('Date'), ...Object.fromEntries(req.headers) }
	) && id
}
, S3 = opts => {
	var api = awsApi(opts)
	, request = api.request
	, meta = (method, key, target) => request(method, key).then(res => {
		if (res.status === 404) return null
		var custom = {}
		for (var [k, val] of checkStatus(res).headers) if (k.startsWith('x-amz-meta-')) custom[k.slice(11)] = val
		return r2Object(target || res, {
			key,
			size: header(res, 'content-length'),
			etag: header(res, 'etag'),
			type: header(res, 'content-type'),
			custom,
			uploaded: header(res, 'last-modified')
		})
	})

	return {
		...api,
		get: key => meta('GET', key),
		head: key => meta('HEAD', key, {}),
		async put(key, value, opts) {
			var body = await r2Body(value)
			, type = putType(opts)
			, custom = opts?.customMetadata
			, extra = { 'content-type': type }
			for (var k in custom) extra['x-amz-meta-' + k] = custom[k]
			return r2Object({}, { key, size: body.length, etag: header(checkStatus(await request('PUT', key, body, '', extra)), 'etag'), type, custom })
		},
		async delete(keys) {
			await Promise.all([].concat(keys).map(key => request('DELETE', key).then(checkStatus)))
		},
		async list(opts = {}) {
			var xml = await checkStatus(await request('GET', '', null, {
				'list-type': 2, prefix: opts.prefix, 'max-keys': opts.limit, 'start-after': opts.cursor
			})).text()
			, objects = (xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || []).map(block => r2Object({}, Object.fromEntries(
				Array.from(block.matchAll(/<(\w+)>([^<]*)/g), m => [m[1] == 'LastModified' ? 'uploaded' : m[1].toLowerCase(), m[2]])
			)))
			, truncated = xml.includes('<IsTruncated>true<')
			return { objects, truncated, cursor: truncated ? objects.at(-1)?.key : UNDEF }
		}
	}
}

export { S3, awsApi, awsVerify, putType, r2Body, r2Object }

