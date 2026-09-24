
import '@litejs/cli/test.js'
import { Oauth, basic, basicChallenge, basicDec, basicEnc, csrf, digest, digestChallenge, digestDec, digestEnc, digestHA1, digestResponse } from '../index.mjs'
import { b64Url, hmac, ts } from '../util.mjs'

describe('auth.mjs', () => {
	test('basicEnc RFC 7617 - {0}', [
		[ 'Aladdin', 'open sesame', 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==' ],
		[ 'test', '123£', 'Basic dGVzdDoxMjPCow==' ],
		[ 'user', 'pass:word:123', 'Basic dXNlcjpwYXNzOndvcmQ6MTIz' ],
		[ 'Jörg', 'secret', 'Basic SsO2cmc6c2VjcmV0' ],
	], (name, pass, header, assert) => {
		assert
		.equal(basicEnc(name, pass), header)
		.equal(basicDec(header), [name, pass], 'the full header parses')
		.equal(basicDec(header.slice(6)), [name, pass], 'so does the bare credential')
		.equal(basicEnc(...basicDec(header)), header, 'the pair roundtrips')
		.end()
	})

	test('basicDec rejects {0}', [
		[ 'no colon', 'dXNlcg' ],
		[ 'empty name', 'OnBhc3M' ],
		[ 'bad base64', '@@' ],
	], (_, cred, assert) => {
		assert.notOk(basicDec(cred)).end()
	})

	test('digestHA1 computes the RFC 7616 HA1', async assert => {
		assert.equal(await digestHA1('Mufasa', 'http-auth@example.org', 'Circle of Life'), '7987c64c30e25f1b74be53f966b49b90f2808aa92faf9a00262392d7b4794232')
	})

	test('basicChallenge quotes env.REALM', assert => {
		assert.equal(basicChallenge({ REALM: 'app' }), 'Basic realm="app"').end()
	})

	describe('basic scheme', () => {
		var realm = 'app'
		, stored = { alice: '' }
		, users = (env, name) => env.ok && stored[name]
		, handler = (req, env, cred) => basic(req, env, cred, users)
		, env = { ok: true, REALM: realm }

		test('setup', async () => {
			stored.alice = await digestHA1('alice', realm, 'secret')
		})

		test('accepts a matching password and returns the user', async assert => {
			var req = {}
			assert
			.equal(await handler(req, env, basicEnc('alice', 'secret').slice(6)), 'alice')
			.equal(req, {}, 'req is left alone')
		})

		test('rejects {0}', [
			[ 'a wrong password', basicEnc('alice', 'secre').slice(6) ],
			[ 'an unknown user', basicEnc('nobody', 'secret').slice(6) ],
			[ 'a malformed credential', '@@' ],
			[ 'no credential', undefined ],
		], async (_, cred, assert) => {
			var req = {}
			assert
			.notOk(await handler(req, env, cred))
			.equal(req.user, undefined)
		})

	})

	test('digestDec parses quoted and unquoted values', assert => {
		var parsed = digestDec('username="admin" realm="http-auth@example.org", qop="auth", algorithm=SHA-256, nonce="abc", uri="/", response="xyz"')
		assert
		.equal(parsed.realm, 'http-auth@example.org')
		.equal(parsed.qop, 'auth')
		.equal(parsed.algorithm, 'SHA-256')
		.equal(parsed.nonce, 'abc')
		.end()
	})

	test('digestDec rejects when required fields are missing', assert => {
		assert
		.notOk(digestDec('username="alice"'))
		.notOk(digestDec('username="alice", realm="r", nonce="n", uri="/"'))
		.end()
	})

	test('digestEnc {0}', [
		[ 'Aladdin', 'open sesame', '384e2f5c372dc1194baeddd85fcae78194487e97638d2cd8d9df51c3a264b5cb' ],
		[ 'test', '123£', 'd6fc43133605b8fd180877df370891218d5439af6873c79dc849313fb0b903ea' ],
		[ 'user', 'pass:word:123', '47c6b734e4ad54fbbaafb2d9cfc435c02a9c64695f85779edf661c2747af5578' ],
		[ 'Jörg', 'secret', '76189fa6ccef146c7fa633124d39290c34a6e5240fd1a0ef414df8519fcf292a' ],
	], async (name, pass, response, assert) => {
		var result = await digestEnc({ realm: 'test', nonce: 'n', opaque: '', uri: '/', cnonce: 'c', username: name }, 'GET', pass)
		assert.equal(result, 'Digest username="' + name + '", realm="test", nonce="n", uri="/", response="' + response + '", opaque="", qop=auth, algorithm=SHA-256, nc=00000001, cnonce="c"')
	})

	var rfc = {
		realm: 'http-auth@example.org',
		algorithm: 'SHA-256',
		nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
		opaque: 'FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS',
		uri: '/dir/index.html',
		cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
		username: 'Mufasa'
	}

	test('digestEnc matches the RFC 7616 SHA-256 example', async assert => {
		assert.equal(await digestEnc({ ...rfc }, 'GET', 'Circle of Life'), 'Digest username="Mufasa", realm="http-auth@example.org", nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", uri="/dir/index.html", response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS", qop=auth, algorithm=SHA-256, nc=00000001, cnonce="f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ"')
	})

	test('digestEnc roundtrips through digestDec', async assert => {
		var p = digestDec(await digestEnc({ ...rfc }, 'GET', 'Circle of Life'))
		assert
		.equal(p.realm, rfc.realm)
		.equal(p.nonce, rfc.nonce)
		.equal(p.opaque, rfc.opaque)
		.equal(p.algorithm, 'SHA-256')
		.equal(p.username, 'Mufasa')
		.equal(p.uri, '/dir/index.html')
	})

	test('digestResponse verifies against a stored HA1', async assert => {
		var stored = await digestHA1('Mufasa', rfc.realm, 'Circle of Life')
		, wrong = await digestHA1('Mufasa', rfc.realm, 'wrong')
		, p = digestDec((await digestEnc({ ...rfc }, 'GET', 'Circle of Life')).slice(7))
		assert
		.equal(await digestResponse(p, 'GET', stored), p.response)
		.notEqual(await digestResponse(p, 'GET', wrong), p.response)
		.notEqual(await digestResponse(p, 'POST', stored), p.response, 'the method is part of the response')
	})

	test('digestResponse returns null for {0}', [
		[ 'MD5', ', algorithm=MD5' ],
		[ 'SHA-256-sess', ', algorithm=SHA-256-sess' ],
		[ 'no algorithm, which RFC 7616 reads as MD5', '' ],
	], async (_, algo, assert) => {
		var p = digestDec('username="Mufasa", realm="test", nonce="abc", uri="/", response="aaa", qop=auth, nc=00000001, cnonce="bbb"' + algo)
		assert.strictEqual(await digestResponse(p, 'GET', 'storedha1'), null)
	})

	describe('digest scheme', () => {
		var realm = 'app'
		, env = { SIGN_KEY: 's3cret', REALM: realm }
		, stored = { alice: '' }
		, handler = (req, env, cred) => digest(req, env, cred, (env, name) => stored[name])
		, req = { method: 'GET' }
		, nonceOf = challenge => /nonce="([^"]*)"/.exec(challenge)[1]
		, cred = async (user, pass, nonce, method = 'GET') => (await digestEnc({ realm, nonce, opaque: '', uri: '/p', cnonce: 'c', username: user }, method, pass)).slice(7)

		test('setup', async () => {
			stored.alice = await digestHA1('alice', realm, 'secret')
		})

		test('digestChallenge carries env.REALM, qop, algorithm and a nonce', async assert => {
			var challenge = await digestChallenge(env)
			assert
			.ok(challenge.startsWith('Digest realm="app", qop="auth", algorithm=SHA-256, nonce="'))
			.ok(/^\d{10}\.[\w-]{20}$/.test(nonceOf(challenge)), 'nonce is seconds.mac, the mac cut to 20 chars')
		})

		test('accepts a response to its own nonce and returns the user', async assert => {
			var r = { method: 'GET' }
			assert
			.equal(await handler(r, env, await cred('alice', 'secret', nonceOf(await digestChallenge(env)))), 'alice')
			.equal(r, { method: 'GET' }, 'req is left alone')
		})

		test('rejects {0}', [
			[ 'a wrong password', 'alice', 'wrong' ],
			[ 'an unknown user', 'bob', 'secret' ],
		], async (_, user, pass, assert) => {
			var r = { method: 'GET' }
			assert
			.notOk(await handler(r, env, await cred(user, pass, nonceOf(await digestChallenge(env)))))
			.equal(r.user, undefined)
		})

		test('rejects a nonce it did not issue', async assert => {
			var forged = ts() + '.' + b64Url(await hmac('other', '' + ts())).slice(-20)
			assert.notOk(await handler({ method: 'GET' }, env, await cred('alice', 'secret', forged)))
		})

		test('rejects a nonce older than a minute', async assert => {
			var sec = '' + (ts() - 61)
			, old = sec + '.' + b64Url(await hmac(env.SIGN_KEY, sec)).slice(-20)
			assert.notOk(await handler({ method: 'GET' }, env, await cred('alice', 'secret', old)))
		})

		test('rejects {0}', [
			[ 'a malformed credential', 'username="alice"' ],
			[ 'a Basic credential', basicEnc('alice', 'secret').slice(6) ],
			[ 'no credential', undefined ],
		], async (_, cred, assert) => {
			assert.notOk(await handler({ method: 'GET' }, env, cred))
		})
	})

	describe('Oauth', () => {
		var providers = {
			github: {
				auth: 'https://github.com/login/oauth/authorize',
				token: 'https://github.com/login/oauth/access_token',
				user: 'https://api.github.com/user'
			},
			google: {
				auth: 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid%20email%20profile',
				token: 'https://oauth2.googleapis.com/token',
				user: 'https://openidconnect.googleapis.com/v1/userinfo'
			}
		}
		, env = { GITHUB_ID: 'id', GITHUB_SECRET: 'sec', GOOGLE_ID: 'gid', GOOGLE_SECRET: 'gsec', SIGN_KEY: 's3cret' }
		, req = (provider, url, u = new URL(url)) => ({
			url, device: 'dev-1', param: { provider }, origin: u.origin, fullPath: u.pathname, searchParams: u.searchParams, resHeaders: {}
		})
		, state = async (win = '', returnTo = '') => b64Url(b64Url(await csrf({ device: 'dev-1' }, env)) + ':' + win + ':' + returnTo)
		, stubFetch = (mock, responses) => {
			var calls = {}
			, fn = async (url, opts) => {
				calls[url.includes('token') ? 'token' : 'user'] = { url, ...opts }
				return new Response(JSON.stringify(url.includes('token') ? responses.token : responses.user))
			}
			fn.calls = calls
			mock.swap(globalThis, 'fetch', fn)
			return fn
		}
		, okFetch = mock => stubFetch(mock, { token: { access_token: 't1' }, user: { id: '1' } })

		test('redirects to {0} with the state', [
			[ 'github', 'https://github.com/login/oauth/authorize?client_id=id' ],
			[ 'google', 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid%20email%20profile&client_id=gid' ],
		], async (provider, start, assert) => {
			var r = req(provider, 'https://app/auth/' + provider + '?state=' + await state())
			assert
			.equal(await Oauth({ providers })(r, env), 302)
			.equal(r.resHeaders.Location, start + '&redirect_uri=https%3A%2F%2Fapp%2Fauth%2F' + provider + '&state=' + await state() + '&response_type=code')
		})

		test('exchanges the code, runs onProfile, then redirects to returnTo', async (assert, mock) => {
			var fetch = stubFetch(mock, { token: { access_token: 't1' }, user: { id: '123', email: 'a@b.c' } })
			, captured
			, r = req('github', 'https://app/auth/github?code=XYZ&state=' + await state('w1', '/dashboard#site/1'))
			assert
			.equal(await Oauth({ providers, onProfile: (req, env, info) => (captured = info) })(r, env), 302)
			.equal(r.resHeaders.Location, '/dashboard#site/1')
			.equal(captured.provider, 'github')
			.equal(captured.token.access_token, 't1')
			.equal(captured.profile.id, '123')
			.equal(captured.win, 'w1', 'the window named in state')
			.equal(fetch.calls.token.method, 'POST')
			.equal('' + fetch.calls.token.body, 'client_id=id&redirect_uri=https%3A%2F%2Fapp%2Fauth%2Fgithub&client_secret=sec&code=XYZ&grant_type=authorization_code')
			.strictEqual(fetch.calls.token.headers['content-type'], undefined, 'fetch sets the form content type from the body')
			.equal(fetch.calls.user.headers['user-agent'], 'LiteJS')
		})

		test('sends the agent as User-Agent', async (assert, mock) => {
			var fetch = okFetch(mock)
			await Oauth({ providers, agent: 'my-app' })(req('github', 'https://app/auth/github?code=XYZ&state=' + await state()), env)
			assert
			.equal(fetch.calls.token.headers['user-agent'], 'my-app')
			.equal(fetch.calls.user.headers['user-agent'], 'my-app')
		})

		test('an id_token in the token response replaces the profile fetch', async (assert, mock) => {
			var claims = { sub: '42', email: 'a@b.c' }
			, fetch = stubFetch(mock, { token: { access_token: 't', id_token: 'h.' + b64Url(JSON.stringify(claims)) + '.s' } })
			, captured
			, r = req('google', 'https://app/auth/google?code=XYZ&state=' + await state())
			assert
			.equal(await Oauth({ providers, onProfile: (req, env, info) => (captured = info) })(r, env), 302)
			.equal(captured.profile, claims)
			.strictEqual(fetch.calls.user, undefined, 'only the token endpoint was called')
		})

		test('redirects to / without a returnTo', async (assert, mock) => {
			okFetch(mock)
			var r = req('github', 'https://app/auth/github?code=XYZ&state=' + await state())
			assert
			.equal(await Oauth({ providers })(r, env), 302)
			.equal(r.resHeaders.Location, '/')
		})

		test('rejects {0}', [
			[ 'a state with a wrong csrf', '&state=' + b64Url('wrong:w1:/') ],
			[ 'a request without a state', '' ],
			[ 'a state that does not decode', '&state=_w' ],
		], async (_, query, assert) => {
			var r = req('github', 'https://app/auth/github?code=1' + query)
			assert
			.equal(await Oauth({ providers })(r, env), { error: 'Invalid oauth state' })
			.equal(r.resStatus, 400)
		})

		test('returns 404 for {0}', [
			[ 'an unknown provider', 'unknown', env ],
			[ 'a provider without credentials', 'github', {} ],
		], async (_, provider, env, assert) => {
			assert.equal(await Oauth({ providers })(req(provider, 'https://app/auth/' + provider), env), 404)
		})

		// Thrown with code 502, so toHandler logs the cause and answers a plain 502
		test('throws a 502 when {0}', [
			[ 'the token endpoint fails', () => new Response('{}', { status: 400 }), 'github: HTTP 400' ],
			[ 'the token has no access_token', () => new Response('{}'), 'github: HTTP 200' ],
			[ 'the token request throws', () => { throw Error('network down') }, 'github: network down' ],
			[ 'the profile request throws', (n => () => n++ ? Promise.reject(Error('profile error')) : new Response('{"access_token":"t1"}'))(0), 'github: profile error' ],
			[ 'the profile endpoint fails', (n => () => n++ ? new Response('{}', { status: 403 }) : new Response('{"access_token":"t1"}'))(0), 'github: HTTP 403' ],
		], async (_, fetch, message, assert, mock) => {
			mock.swap(globalThis, 'fetch', fetch)
			var e = await Oauth({ providers })(req('github', 'https://app/auth/github?code=x&state=' + await state()), env).catch(e => e)
			assert
			.equal(e.message, message)
			.equal(e.code, 502)
		})

		test('the profile fetch sends {0} as token_type', [
			[ 'token', { access_token: 't1', token_type: 'token' } ],
			[ 'Bearer', { access_token: 't1' } ],
		], async (type, token, assert, mock) => {
			var fetch = stubFetch(mock, { token, user: { id: '1' } })
			await Oauth({ providers })(req('github', 'https://app/auth/github?code=XYZ&state=' + await state()), env)
			assert.equal(fetch.calls.user.headers.authorization, type + ' t1')
		})
	})
})

