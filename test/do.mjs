
import '@litejs/cli/test.js'
import { DB, DO, WebSocketDO, migrate } from '../index.mjs'


describe('lib/do.mjs', () => {
	var version = (db, table = '_migrations') => db.prepare('SELECT COUNT(id) AS v FROM ' + table).get().v

	test('migrate', (assert, mock) => {
		mock.time("2026-06-10T10:58:33.606Z")
		var db = new DB(':memory:')

		// non-array schema do not create a table
		migrate(db, undefined)
		assert.throws(() => version(db), 'no _migrations table created')

		// empty schema leaves version 0
		migrate(db, [])
		assert.equal(version(db), 0)

		// applies a schema
		migrate(db, ['CREATE TABLE a (id INTEGER PRIMARY KEY)'])
		assert.equal(version(db), 1)

		mock.tick(1001)
		// Re-running with the same first step is a no-op (a duplicate CREATE would throw)
		migrate(db, [
			'CREATE TABLE a (id INTEGER PRIMARY KEY)',
			'CREATE TABLE b (id INTEGER PRIMARY KEY)',
		])
		assert.equal(version(db), 2)

		assert.equal(
			db.prepare('SELECT id, applied_at FROM _migrations ORDER BY id').all(),
			[{"id":1,"applied_at":"2026-06-10T10:58:33.606Z"},{"id":2,"applied_at":"2026-06-10T10:58:34.607Z"}]
		)

		assert.end()
	})

	test('migrate to custom table name', (assert) => {
		var db = new DB(':memory:')
		migrate(db, ['CREATE TABLE a (id INTEGER PRIMARY KEY)'], 'do_migrations')
		assert.equal(version(db, 'do_migrations'), 1)
		assert.throws(() => version(db), 'default table is untouched')
		assert.end()
	})

	test('DO migrates its schema on construction', (assert) => {
		// Durable Object sql has no `prepare`; reads go through exec(q).one()
		var db = new DB(':memory:')
		, ctx = {
			storage: {
				sql: {
					exec(q) {
						if (/^SELECT/i.test(q)) return { one: () => db.prepare(q).get() }
						db.exec(q)
					}
				}
			}
		}
		, env = { FOO: 1 }
		class Counter extends DO {
			static schema = ['CREATE TABLE counter (id INTEGER PRIMARY KEY)']
		}
		var counter = new Counter(ctx, env)
		assert.strictEqual(counter.ctx, ctx)
		assert.strictEqual(counter.env, env)
		assert.equal(version(db), 1, 'schema is applied')
		// the schema table exists (would throw otherwise)
		db.exec('INSERT INTO counter (id) VALUES (1)')
		assert.end()
	})
})

// The hibernation API's socket, with the attachment kept as the runtime keeps it: a copy
var attach = (saved, saves = []) => ({
	saves,
	serializeAttachment: val => saves.push(saved = structuredClone(val)),
	deserializeAttachment: () => saved ?? null,
})
// Cloudflare calls the class, which finds the map by the socket's first tag
, deliver = (fns, method, ...args) => new (class extends WebSocketDO {
	static ws = { p: fns }
})({ getTags: () => ['p'], storage: {} }, 'ENV')[method](...args)

describe('WebSocketDO socket state', () => {
	test('loads from the attachment and saves after the listener', async assert => {
		var ws = attach({ n: 1 })
		, seen
		await deliver({ message: (s, data, env, ctx) => (seen = [s.state.n, data, env, !!ctx.getTags], s.state.n++) }, 'webSocketMessage', ws, 'D')
		assert.equal(seen, [1, 'D', 'ENV', true])
		assert.equal(ws.deserializeAttachment(), { n: 2 }, 'a mutation is saved')
	})

	test('close and error get their own arguments, then env and ctx', assert => {
		var seen = []
		, fns = { close: (s, ...a) => seen.push(a.length, a[0], a[1], a[2]), error: (s, ...a) => seen.push(a.length, a[0], a[1]) }
		// The runtime passes wasClean too
		deliver(fns, 'webSocketClose', attach(), 1000, 'bye', true)
		deliver(fns, 'webSocketError', attach(), 'E')
		assert.equal(seen, [4, 1000, 'bye', 'ENV', 3, 'E', 'ENV'])
		assert.end()
	})

	test('a live state is not replaced by the attachment', async assert => {
		var ws = attach({ n: 9 })
		, live = ws.state = { n: 1 }
		await deliver({ message: s => assert.ok(s.state === live) }, 'webSocketMessage', ws)
		assert.equal(ws.saves, [{ n: 1 }])
	})

	test('nothing to save costs no serialization', async assert => {
		var ws = attach()
		assert.equal(await deliver({}, 'webSocketMessage', ws), undefined, 'a missing listener is fine')
		assert.equal(ws.state, null, 'the attachment was asked once')
		assert.equal(ws.saves, [])
	})

	test('an async listener saves once it settles', async assert => {
		var ws = attach()
		, res = deliver({ message: async s => (await 0, s.state = 'late') }, 'webSocketMessage', ws)
		assert.equal(ws.saves, [], 'not yet')
		await res
		assert.equal(ws.saves, ['late'])
	})

	test('a throw surfaces and leaves the attachment as it was', async assert => {
		var ws = attach('old')
		await deliver({ message: s => { s.state = 'new'; throw Error('boom') } }, 'webSocketMessage', ws).then(assert.fail, e => assert.equal(e.message, 'boom'))
		assert.equal(ws.deserializeAttachment(), 'old')
	})
})

