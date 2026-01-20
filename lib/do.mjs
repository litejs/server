
import { DurableObject } from '#env'
import { isArr } from '../util.mjs'

// Sync migrate for sqlite-backed D1 and Durable Object sql
var migrate = (db, schema, migrations_table = '_migrations') => {
	if (isArr(schema)) {
		db.exec('CREATE TABLE IF NOT EXISTS ' + migrations_table + ' (id INTEGER PRIMARY KEY, applied_at DATETIME)')
		var q = 'SELECT COUNT(id) AS v FROM ' + migrations_table
		, i = (db.prepare?.(q).get() || db.exec(q).one()).v
		for (; i < schema.length; ) {
			db.exec(schema[i++])
			db.exec('INSERT INTO ' + migrations_table + " (id, applied_at) VALUES (" + i + ", '" + new Date().toJSON() + "')")
		}
	}
}

class DO extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env)
		migrate(ctx.storage.sql, this.constructor.schema)
	}
}

export { DO, migrate }

