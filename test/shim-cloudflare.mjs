
import '@litejs/cli/test.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cache, DB, D1, DurableObject, DO, KV, R2, durableAlarms, durableObject, kvMap, migrate, parseCron, startCron, toUint } from '../index.mjs'


describe('Cache', () => {
	test('string key', async (assert) => {
		var cache = Cache()
		cache.put('http://localhost/a', new Response('hello', { status: 201, headers: { 'cache-control': 'max-age=60' } }))
		var out1 = await cache.match('http://localhost/a')
		, out2 = await cache.match('http://localhost/a')
		assert.equal(out1.status, 201, 'preserves status')
		assert.equal(await out1.text(), 'hello')
		assert.equal(await out2.text(), 'hello', 'each match is independently readable')
		assert.ok(cache.delete('http://localhost/a'), 'delete returns true for an existing entry')
		assert.equal(cache.match('http://localhost/a'), undefined, 'gone after delete')
		assert.equal(cache.delete('http://localhost/a'), false, 'delete returns false for a missing entry')
	})

	test('Request object url as the key', async (assert) => {
		var cache = Cache()
		var req = new Request('http://localhost/g')
		cache.put(req, new Response('req-key', { headers: { 'cache-control': 'max-age=60' } }))
		assert.equal(await (await cache.match(req)).text(), 'req-key')
		assert.ok(cache.delete(req), 'deletes by Request object')
		assert.equal(cache.match(req), undefined, 'entry is gone after delete')
	})

	test('Vary: matches only when varied headers agree; Vary:* is never cached', async (assert) => {
		var cache = Cache()
		, mk = enc => new Request('http://localhost/v', { headers: { 'accept-encoding': enc } })
		cache.put(mk('gzip'), new Response('gz', { headers: { vary: 'accept-encoding', 'cache-control': 'max-age=60' } }))
		assert.equal(await (await cache.match(mk('gzip'))).text(), 'gz', 'same Accept-Encoding hits')
		assert.equal(cache.match(mk('br')), undefined, 'different Accept-Encoding misses')
		assert.equal(cache.match('http://localhost/v'), undefined, 'a header-less (string) request misses')
		cache.put('http://localhost/star', new Response('x', { headers: { vary: '*', 'cache-control': 'max-age=60' } }))
		assert.equal(cache.match('http://localhost/star'), undefined, 'Vary: * is never cached')
	})

	test('skips non-GET / no-store / private; match ignores non-GET', (assert) => {
		var cache = Cache()
		cache.put(new Request('http://localhost/post', { method: 'POST' }), new Response('x', { headers: { 'cache-control': 'max-age=60' } }))
		assert.equal(cache.match('http://localhost/post'), undefined, 'non-GET is not cached')
		cache.put('http://localhost/ns', new Response('x', { headers: { 'cache-control': 'no-store, max-age=60' } }))
		assert.equal(cache.match('http://localhost/ns'), undefined, 'no-store is not cached')
		cache.put('http://localhost/pv', new Response('x', { headers: { 'cache-control': 'private, max-age=60' } }))
		assert.equal(cache.match('http://localhost/pv'), undefined, 'private is not cached')
		cache.put('http://localhost/m', new Response('v', { headers: { 'cache-control': 'max-age=60' } }))
		assert.ok(cache.match('http://localhost/m'), 'GET hits')
		assert.equal(cache.match(new Request('http://localhost/m', { method: 'POST' })), undefined, 'a non-GET match misses the GET entry')
		assert.end()
	})

	test('ttl: default 60s, max-age=0, s-maxage over max-age, Expires', async (assert) => {
		var cache = Cache()
		// No freshness headers → default 60s, still fresh.
		cache.put('http://localhost/d', new Response('default'))
		assert.equal(await (await cache.match('http://localhost/d')).text(), 'default')
		// max-age=0 → already expired.
		cache.put('http://localhost/f', new Response('old', { headers: { 'cache-control': 'max-age=0' } }))
		assert.equal(cache.match('http://localhost/f'), undefined, 'max-age=0 is expired')
		// s-maxage wins over max-age=0.
		cache.put('http://localhost/s', new Response('shared', { headers: { 'cache-control': 'max-age=0, s-maxage=60' } }))
		assert.equal(await (await cache.match('http://localhost/s')).text(), 'shared', 's-maxage takes precedence')
		// Expires: future fresh, past expired.
		cache.put('http://localhost/x', new Response('exp', { headers: { expires: new Date(Date.now() + 60000).toUTCString() } }))
		assert.equal(await (await cache.match('http://localhost/x')).text(), 'exp', 'future Expires is fresh')
		cache.put('http://localhost/p', new Response('past', { headers: { expires: new Date(Date.now() - 1000).toUTCString() } }))
		assert.equal(cache.match('http://localhost/p'), undefined, 'past Expires is expired')
	})

	test('match honors Range requests', async (assert) => {
		var cache = Cache()
		cache.put('http://localhost/r', new Response('0123456789', { headers: { 'content-length': '10', 'cache-control': 'max-age=60' } }))
		var res = await cache.match(new Request('http://localhost/r', { headers: { range: 'bytes=2-4' } }))
		assert.equal(res.status, 206)
		assert.equal(await res.text(), '234')
		assert.equal(res.headers.get('content-range'), 'bytes 2-4/10')
		assert.equal(await (await cache.match('http://localhost/r')).text(), '0123456789', 'a string key still serves the full body')
	})
})


describe('KV', () => {
	var enc = new TextEncoder()
	, dec = new TextDecoder()
	function setup() {
		return KV(new DB(':memory:'), 'sessions')
	}

	test('round-trip {0}', [
		[ 'string',         'k',          'hello',             'hello' ],
		[ 'Uint8Array',     'k',          enc.encode('hello'), 'hello' ],
		[ 'object',         'k',          { a: 1, b: 'two' },  '{"a":1,"b":"two"}' ],
		[ 'latin-1',        'café',       'résumé',            'résumé' ],
		[ 'cjk',            '日本語キー',  '日本語の値',         '日本語の値' ],
		[ 'emoji',          '🔑',         '😀🎉',              '😀🎉' ],
		[ 'mixed unicode',  'user:café',  'Hello, 世界! 🌍',   'Hello, 世界! 🌍' ],
	], (kind, key, val, expected, assert) => {
		var kv = setup()
		kv.put(key, val, { metadata: { tag: expected } })
		assert.equal(kv.get(key), expected)
		assert.equal(kv.getWithMetadata(key).metadata.tag, expected)
		assert.end()
	})

	test('put async {0}', [
		[ 'ReadableStream', () => new ReadableStream({ start(c) { c.enqueue(enc.encode('streamed')); c.close() } }), 'streamed' ],
		[ 'Blob',           () => new Blob(['blob data']),       'blob data' ],
		[ 'Response',       () => new Response('from response'), 'from response' ],
	], async (kind, build, expected, assert) => {
		var kv = setup()
		await kv.put('k', build())
		assert.equal(kv.get('k'), expected)
	})

	test('get type variants and missing key', async (assert) => {
		var kv = setup()
		kv.put('text', 'hello')
		kv.put('json', JSON.stringify({ a: 1 }))

		assert.equal(kv.get('text'), 'hello')
		assert.equal(kv.get('json', 'json'), { a: 1 })

		var buf = kv.get('text', 'arrayBuffer')
		assert.ok(buf instanceof ArrayBuffer)
		assert.equal(dec.decode(buf), 'hello')

		var stream = kv.get('text', 'stream')
		assert.ok(stream instanceof ReadableStream)
		assert.equal(await new Response(stream).text(), 'hello')

		assert.equal(kv.get('missing'), null)
	})

	test('get accepts an options object for type', async (assert) => {
		var kv = setup()
		kv.put('json', JSON.stringify({ a: 1 }))
		assert.equal(kv.get('json', { type: 'json' }), { a: 1 })
		assert.equal(kv.getWithMetadata('json', { type: 'json' }).value, { a: 1 })
	})

	test('bulk get returns a Map keyed by request key', async (assert) => {
		var kv = setup()
		kv.put('a', 'A')
		kv.put('json', JSON.stringify({ n: 1 }), { metadata: { tag: 'x' } })

		var vals = kv.get(['a', 'json', 'missing'])
		assert.ok(vals instanceof Map)
		assert.equal(vals.get('a'), 'A')
		assert.equal(vals.get('json'), '{"n":1}')
		assert.equal(vals.get('missing'), null)

		// type applies to every key in the batch
		assert.equal(kv.get(['json'], { type: 'json' }).get('json'), { n: 1 })

		var metas = kv.getWithMetadata(['json', 'missing'])
		assert.equal(metas.get('json'), { value: '{"n":1}', metadata: { tag: 'x' } })
		assert.equal(metas.get('missing'), { value: null, metadata: null })
	})

	test('getWithMetadata: with, without, missing', async (assert) => {
		var kv = setup()
		kv.put('with', 'val', { metadata: { tag: 'x' } })
		kv.put('without', 'val')

		assert.equal(await kv.getWithMetadata('with'),    { value: 'val', metadata: { tag: 'x' } })
		assert.equal(await kv.getWithMetadata('without'), { value: 'val', metadata: null })
		assert.equal(await kv.getWithMetadata('missing'), { value: null,  metadata: null })
	})

	test('expiration: {0}', [
		[ 'expirationTtl past returns null',  { expirationTtl: -1 },                          null  ],
		[ 'expirationTtl future returns val', { expirationTtl: 3600 },                        'val' ],
		[ 'expiration future returns val',    { expiration: (Date.now() / 1000 | 0) + 3600 }, 'val' ],
		[ 'expiration past returns null',     { expiration: 1 },                              null  ],
	], (label, opts, expected, assert) => {
		var kv = setup()
		kv.put('k', 'val', opts)
		assert.equal(kv.get('k'), expected)
		assert.end()
	})

	test('delete removes key and ignores missing', (assert) => {
		var kv = setup()
		kv.put('k', 'val')
		kv.delete('k')
		assert.equal(kv.get('k'), null)
		kv.delete('missing')
		assert.end()
	})

	test('overwrite existing key', (assert) => {
		var kv = setup()
		kv.put('k', 'old')
		kv.put('k', 'new')
		assert.equal(kv.get('k'), 'new')
		assert.end()
	})

	test('name with special chars sanitizes to a valid table', (assert) => {
		var kv = KV(new DB(':memory:'), 'oauth_google.com')
		kv.put('k', 'v')
		assert.equal(kv.get('k'), 'v')
		assert.end()
	})

	test('falls back to a default table name when none is given', (assert) => {
		var kv = KV(new DB(':memory:'))
		kv.put('k', 'v')
		assert.equal(kv.get('k'), 'v')
		assert.end()
	})

	test('put throws on null/undefined', async (assert) => {
		var kv = setup()
		, err = await kv.put('k', null).then(() => null, e => e)
		assert.ok(err instanceof TypeError)
		assert.ok(/requires a value/.test(err.message))
	})

	test('list with prefix filtering and wildcard escaping', (assert) => {
		var kv = setup()
		for (var k of ['user:1', 'user:2', 'post:1', '100%off', '100Xoff', '100_off', 'a\\b', 'aXb']) kv.put(k, 'v')

		var all = kv.list()
		assert.equal(all.keys.map(k => k.name), ['100%off', '100Xoff', '100_off', 'aXb', 'a\\b', 'post:1', 'user:1', 'user:2'])
		assert.equal(all.list_complete, true)
		assert.equal(all.cursor, undefined)

		assert.equal(kv.list({ prefix: 'user:' }).keys.map(k => k.name), ['user:1', 'user:2'])
		assert.equal(kv.list({ prefix: '100%'  }).keys.map(k => k.name), ['100%off'])
		assert.equal(kv.list({ prefix: '100_'  }).keys.map(k => k.name), ['100_off'])
		assert.equal(kv.list({ prefix: 'a\\'   }).keys.map(k => k.name), ['a\\b'])
		assert.end()
	})

	test('list pagination via cursor', (assert) => {
		var kv = setup()
		kv.put('a', '1'); kv.put('b', '2'); kv.put('c', '3')
		var page1 = kv.list({ limit: 2 })
		assert.equal(page1.keys.length, 2)
		assert.equal(page1.list_complete, false)
		assert.ok(page1.cursor)
		var page2 = kv.list({ limit: 2, cursor: page1.cursor })
		assert.equal(page2.keys.length, 1)
		assert.equal(page2.keys[0].name, 'c')
		assert.equal(page2.list_complete, true)
		assert.end()
	})

	test('list excludes expired, includes expiration + metadata', (assert) => {
		var kv = setup()
		var exp = Math.floor(Date.now() / 1000) + 3600
		kv.put('live', 'val', { expiration: exp, metadata: { a: 1 } })
		kv.put('dead', 'val', { expiration: 1 })
		var res = kv.list()
		assert.equal(res.keys.length, 1)
		assert.equal(res.keys[0], { name: 'live', expiration: exp, metadata: { a: 1 } })
		assert.end()
	})
	test('kvMap', (assert) => {
		var db = new DB(':memory:')
		, map = kvMap(db, 'state')
		map.set('a', { n: 1 })
		map.set('b', [2, 3])
		assert.equal(map.get('a'), { n: 1 }, 'reads from the in-memory map')

		// A fresh map over the same db rehydrates the persisted entries.
		assert.equal(kvMap(db, 'state').get('b'), [2, 3], 'rehydrates from the db')

		map.delete('a')
		assert.equal(kvMap(db, 'state').has('a'), false, 'delete is written through')

		// preserveKeys (the JSON.stringify replacer) limits which fields persist.
		var kept = kvMap(db, 'kept', ['keep'])
		kept.set('x', { keep: 1, drop: 2 })
		assert.equal(kvMap(db, 'kept').get('x'), { keep: 1 }, 'only listed keys are serialized')
		assert.end()
	})
})

describe('D1', () => {
	function setup(seed) {
		var db = D1(new DB(':memory:'))
		db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
		if (seed) for (var name of seed) db.prepare('INSERT INTO t (name) VALUES (?)').bind(name).run()
		return db
	}

	test('all returns results, with and without bind', (assert) => {
		var res, db = setup(['Alice', 'Bob'])

		res = db.prepare('SELECT * FROM t').all()
		assert.equal(res.results, [{id:1, name: 'Alice'}, {id:2, name: 'Bob'}])
		assert.equal(res.success, true)

		res = db.prepare('SELECT * FROM t WHERE name = ?').bind('Bob').all()
		assert.equal(res.results, [{id:2, name: 'Bob'}])
		assert.equal(res.success, true)
		assert.end()
	})

	test('first {0}', [
		[ 'returns row',                       ['Alice'], 'SELECT * FROM t WHERE id = ?', [1],   undefined, { id: 1, name: 'Alice' } ],
		[ 'returns column value',              ['Alice'], 'SELECT * FROM t WHERE id = ?', [1],   'name',    'Alice' ],
		[ 'returns null for no row',           [],        'SELECT * FROM t WHERE id = ?', [999], undefined, null ],
		[ 'returns null for no row + column',  [],        'SELECT * FROM t WHERE id = ?', [999], 'name',    null ],
		[ 'no bind, literal SQL',              [],        "SELECT 'x' AS v",              [],    'v',       'x' ],
	], (name, seed, sql, binds, col, expected, assert) => {
		var db = setup(seed)
		assert.equal(db.prepare(sql).bind(...binds).first(col), expected)
		assert.end()
	})

	test('run {0} reports meta', [
		[ 'INSERT', [],                 "INSERT INTO t (name) VALUES ('Alice')",     1, 1 ],
		[ 'UPDATE', ['Alice', 'Bob'],   "UPDATE t SET name = 'X'",                   2, null ],
		[ 'DELETE', ['Alice', 'Bob'],   "DELETE FROM t WHERE name = 'Alice'",        1, null ],
	], (op, seed, sql, changes, lastRowId, assert) => {
		var db = setup(seed)
		, res = db.prepare(sql).run()
		assert.equal(res.success, true)
		assert.equal(res.results.length, 0)
		assert.equal(res.meta.changes, changes)
		if (lastRowId !== null) assert.equal(res.meta.last_row_id, lastRowId)
		assert.end()
	})

	test('raw returns arrays', (assert) => {
		var db = setup(['Alice', 'Bob'])
		assert.equal(db.prepare('SELECT id, name FROM t').raw(), [[1, 'Alice'], [2, 'Bob']])
		assert.end()
	})

	test('bind is chainable and reusable across runs', (assert) => {
		var db = setup()
		, stmt = db.prepare('INSERT INTO t (name) VALUES (?)')
		stmt.bind('Alice').run()
		stmt.bind('Bob').run()
		assert.equal(db.prepare('SELECT * FROM t').all().results.length, 2)
		assert.end()
	})

	test('batch runs in transaction', (assert) => {
		var db = setup()
		, results = db.batch([
			db.prepare('INSERT INTO t (name) VALUES (?)').bind('Alice'),
			db.prepare('INSERT INTO t (name) VALUES (?)').bind('Bob'),
			db.prepare('SELECT * FROM t'),
		])
		assert.equal(results.length, 3)
		assert.equal(results[2].results.length, 2)
		assert.equal(results[2].results[0].name, 'Alice')
		assert.end()
	})

	test('batch rolls back on error', (assert) => {
		var db = setup(['Alice'])
		try {
			db.batch([
				db.prepare('INSERT INTO t (name) VALUES (?)').bind('Bob'),
				db.prepare('INSERT INTO t (name) VALUES (?)').bind(null),
			])
		} catch(e) {}
		var res = db.prepare('SELECT * FROM t').all()
		assert.equal(res.results, [{id:1, name: 'Alice'}])
		assert.equal(res.success, true)
		assert.end()
	})

	test('bind returns a new statement (reusable in one batch)', (assert) => {
		var db = setup()
		, stmt = db.prepare('INSERT INTO t (name) VALUES (?)')
		db.batch([stmt.bind('Alice'), stmt.bind('Bob')])
		assert.equal(db.prepare('SELECT name FROM t ORDER BY id').raw(), [['Alice'], ['Bob']])
		assert.end()
	})

	test('run returns RETURNING rows and meta', (assert) => {
		var db = setup()
		, res = db.prepare('INSERT INTO t (name) VALUES (?) RETURNING id, name').bind('Zoe').run()
		assert.equal(res.results, [{ id: 1, name: 'Zoe' }])
		assert.equal(res.meta.changes, 1)
		assert.equal(res.meta.last_row_id, 1)
		assert.end()
	})

	test('raw({columnNames}) prepends the column-name row', (assert) => {
		var db = setup(['Alice'])
		assert.equal(db.prepare('SELECT id, name FROM t').raw({ columnNames: true }), [['id', 'name'], [1, 'Alice']])
		assert.end()
	})

	test('exec returns {count, duration}', (assert) => {
		var db = setup()
		, res = db.exec("INSERT INTO t (name) VALUES ('a'); INSERT INTO t (name) VALUES ('b')")
		assert.type(res.count, 'number')
		assert.type(res.duration, 'number')
		assert.equal(db.prepare('SELECT count(*) AS n FROM t').first('n'), 2)
		assert.end()
	})

	test('withSession returns a query session with getBookmark', (assert) => {
		var db = setup(['Alice'])
		, session = db.withSession('first-primary')
		assert.equal(session.prepare('SELECT name FROM t').first('name'), 'Alice')
		assert.equal(session.getBookmark(), null)
		assert.end()
	})
})

describe('DO', () => {

	class MyDO extends DurableObject {
		hello() { return 'world' }
	}

	var rootDir = mkdtempSync(join(tmpdir(), 'litejs-do-'))
	, env = { FOO: 'bar' }
	, ns = makeNS(MyDO, env)

	function makeNS(Cls, env) {
		return durableObject(Cls, mkdtempSync(join(rootDir, 'ns-')), env || {})
	}

	test('id construction: idFromName, newUniqueId, idFromString, equals', (assert) => {
		var a = ns.idFromName('test')
		, b = ns.idFromName('test')
		, c = ns.idFromName('other')
		, u = ns.newUniqueId()
		, r = ns.idFromString(a.toString())

		// idFromName is deterministic, 64-char hex, carries name
		assert.equal(String(a), String(b))
		assert.equal(String(a).length, 64)
		assert.equal(a.name, 'test')
		// idFromString reconstructs
		assert.equal(r.toString(), a.toString())
		// newUniqueId is unique, 64-char hex, no name
		assert.equal(String(u).length, 64)
		assert.notEqual(String(u), String(ns.newUniqueId()))
		assert.equal(u.name, null)
		// equals compares by hex
		assert.ok(a.equals(b))
		assert.ok(!a.equals(c))

		// idFromName includes class name to prevent collisions
		class A { }
		assert.notEqual('' + ns.idFromName('room'), '' + makeNS(A).idFromName('room'))
		assert.end()
	})

	test('an id that is not a bare digest is refused: {0}', [
		[ 'a relative path', '../escaped' ],
		[ 'an absolute path', '/tmp/escaped' ],
		[ 'a short hex string', 'abc123' ],
		[ 'uppercase hex', 'A'.repeat(64) ],
		[ 'hex with a separator', 'a'.repeat(63) + '/' ],
		[ 'empty', '' ],
	], (name, bad, assert) => {
		// An id names a sqlite file, so app code passing user input must not escape dir.
		assert.throws(() => ns.idFromString(bad))
		assert.throws(() => ns.get({ toString: () => bad }), 'get() is checked too')
		assert.end()
	})

	test('getByName returns cached instance with ctx and env', (assert) => {
		var a = ns.getByName('room1')
		var b = ns.getByName('room1')
		assert.strictEqual(a, b, 'same instance cached')
		assert.strictEqual(a.env, env)
		assert.equal(a.ctx.id.name, 'room1')
		assert.equal(a.ctx.waitUntil(Promise.resolve()), undefined)
		assert.ok(a.ctx.storage.sql)
		assert.end()
	})

	test('sql.exec write/read with cursor methods', (assert) => {
		var sql = makeNS(MyDO).getByName('a').ctx.storage.sql
		sql.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)')

		var ins = sql.exec('INSERT INTO items (name) VALUES (?) RETURNING *', 'Alice')
		assert.equal(ins.toArray(), [{ id: 1, name: 'Alice' }])
		assert.equal(ins.columnNames, ['id', 'name'])
		assert.equal(ins.rowsWritten, 1)

		sql.exec('INSERT INTO items (name) VALUES (?)', 'Bob')

		var sel = sql.exec('SELECT * FROM items ORDER BY id')
		assert.equal(sel.one().name, 'Alice')
		assert.equal(sel.raw(), [[1, 'Alice'], [2, 'Bob']])
		assert.equal(sel.rowsRead, 2)
		assert.equal(sel.rowsWritten, 0)

		assert.equal(sql.exec('UPDATE items SET name = ?', 'Charlie').rowsWritten, 2)
		assert.equal(sql.exec('DELETE FROM items WHERE name = ?', 'Charlie').rowsWritten, 2)
		assert.end()
	})

	test('static schema migration: {0}', [
		[ 'initial v0 → v1',  [ ['CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)'] ],                                                            1 ],
		[ 'incremental v1 → v2', [
			['CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)'],
			['CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)', 'ALTER TABLE items ADD COLUMN color TEXT'],
		], 2 ],
		[ 'no schema stays v0',  [],                                                                                                                     0 ],
	], (label, schemas, expectedVersion, assert) => {
		var rootD = mkdtempSync(join(rootDir, 'mig-'))
		var version

		// An empty schema list still runs migrate once (with an empty schema) so the
		// _migrations table exists and reports version 0.
		for (var schema of schemas.length ? schemas : [[]]) {
			class WithSchema extends DurableObject {
				constructor(ctx, env) {
					super(ctx, env)
					migrate(ctx.storage.sql, WithSchema.schema)
				}
			}
			WithSchema.schema = schema
			Object.defineProperty(WithSchema, 'name', { value: 'WithSchema' })
			var stub = durableObject(WithSchema, rootD, {}).getByName('a')
			version = stub.ctx.storage.sql.exec('SELECT COALESCE(MAX(id),0) AS v FROM _migrations').one().v
		}
		assert.equal(version, expectedVersion)
		assert.end()
	})

	test('transactions commit, roll back, await, and serialize', async (assert) => {
		var stub = ns.getByName('a')
		var sql = stub.ctx.storage.sql
		sql.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)')

		// commits
		var ok = stub.ctx.storage.transactionSync(() => {
			sql.exec('INSERT INTO items (name) VALUES (?)', 'Alice')
			sql.exec('INSERT INTO items (name) VALUES (?)', 'Bob')
			return 'ok'
		})
		assert.equal(ok, 'ok')
		assert.equal(sql.exec('SELECT COUNT(*) AS n FROM items').one().n, 2)

		// rolls back on throw
		assert.throws(() => stub.ctx.storage.transactionSync(() => {
			sql.exec('INSERT INTO items (name) VALUES (?)', 'Carl')
			throw Error('fail')
		}), /fail/)
		assert.equal(sql.exec('SELECT COUNT(*) AS n FROM items').one().n, 2)

		// transactionSync refuses a Promise and rolls back synchronous work.
		assert.throws(() => stub.ctx.storage.transactionSync(async () => {
			sql.exec('INSERT INTO items (name) VALUES (?)', 'Not committed')
		}), /must be synchronous/)
		assert.equal(sql.exec('SELECT COUNT(*) AS n FROM items').one().n, 2)

		// transaction() keeps the transaction open across await.
		var done = await stub.ctx.storage.transaction(async () => {
			await null
			sql.exec('INSERT INTO items (name) VALUES (?)', 'Dave')
			return 'done'
		})
		assert.equal(done, 'done')
		assert.equal(sql.exec('SELECT COUNT(*) AS n FROM items').one().n, 3)

		// A rejection after await rolls back every write in the callback.
		var err = await stub.ctx.storage.transaction(async () => {
			sql.exec('INSERT INTO items (name) VALUES (?)', 'Eve')
			await null
			sql.exec('INSERT INTO items (name) VALUES (?)', 'Frank')
			throw Error('async fail')
		}).then(() => null, e => e)
		assert.equal(err.message, 'async fail')
		assert.equal(sql.exec('SELECT COUNT(*) AS n FROM items').one().n, 3)

		// Concurrent transactions wait for the active transaction to settle.
		var release, order = []
		, first = stub.ctx.storage.transaction(async () => {
			order.push('first:start')
			await new Promise(resolve => { release = resolve })
			order.push('first:end')
		})
		await null
		var second = stub.ctx.storage.transaction(() => { order.push('second') })
		await null
		assert.equal(order, ['first:start'])
		release()
		await Promise.all([first, second])
		assert.equal(order, ['first:start', 'first:end', 'second'])
	})

	test('alarm', (assert, mock) => {
		var fired = []
		class WithAlarm extends DO {
			static schema = ['CREATE TABLE fired (id INTEGER PRIMARY KEY, name TEXT)']
			alarm(info) {
				assert.equal(info.retryCount, 0)
				assert.equal(info.isRetry, false)
				assert.equal(this.ctx.storage.getAlarm(), null, 'consumed before the handler runs')
				fired.push(this.ctx.id.name)
				this.ctx.storage.sql.exec('INSERT INTO fired (name) VALUES (?)', this.ctx.id.name)
			}
		}
		mock.time()
		var ns = makeNS(WithAlarm)
		var s1 = ns.getByName('a')
		s1.ctx.storage.setAlarm(Date.now() - 1000)
		s1.ctx.storage.setAlarm(Date.now() + 30 * 864e5) // 30 days overflows setTimeout's 2^31-1ms
		var s2 = ns.getByName('b')
		s2.ctx.storage.setAlarm(Date.now() + 10)
		s2.ctx.storage.deleteAlarm()               // prevents
		mock.tick(50)
		assert.equal(fired, [])
		mock.tick(30 * 864e5)
		assert.equal(fired, ['a'])
		// reacquire Durable Object stubs as advancing time by 30 days evicts DO
		assert.equal(ns.getByName('a').ctx.storage.sql.exec('SELECT name FROM fired').raw(), [['a']])
		assert.equal(ns.getByName('b').ctx.storage.sql.exec('SELECT name FROM fired').raw(), [])
		assert.end()
	})

	test('alarm schedules retry on error', async (assert, mock) => {
		class WithAlarm extends DurableObject {
			alarm() { throw Error('fail') }
			myAlarm(t) { this.ctx.storage.setAlarm(t) }
		}
		mock.time()
		var stub = makeNS(WithAlarm).getByName('a')
		stub.myAlarm(Date.now())
		mock.tick(1)
		// fireAlarm awaits the handler, so the catch that reschedules runs a microtask later
		await null
		assert.ok(stub.ctx.storage.getAlarm() != null, 'retry scheduled')
		// Disarm, restore() ticks every pending timer once the test ends
		stub.ctx.storage.deleteAlarm()
	})

	test('durableObject restores timers from pre-populated alarms map', async (assert, mock) => {
		var fired = 0
		class WithAlarm extends DurableObject {
			alarm() { fired++ }
		}
		var dir = mkdtempSync(join(rootDir, 'ns-'))
		// Compute the key the way idFromName would
		, ns0 = durableObject(WithAlarm, dir, {})
		, key = ns0.idFromName('a').toString()

		mock.time()
		// Pre-populate the alarms map and pass it to a fresh namespace
		var alarms = new Map([[key, { time: Date.now() + 2 }]])
		durableObject(WithAlarm, dir, {}, alarms)
		// The pre-populated entry should now have a real, cancellable timer
		assert.ok(alarms.get(key).timer, 'a timer handle is kept, not unref()\'s return value')
		mock.tick(2)
		await null
		assert.equal(fired, 1, 'the restored timer fires its alarm')
	})

	test('durableAlarms: hydrates from DB, writes through on set/delete, survives close', (assert) => {
		var db1 = new DB(':memory:')
		var store1 = durableAlarms(db1)
		assert.equal(store1.size, 0, 'empty on first open')

		store1.set('k1', { time: 100, timer: 'fake' })
		store1.set('k2', { time: 200 })
		assert.equal(store1.get('k1').time, 100)
		assert.equal(store1.get('k2').time, 200)

		// New store on the same DB should see the persisted rows
		var store2 = durableAlarms(db1)
		assert.equal(store2.size, 2)
		assert.equal(store2.get('k1').time, 100)
		assert.equal(store2.get('k2').time, 200)
		assert.equal(store2.get('k1').timer, undefined, 'timer not persisted, only time')

		// Delete writes through too
		store1.delete('k1')
		assert.equal(store1.has('k1'), false)

		var store3 = durableAlarms(db1)
		assert.equal(store3.size, 1)
		assert.equal(store3.has('k1'), false)
		assert.equal(store3.has('k2'), true)
		assert.end()
	})

	test('blockConcurrencyWhile runs and returns', async (assert) => {
		var stub = makeNS(MyDO).getByName('a')
		assert.equal(await stub.ctx.blockConcurrencyWhile(() => 'done'), 'done')
	})

	test('blockConcurrencyWhile delays calls until initialization completes', async (assert) => {
		var release, events = []
		class Blocking extends DurableObject {
			constructor(ctx, env) {
				super(ctx, env)
				this.ready = false
				ctx.blockConcurrencyWhile(async () => {
					events.push('init:start')
					await new Promise(resolve => { release = resolve })
					this.ready = true
					events.push('init:end')
				})
			}
			read() {
				events.push('read')
				return this.ready
			}
		}

		var stub = makeNS(Blocking).getByName('a')
		, pending = stub.read()
		assert.strictEqual(stub.constructor, Blocking, 'proxy preserves the local instance shape')
		assert.type(pending.then, 'function', 'a call made while blocked is queued')
		assert.equal(events, ['init:start'])
		release()
		assert.equal(await pending, true)
		assert.equal(events, ['init:start', 'init:end', 'read'])
	})

	test('blockConcurrencyWhile failure resets the object', async (assert) => {
		var constructions = 0
		class Flaky extends DurableObject {
			constructor(ctx, env) {
				super(ctx, env)
				this.instance = ++constructions
				if (this.instance === 1) {
					ctx.blockConcurrencyWhile(() => { throw Error('sync init failed') })
					ctx.blockConcurrencyWhile(async () => { await null; throw Error('async init failed') })
				}
			}
			read() { return this.instance }
		}

		var ns = makeNS(Flaky)
		, failed = ns.getByName('a')
		, error = await failed.read().then(() => null, e => e)
		assert.ok(/init failed/.test(error.message))
		assert.ok(await failed.read().then(() => false, () => true), 'failed stub stays failed')

		var fresh = ns.getByName('a')
		assert.notStrictEqual(fresh, failed, 'the next lookup constructs a fresh object')
		assert.equal(fresh.read(), 2)

		var closeError = await fresh.ctx.blockConcurrencyWhile(() => {
			fresh.ctx.storage.deleteAll()
			throw Error('failed after closing storage')
		}).then(() => null, e => e)
		assert.equal(closeError.message, 'failed after closing storage')
	})

	test('constructor failure closes activation with a pending block', async (assert) => {
		var block, state
		class Broken extends DurableObject {
			constructor(ctx, env) {
				super(ctx, env)
				state = ctx
				block = ctx.blockConcurrencyWhile(() => { throw Error('block failed') })
				throw Error('constructor failed')
			}
		}

		var ns = makeNS(Broken)
		assert.throws(() => ns.getByName('a'), /constructor failed/)
		assert.equal((await block.then(() => null, e => e)).message, 'block failed')
		assert.throws(() => state.storage.get('x'), 'constructor failure closes storage')
	})

	test('blockConcurrencyWhile resets the object after 30 seconds', async (assert, mock) => {
		var constructions = 0
		class Stuck extends DurableObject {
			constructor(ctx, env) {
				super(ctx, env)
				this.instance = ++constructions
				if (this.instance === 1) ctx.blockConcurrencyWhile(() => new Promise(() => {}))
			}
			read() { return this.instance }
		}

		mock.time()
		var ns = makeNS(Stuck)
		, pending = ns.getByName('a').read().then(() => null, e => e)
		mock.tick(30000)
		var error = await pending
		assert.equal(error.message, 'blockConcurrencyWhile timed out')
		assert.equal(ns.getByName('a').read(), 2)
	})

	test('kv: get/put/delete + auto-JSON for objects', (assert) => {
		var kv = makeNS(MyDO).getByName('a').ctx.storage
		assert.equal(kv.get('x'), undefined)
		kv.put('x', 42)
		assert.equal(kv.get('x'), 42)
		kv.put('obj', { a: 1 })
		assert.equal(kv.get('obj').a, 1)
		assert.equal(kv.delete('x'), true)
		assert.equal(kv.delete('x'), false, 'second delete returns false')
		assert.end()
	})

	test('kv list options: prefix, limit, startAfter, reverse', (assert) => {
		var kv = makeNS(MyDO).getByName('a').ctx.storage
		kv.put('a:1', 'one'); kv.put('a:2', 'two'); kv.put('b:1', 'three')

		assert.equal(kv.list().size, 3)
		assert.equal(kv.list({ prefix: 'a:' }).size, 2)
		assert.equal(kv.list({ prefix: 'a:' }).get('a:1'), 'one')
		assert.equal(kv.list({ limit: 2 }).size, 2)
		var after = kv.list({ startAfter: 'a:1' })
		assert.equal(after.size, 2)
		assert.equal(after.has('a:1'), false)
		assert.equal([...kv.list({ reverse: true }).keys()][0], 'b:1')
		assert.end()
	})

	test('storage.deleteAll removes file and evicts instance; alarm survives', (assert) => {
		var ns = makeNS(MyDO)
		var stub1 = ns.getByName('zap')
		stub1.ctx.storage.put('k', 'v')
		var alarmTime = Date.now() + 60000
		stub1.ctx.storage.setAlarm(alarmTime)

		stub1.ctx.storage.deleteAll()

		// Re-acquire — storage is empty but the alarm persists (matches CF semantics)
		var stub2 = ns.getByName('zap')
		assert.notEqual(stub1, stub2, 'old instance evicted, fresh one created')
		assert.equal(stub2.ctx.storage.get('k'), undefined)
		assert.equal(stub2.ctx.storage.getAlarm(), alarmTime, 'alarm not cleared by deleteAll')
		stub2.ctx.storage.deleteAlarm()
		assert.end()
	})

	test('evicts instances not got since last sweep and keeps fresh ones', (assert, mock) => {
		var constructions = 0
		class Evictable extends DurableObject {
			constructor(ctx, env) {
				super(ctx, env)
				this.instance = ++constructions
			}
		}

		mock.time()
		var ns = makeNS(Evictable)
		, idle = ns.getByName('idle')
		, fresh = ns.getByName('fresh')
		mock.tick(300000)
		assert.strictEqual(ns.getByName('fresh'), fresh, 'a lookup keeps the activation fresh')
		mock.tick(300000)
		assert.notStrictEqual(ns.getByName('idle'), idle, 'an idle activation is replaced')
		assert.strictEqual(ns.getByName('fresh'), fresh, 'a fresh activation is retained')
		assert.end()
	})

	test('fetch wrapper normalizes input to Request', (assert) => {
		class MyCls extends DurableObject {
			greet() { return 'hi' }
			fetch(req) { return req.url }
		}
		var stub = makeNS(MyCls, { KEY: 'val' }).getByName('a')
		assert.strictEqual(stub.env.KEY, 'val')
		assert.equal(stub.greet(), 'hi')

		// fetch wraps a string/URL into a Request
		assert.equal(stub.fetch('https://example.com/path'), 'https://example.com/path')
		// and passes an existing Request through untouched
		var req = new Request('https://example.com/other')
		assert.equal(stub.fetch(req), 'https://example.com/other')
		assert.end()
	})
})
describe('R2', () => {
	function setup() {
		return R2(new DB(':memory:'))
	}

	test('put returns metadata and round-trips body', async (assert) => {
		var r2 = setup()
		var res = await r2.put('hello.txt', 'Hello!', { contentType: 'text/plain' })
		assert.equal(res.key, 'hello.txt')
		assert.equal(res.size, 6)
		assert.ok(res.etag)
		assert.equal(res.httpMetadata.contentType, 'text/plain')

		var obj = r2.get('hello.txt')
		assert.equal(obj.key, 'hello.txt')
		assert.equal(await obj.text(), 'Hello!')
		assert.equal(obj.size, 6)
		assert.equal(obj.etag, res.etag)
		assert.equal(obj.httpMetadata.contentType, 'text/plain')
	})

	test('httpEtag (quoted) and writeHttpMetadata on get/put/head', async (assert) => {
		var r2 = setup()
		, put = await r2.put('a.txt', 'hi', { contentType: 'text/plain' })
		assert.equal(put.httpEtag, '"' + put.etag + '"')

		// canonical serving pattern: writeHttpMetadata(headers) + httpEtag
		var obj = r2.get('a.txt')
		, headers = new Headers()
		obj.writeHttpMetadata(headers)
		headers.set('etag', obj.httpEtag)
		assert.equal(headers.get('content-type'), 'text/plain')
		assert.equal(headers.get('etag'), '"' + obj.etag + '"')

		var meta = r2.head('a.txt')
		assert.equal(meta.httpEtag, '"' + meta.etag + '"')
		assert.equal(typeof meta.writeHttpMetadata, 'function')
	})

	test('contentType: {0}', [
		[ 'default is octet-stream',         undefined,                                                           'application/octet-stream' ],
		[ 'opts.contentType',                { contentType: 'text/html' },                                        'text/html' ],
		[ 'opts.httpMetadata wins over opts',{ httpMetadata: { contentType: 'text/css' }, contentType: 'x/y' },   'text/css' ],
	], async (label, opts, expected, assert) => {
		var r2 = setup()
		var res = await r2.put('k', 'v', opts)
		assert.equal(res.httpMetadata.contentType, expected)
		assert.equal(r2.get('k').httpMetadata.contentType, expected)
	})

	test('json round-trip via .json()', async (assert) => {
		var r2 = setup()
		r2.put('data.json', JSON.stringify({ n: 42 }))
		assert.equal(await r2.get('data.json').json(), { n: 42 })
	})

	test('overwrite existing key', async (assert) => {
		var r2 = setup()
		r2.put('k', 'old')
		r2.put('k', 'new')
		assert.equal(await r2.get('k').text(), 'new')
	})

	test('put null body stores empty object', async (assert) => {
		var r2 = setup()
		var res = await r2.put('empty', null)
		assert.equal(res.size, 0)
		assert.equal(await r2.get('empty').text(), '')
	})

	test('put async {0}', [
		[ 'ReadableStream', () => new ReadableStream({ start(c) { c.enqueue(toUint('streamed')); c.close() } }), 'streamed' ],
		[ 'Blob',           () => new Blob(['blob data']),       'blob data' ],
		[ 'Response',       () => new Response('from response'), 'from response' ],
	], async (kind, build, expected, assert) => {
		var r2 = setup()
		await r2.put('k', build())
		assert.equal(await r2.get('k').text(), expected)
	})

	test('custom metadata round-trips through get and head', (assert) => {
		var r2 = setup()
		r2.put('k', 'v', { customMetadata: { owner: 'test' } })
		assert.equal(r2.get('k').customMetadata.owner, 'test')
		assert.equal(r2.head('k').customMetadata.owner, 'test')
		assert.end()
	})

	test('head returns metadata only (no body)', (assert) => {
		var r2 = setup()
		r2.put('k', 'value')
		var obj = r2.head('k')
		assert.equal(obj.key, 'k')
		assert.equal(obj.size, 5)
		assert.equal(obj.body, undefined)
		assert.equal(obj.text, undefined)
		assert.end()
	})

	test('get and head return null for missing', (assert) => {
		var r2 = setup()
		assert.equal(r2.get('missing'), null)
		assert.equal(r2.head('missing'), null)
		assert.end()
	})

	test('delete single key and array', async (assert) => {
		var r2 = setup()
		r2.put('a', '1'); r2.put('b', '2'); r2.put('c', '3'); r2.put('d', '4')
		r2.delete('a')
		assert.equal(r2.get('a'), null)
		assert.equal(await r2.get('b').text(), '2')

		r2.delete(['b', 'd'])
		assert.equal(r2.get('b'), null)
		assert.equal(await r2.get('c').text(), '3')
		assert.equal(r2.get('d'), null)
	})

	test('list with prefix filtering, wildcard escaping, and pagination', (assert) => {
		var r2 = setup()
		for (var k of ['p/a', 'p/b', 'p/c', 'q/d', '100%off']) r2.put(k, 'v')

		var all = r2.list()
		assert.equal(all.objects.map(o => o.key), ['100%off', 'p/a', 'p/b', 'p/c', 'q/d'])
		assert.equal(all.truncated, false)
		assert.equal(all.cursor, undefined)

		assert.equal(r2.list({ prefix: 'p/'   }).objects.map(o => o.key), ['p/a', 'p/b', 'p/c'])
		assert.equal(r2.list({ prefix: '100%' }).objects.map(o => o.key), ['100%off'])

		var page1 = r2.list({ prefix: 'p/', limit: 2 })
		assert.equal(page1.objects.map(o => o.key), ['p/a', 'p/b'])
		assert.equal(page1.truncated, true)
		assert.ok(page1.cursor)
		var page2 = r2.list({ prefix: 'p/', limit: 2, cursor: page1.cursor })
		assert.equal(page2.objects.map(o => o.key), ['p/c'])
		assert.equal(page2.truncated, false)
		assert.end()
	})

	test('list empty bucket', (assert) => {
		var r2 = setup()
		var res = r2.list()
		assert.has(res, { objects: [], truncated: false, cursor: undefined })
		assert.end()
	})

	test('get onlyIf etag conditions', async (assert) => {
		var r2 = setup()
		var res = await r2.put('k', 'v')

		assert.equal(await r2.get('k', { onlyIf: { etagMatches: res.etag } }).text(), 'v')
		var obj = r2.get('k', { onlyIf: { etagMatches: 'wrong' } })
		assert.equal(obj.key, 'k')
		assert.equal(obj.body, undefined)

		assert.equal(await r2.get('k', { onlyIf: { etagDoesNotMatch: 'other' } }).text(), 'v')
		assert.equal(r2.get('k', { onlyIf: { etagDoesNotMatch: res.etag } }).body, undefined)
	})

	test('get onlyIf uploaded conditions', (assert) => {
		var r2 = setup()
		r2.put('k', 'v')
		var future = new Date(Date.now() + 60000)
		, past = new Date(0)

		assert.ok(r2.get('k',      { onlyIf: { uploadedBefore: future } }).size)
		assert.equal(r2.get('k',   { onlyIf: { uploadedBefore: past   } }).body, undefined)
		assert.ok(r2.get('k',      { onlyIf: { uploadedAfter:  past   } }).size)
		assert.equal(r2.get('k',   { onlyIf: { uploadedAfter:  future } }).body, undefined)
		assert.end()
	})

	test('get onlyIf with Headers (all four fields)', async (assert) => {
		var r2 = setup()
		var res = await r2.put('k', 'v')

		assert.equal(await r2.get('k', { onlyIf: new Headers({ 'if-match':            '"' + res.etag + '"' }) }).text(), 'v')
		assert.equal(await r2.get('k', { onlyIf: new Headers({ 'if-none-match':       '"other"' }) }).text(), 'v')
		assert.equal(await r2.get('k', { onlyIf: new Headers({ 'if-unmodified-since': new Date(Date.now() + 60000).toUTCString() }) }).text(), 'v')
		assert.equal(await r2.get('k', { onlyIf: new Headers({ 'if-modified-since':   new Date(0).toUTCString() }) }).text(), 'v')
	})

	test('put onlyIf etagMatches gates the write', async (assert) => {
		var r2 = setup()
		var orig = await r2.put('k', 'old')

		var res = await r2.put('k', 'new', { onlyIf: { etagMatches: 'wrong' } })
		assert.equal(res, null)
		assert.equal(await r2.get('k').text(), 'old')

		r2.put('k', 'new', { onlyIf: { etagMatches: orig.etag } })
		assert.equal(await r2.get('k').text(), 'new')
	})

	test('ttl expires objects from get/head/list', (assert) => {
		var db = new DB(':memory:')
		var r2 = R2(db, { name: 'r2_ttl', ttl: 1 })
		r2.put('k', 'v')
		assert.ok(r2.get('k'))
		db.exec("UPDATE r2_ttl SET uploaded = datetime('now', '-2 seconds')")
		assert.equal(r2.get('k'), null)
		assert.equal(r2.head('k'), null)
		assert.equal(r2.list().objects.length, 0)
		assert.end()
	})
})

describe('cron', () => {
	// parseCron returns [expr, minLow(0-29), minHigh(30-59), hour, day, month, dow].
	// Decode a mask back to the list of allowed values for a logical field
	// (0=minute..4=dow), so the bitmasks can be asserted as readable lists.
	function allowed(masks, field) {
		var out = []
		if (field) {
			for (var v = 0; v <= 31; v++) if (masks[field + 2] & 1 << v) out.push(v)
		} else {
			for (var v = 0; v < 30; v++) if (masks[1] & 1 << v) out.push(v)
			for (v = 30; v < 60; v++) if (masks[2] & 1 << v - 30) out.push(v)
		}
		return out
	}

	test('parseCron - every minute spans the full range', (assert) => {
		var masks = parseCron('* * * * *')
		assert.equal(masks[0], '* * * * *')  // expression kept at index 0
		assert.equal(allowed(masks, 0).length, 60)  // 0-59
		assert.equal(allowed(masks, 1).length, 24)  // 0-23
		assert.equal(allowed(masks, 2).length, 31)  // 1-31
		assert.equal(allowed(masks, 3).length, 12)  // 1-12
		assert.equal(allowed(masks, 4).length, 7)   // 1-7
		assert.end()
	})

	it('parseCron {0} field {1}', [
		['30 8 15 6 3', 0, [30]],
		['30 8 15 6 3', 1, [8]],
		['30 8 15 6 3', 2, [15]],
		['30 8 15 6 3', 3, [6]],
		['30 8 15 6 3', 4, [3]],
		['*/15 * * * *', 0, [0, 15, 30, 45]],
		['* * * * 1-5', 4, [1, 2, 3, 4, 5]],
		['30 8 15 JUN WED', 3, [6]],
		['30 8 15 JUN WED', 4, [4]],
		['* * * * mon-fri', 4, [2, 3, 4, 5, 6]],
		['1/2 * * * *', 0, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55, 57, 59]],
		['10-30/5 * * * *', 0, [10, 15, 20, 25, 30]],
		['0 1,3,5 * * *', 1, [1, 3, 5]],
		['0,15,30-35 * * * *', 0, [0, 15, 30, 31, 32, 33, 34, 35]],
	], (expr, i, expected, assert) => {
		assert.equal(allowed(parseCron(expr), i), expected)
		assert.end()
	})

	describe('startCron', () => {
		it('builds handle name {1}', [
			['', 'cron * * * * *'],
			['*/5 * * * *', 'cron */5 * * * *'],
			[['0 * * * *', '30 * * * *'], 'cron 0 * * * *; 30 * * * *'],
		], (cron, expected, assert, mock) => {
			mock.swap(console, 'log', ()=>{})
			var handle = startCron(cron, () => {}, {})
			assert.type(handle.close, 'function')
			assert.equal(handle.name, expected)
			handle.close()
			assert.end()
		})

		it('runs handler {2}x for cron {0}', [
			['* * * * *', +new Date(2026, 1, 10, 14, 10, 0), 1], // fires 14:11, minute < 30 (low half)
			['* * * * *', +new Date(2026, 1, 10, 14, 40, 0), 1], // fires 14:41, minute >= 30 (high half)
			['0 0 30 2 *', +new Date(2026, 1, 10, 14, 30, 0), 0], // Feb 30 never exists, so this never matches
			['* * * * 3', +new Date(2026, 1, 10, 14, 10, 0), 1], // 2026-02-10 is a Tuesday (CF dow 3): matches
			['* * * * 2', +new Date(2026, 1, 10, 14, 10, 0), 0], // Monday-only (dow 2) does not fire on Tuesday
			['* * * * 1', +new Date(2026, 1, 8, 14, 10, 0), 1],  // 2026-02-08 is a Sunday: CF dow 1 matches
			['* * * * SAT', +new Date(2026, 1, 7, 14, 10, 0), 1], // 2026-02-07 is a Saturday: SAT = dow 7
		], (cron, start, expected, assert, mock) => {
			mock.swap(console, 'log', ()=>{})
			mock.time(start) // Tuesday 2026-02-10
			var called = 0
			, handle = startCron(cron, (event, env, ctx) => {
				called++
				assert.ok(event.scheduledTime > 0, 'event carries scheduledTime')
				assert.equal(event.cron, cron, 'event carries the cron expression')
				assert.equal(env.key, 'val', 'env is passed through')
				ctx.waitUntil(Promise.resolve())
			}, { key: 'val' })

			mock.tick(60050) // cross the minute boundary so check() fires
			handle.close()
			assert.equal(called, expected, 'handler ran the expected number of times')
			assert.end()
		})
	})
})
