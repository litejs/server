
import { b64Dec, b64Enc, b64Url, fail, hex, hmac, rand, sha256, ts } from '../util.mjs'


var signs = async (env, purpose, data, ring = env.SIGN_KEY || fail('SIGN_KEY is not set')) => Promise.all(
	ring.split(',').map(key => hmac(purpose + ':' + key, data).then(b64Url))
)
// A nonce is timestamp.mac to be verified without a store
, nonce = async (env, sec) => sec + '.' + (await signs(env, 'nonce', '' + sec))[0].slice(-20)

, basic = async (req, env, cred, users) => (
	!!(cred = basicDec(cred)) &&
	await users(env, cred[0]) === await digestHA1(cred[0], env.REALM, cred[1]) &&
	cred[0]
)
, basicChallenge = env => 'Basic realm="' + env.REALM + '"'
, basicDec = (cred, m) => (m = /^([^:]+):(.*)$/s.exec(b64Dec(('' + cred).replace(/^Basic /i, '')))) && [m[1], m[2]]
, basicEnc = (user, pass) => 'Basic ' + b64Enc(user + ':' + pass)

, digest = async (req, env, cred, users, sec) => (
	!!(cred = digestDec(cred)) &&
	cred.realm === env.REALM &&
	ts() - (sec = cred.nonce.split('.')[0]) < 60 &&
	(await signs(env, 'nonce', '' + sec)).some(mac => cred.nonce === sec + '.' + mac.slice(-20)) &&
	cred.response === await digestResponse(cred, req.method, await users(env, cred.username)) &&
	cred.username
)
, digestChallenge = async env => 'Digest realm="' + env.REALM + '", qop="auth", algorithm=SHA-256, nonce="' + await nonce(env, ts()) + '"'
, digestDec = (str, m, out = {}) => {
	for (var re = /(\w+)=("([^"]*)"|[^, ]+)/g; (m = re.exec(('' + str).replace(/^Digest /i, ''))); ) out[m[1]] = m[3] ?? m[2]
	return out.username && out.realm && out.nonce && out.uri && out.response && out
}
, digestEnc = async (p, method, pass) => {
	p.algorithm = 'SHA-256'
	p.cnonce ||= hex(rand(8))
	p.nc = ('0000000' + (p.nc || 1)).slice(-8)
	return 'Digest username="' + p.username + '"'
		+ ', realm="' + p.realm + '"'
		+ ', nonce="' + p.nonce + '"'
		+ ', uri="' + p.uri + '"'
		+ ', response="' + await digestResponse(p, method, await digestHA1(p.username, p.realm, pass)) + '"'
		+ ', opaque="' + p.opaque + '"'
		+ ', qop=' + (p.qop || 'auth') + ', algorithm=' + p.algorithm
		+ ', nc=' + p.nc
		+ ', cnonce="' + p.cnonce + '"'
}
, digestHA1 = (user, realm, pass) => sha256(user + ':' + realm + ':' + pass).then(hex)
, digestResponse = async (p, method, ha1) => p.algorithm === 'SHA-256' ?
	sha256([ha1, p.nonce, p.nc, p.cnonce, p.qop || 'auth', hex(await sha256(method + ':' + p.uri))].join(':')).then(hex) :
	null

// RFC 4226 - HOTP - HMAC-Based One-Time Password
, hotp = async (key, counter, digits = 6) => {
	var mac = new DataView(await hmac(key, [56, 48, 40, 32, 24, 16, 8, 0].map(n => counter / 2 ** n), 'SHA-1'))
	return ('' + (10 ** digits + (mac.getUint32(mac.getUint8(19) & 15) & 0x7fffffff))).slice(-digits)
}
// RFC 6238 - TOTP - Time-Based One-Time Password
, totp = (key, time = ts(), digits) => hotp(key, time / 30, digits)

, Oauth = ({ providers, agent = 'LiteJS', onProfile, csrf = fail('Oauth needs csrf') }) => async (req, env) => {
	var code_verifier
	, provider = req.param.provider
	, urls = providers[provider]
	, name = provider.toUpperCase()
	, client_id = env[name + '_ID']
	, client_secret = env[name + '_SECRET']
	, code = req.searchParams.get('code')
	, state = req.searchParams.get('state')
	// state is b64(csrf:window:returnTo)
	, [mac, win, ...returnTo] = b64Dec(state).split(':')
	, jsonHeaders = {
		accept: 'application/json',
		'user-agent': agent
	}
	, query = params => new URLSearchParams({ client_id, redirect_uri: req.origin + req.fullPath, ...params })

	if (!urls || !client_id || !client_secret) return 404

	// CSRF is checked both before the redirect to the provider and on callback
	// A browser without a token, as one the redirect lost the cookie of, matches no state, not even an empty one
	if (mac !== (await csrf(req, env) || 0)) return req.resStatus = 400, { error: 'Invalid oauth state' }
	// Only a path on this origin, as browsers read /\ as // and so as another host
	if (!/^\/(?![/\\])/.test(returnTo = returnTo.join(':'))) returnTo = ''
	// PKCE (RFC 7636) ties the code to this flow, so a code issued to anyone else fails at the provider.
	// The verifier is a MAC of the csrf: rebuilt at the callback with no store, and secret though the csrf is not
	code_verifier = (await signs(env, 'pkce', mac))[0]

	if (code) {
		try {
			// Either step failing is the provider's fault, so both answer 502
			var res = await fetch(urls.token, {
				method: 'POST',
				headers: jsonHeaders,
				body: query({ client_secret, code, grant_type: 'authorization_code', code_verifier })
			})
			, token = await res.json()
			, profile = res.ok && token.access_token && (token.id_token ? JSON.parse(b64Dec(token.id_token.split('.')[1])) : await (res = await fetch(urls.user, {
				headers: { ...jsonHeaders, authorization: (token.token_type || 'Bearer') + ' ' + token.access_token }
			})).json())
			if (!res.ok || !profile) fail('HTTP ' + res.status)
			// Decoding unverified is allowed as the token came straight from the provider over TLS (OIDC Core 3.1.3.7)
			if (token.id_token && (
				![].concat(profile.aud).includes(client_id) ||
				!(profile.exp > ts()) ||
				urls.iss && ![].concat(urls.iss).includes(profile.iss)
			)) fail('Invalid id_token')
		} catch (e) {
			fail(provider + ': ' + e.message, 502)
		}
		// The redirect lost the header, state names the window that started the flow
		await onProfile?.(req, env, { provider, token, profile, win })
	} else {
		returnTo = urls.auth
		returnTo += (returnTo.includes('?') ? '&' : '?') + query({
			state, response_type: 'code', code_challenge: b64Url(await sha256(code_verifier)), code_challenge_method: 'S256'
		})
	}

	req.resHeaders.Location = returnTo || '/'
	return 302
}


export {
	Oauth,
	basic, basicChallenge, basicDec, basicEnc,
	digest, digestChallenge, digestDec, digestEnc, digestHA1, digestResponse,
	hotp, signs, totp,
}

