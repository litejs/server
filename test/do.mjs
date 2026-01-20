
import '@litejs/cli/test.js'
import { DB, DO, migrate } from '../index.mjs'


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

