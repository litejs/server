
// tjs:sqlite is close to node:sqlite, two differences:
//  - run() returns undefined instead of { changes, lastInsertRowid }
//  - named parameters bind as $name, not :name

import { Database as DB } from 'tjs:sqlite'


class Database extends DB {
	prepare(sql) {
		var stmt = super.prepare(sql)
		stmt.get || (stmt.get = (...binds) => stmt.all(...binds)[0])
		return stmt
	}
}


export { Database }

