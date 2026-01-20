
// Shared Durable Object class — works on all runtimes
// Node.js/Bun: durableObject(Counter, dir, env) sets ctx and env
// Cloudflare: durableObject(Counter) extends the real DurableObject base

import { DO } from '../../index.mjs'

export class Counter extends DO {
	static schema = [
		'CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, val INTEGER DEFAULT 0)',
	]
	increment() {
		return this.ctx.storage.sql.exec(
			'INSERT INTO counter (id, val) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET val = val + 1 RETURNING val'
		).one()
	}
	decrement() {
		return this.ctx.storage.sql.exec(
			'INSERT INTO counter (id, val) VALUES (1, -1) ON CONFLICT(id) DO UPDATE SET val = val - 1 RETURNING val'
		).one()
	}
	getVal() {
		return this.ctx.storage.sql.exec('SELECT val FROM counter WHERE id = 1').one() || { val: 0 }
	}
}


