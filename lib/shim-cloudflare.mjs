
// Cloudflare shims

import { UNDEF, fail, isArr, isFn, isStr, header, hex, toStr } from '../util.mjs'
import { putType, r2Body, r2Object } from './s3.mjs'
import { serveRange } from './serve.mjs'
import { createHash, randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { Database as DB } from '#sqlite'

class DurableObject {
	constructor(ctx, env) {
		this.ctx = ctx
		this.env = env
	}
}

var isGet = req => (req.method || 'GET') === 'GET'
, isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i
, jsonParse = s => s ? JSON.parse(s) : null
, optsName = (opts = {}) => {
	if (isStr(opts)) opts = { name: opts }
	opts.name = (opts.name || 'data').replace(/\W/g, '_')
	return opts
}
, varyKey = (req, vary) => vary.split(',').map(h => header(req, h.trim())).join('\0')
, kvTable = (db, opts) => {
	var { name, extra = '', fresh = '', wrap, listFields = '' } = optsName(opts)
	, fields = extra.replace(/,\s*(\w+)[^,]*/g, ',$1')
	, from = ' FROM ' + name + ' WHERE name=?'
	db.exec('CREATE TABLE IF NOT EXISTS ' + name + ' (name TEXT PRIMARY KEY,value BLOB' + extra + ') WITHOUT ROWID')
	var listQ = 'SELECT name' + fields + listFields + ' FROM ' + name + ' WHERE name LIKE ? ESCAPE \'\\\' AND name>? AND name<?' + fresh + ' ORDER BY name '
	, list = db.prepare(listQ + 'LIMIT ?')
	, listDesc = db.prepare(listQ + 'DESC LIMIT ?')
	, info = db.prepare('SELECT name' + fields + from + fresh)
	return {
		dbAll: db.prepare('SELECT name' + fields + ',value FROM ' + name),
		dbDel: db.prepare('DELETE' + from),
		dbGet: db.prepare('SELECT value' + fields + from + fresh),
		dbInfo: key => wrap(info.get(key), key),
		dbList({ limit = 1000, prefix = '', cursor = '', end = '\uffff', reverse } = {}) {
			var objects = (reverse ? listDesc : list).all(prefix.replace(/[\\%_]/g, '\\$&') + '%', cursor, end, limit + 1)
			, len = objects.length
			, truncated = len > limit
			cursor = truncated ? objects[(len = --objects.length) - 1].name : UNDEF
			for (; len--;) objects[len] = wrap(objects[len])
			return { cursor, objects, truncated }
		},
		dbSet: db.prepare('REPLACE INTO ' + name + ' (name,value' + fields + ') VALUES (?,?' + fields.replace(/\w+/g, '?') + ')'),
	}
}
// Read from Map(), write-through to DB to preserve state on restart
, kvMap = (db, table, preserveKeys = null) => {
	var { dbAll, dbDel, dbSet } = kvTable(db, table)
	, map = new Map(dbAll.all().map(r => [r.name, jsonParse(r.value)]))
	map.set = (key, value) => (dbSet.run(key, JSON.stringify(value, preserveKeys)), Map.prototype.set.call(map, key, value))
	map.delete = key => (dbDel.run(key), Map.prototype.delete.call(map, key))
	return map
}
, Cache = (map = new Map()) => ({
	match(req) {
		var key = req.url || req
		, item = isGet(req) && map.get(key)
		if (item) {
			if (item.expires <= Date.now()) map.delete(key)
			else if (!item.vary || item.reqVary === varyKey(req, item.vary)) return serveRange(req, item.res.clone())
		}
	},
	put(req, res) {
		var vary = header(res, 'vary')
		, cc = header(res, 'cache-control')
		if (isGet(req) && vary !== '*' && !/no-store|private/.test(cc)) map.set(req.url || req, {
			res, vary, reqVary: vary && varyKey(req, vary),
			expires: cc && (cc = /s-maxage=(\d+)/.exec(cc) || /max-age=(\d+)/.exec(cc)) ? cc[1] * 1000 + Date.now() :
				Date.parse(header(res, 'expires')) || Date.now() + 60000
		})
	},
	delete(req) {
		return map.delete(req.url || req)
	},
})
, d1Wrap = (stmt, write, binds, run) => (
	run = (results, meta) => (results = stmt.all(...binds), meta = write && write.get(), {
		results, success: true, meta: { duration: 0, changed_db: !!(meta.changes), ...meta }
	}),
	{
		all: run,
		bind: (...values) => d1Wrap(stmt, write, values),
		first: (col, row) => (row = stmt.get(...binds), row && col ? row[col] : row || null),
		raw(opts) {
			var rows = stmt.all(...binds)
			, out = rows.map(Object.values)
			if (rows[0] && opts?.columnNames) out.unshift(Object.keys(rows[0]))
			return out
		},
		run
	}
)
, D1 = (db, self, getChanges = db.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id')) => self = {
	batch: stmts => {
		db.exec('BEGIN')
		try {
			var results = stmts.map(stmt => stmt.run())
			db.exec('COMMIT')
			return results
		} catch (err) {
			db.exec('ROLLBACK')
			throw err
		}
	},
	exec: sql => (db.exec(sql), { count: 1, duration: 0 }),
	getBookmark: () => null,
	prepare: sql => d1Wrap(db.prepare(sql), isWrite.test(sql) && getChanges, []),
	withSession: () => self,
}
, blockConcurrencyWhile = fn => fn()
, evict = instances => {
	instances.forEach((entry, key) => {
		if (entry.active) entry.active = false
		else {
			entry.db.close()
			instances.delete(key)
		}
	})
}
// An id names a sqlite file, so it must stay a bare digest and never a path
, checkId = id => /^[0-9a-f]{64}$/.test(id) ? id : fail('Invalid Durable Object ID')
, idFromString = (id, name) => (checkId(id), {
	equals: other => id === '' + other,
	name: name || null,
	toString: () => id
})
, newUniqueId = () => idFromString(hex(randomBytes(32)))
, durableAlarms = db => kvMap(db, 'do_alarms', ['time'])
, durableObject = (Cls, dir, env, alarms = new Map()) => {
	var instances = new Map()
	, MAX_DELAY = 2147483647
	, schedule = (time, id, key, retryCount = 0) => {
		// setTimeout overflows past MAX_DELAY, run in steps
		var left = time - Date.now()
		, timer = setTimeout(
			left > MAX_DELAY ? schedule : fireAlarm,
			left > MAX_DELAY ? MAX_DELAY : left < 0 ? 0 : left,
			time, id, key, retryCount
		)
		timer.unref?.()
		alarms.set(key, { time, timer })
	}
	, fireAlarm = async (time, id, key, retryCount) => {
		if (alarms.delete(key)) try {
			await get(id).alarm({ retryCount, isRetry: retryCount > 0 })
		} catch (e) {
			if (++retryCount <= 6) schedule(Date.now() + 2000 * (1 << (retryCount - 1)), id, key, retryCount)
		}
	}
	, get = id => {
		var key = checkId('' + id)
		, entry = instances.get(key) || (instances.set(key, key = run(id, key)), key)
		entry.active = true
		return entry.instance
	}
	, idFromName = name => idFromString(createHash('sha256').update(Cls.name + '/' + name).digest('hex'), name)
	, run = (id, key) => {
		var db = new DB(dir + '/' + key + '.sqlite')
		, { dbSet, dbDel, dbGet, dbList } = kvTable(db, {
			name: '_kv',
			listFields: ',value',
			wrap: r => [r.name, JSON.parse(r.value)],
		})
		, changes = db.prepare('SELECT changes() AS c')
		, transactionSync = fn => {
			db.exec('BEGIN')
			try {
				var result = fn()
				db.exec('COMMIT')
				return result
			} catch (e) {
				db.exec('ROLLBACK')
				throw e
			}
		}
		, kv = {
			get(key) {
				var row = dbGet.get(key)
				return row ? JSON.parse(row.value) : UNDEF
			},
			put: (key, value) => dbSet.run(key, JSON.stringify(value)),
			delete(key) {
				dbDel.run(key)
				return changes.get().c > 0
			},
			list: opts => new Map(dbList({ limit: 1e9, ...opts, cursor: opts?.startAfter ? opts.startAfter + '\0' : opts?.start}).objects),
		}
		, ctx = {
			id,
			blockConcurrencyWhile,
			storage: {
				...kv,
				kv,
				deleteAll() {
					db.close()
					instances.delete(key)
					rmSync(dir + '/' + key + '.sqlite', { force: true })
				},
				deleteAlarm: () => { clearTimeout(alarms.get(key)?.timer), alarms.delete(key) },
				getAlarm: () => alarms.get(key)?.time || null,
				setAlarm: time => {
					clearTimeout(alarms.get(key)?.timer)
					schedule(+time, id, key)
				},
				transactionSync,
				transaction: transactionSync,
				sql: {
					exec(query, ...binds) {
						var rows = db.prepare(query).all(...binds)
						return {
							columnNames: rows.length ? Object.keys(rows[0]) : [],
							one: () => rows[0],
							raw: () => rows.map(row => Object.values(row)),
							rowsRead: rows.length,
							rowsWritten: isWrite.test(query) ? changes.get().c : 0,
							toArray: () => rows,
						}
					}
				}
			}
		}
		return { db, instance: new Cls(ctx, env) }
	}
	, origFetch = Cls.prototype.fetch

	if (isFn(origFetch)) Cls.prototype.fetch = function(input, opts) {
		return origFetch.call(this, input instanceof Request ? input : new Request(input, opts))
	}

	for (var [key, entry] of alarms) schedule(entry.time, idFromString(key), key)
	setInterval(evict, 300000, instances).unref?.()

	return {
		get,
		getByName: name => get(idFromName(name)),
		idFromName,
		idFromString,
		newUniqueId,
	}
}
, KV = (db, name) => {
	var { dbDel, dbGet, dbList, dbSet } = kvTable(db, {
		name,
		extra: ', metadata TEXT, expiration INTEGER',
		fresh: ' AND (expiration IS NULL OR expiration > unixepoch())',
		wrap: r => (r.metadata = jsonParse(r.metadata), r),
	})
	, readValue = (row, type) => row ? (
		row = row.value,
		type === 'stream' ? new Response(row).body :
		type === 'arrayBuffer' ? row.buffer.slice(row.byteOffset, row.byteOffset + row.byteLength) :
		(row = toStr(row), type === 'json') ? jsonParse(row) : row
	) : null
	, readMeta = (row, type) => row ?
		{ value: readValue(row, type), metadata: jsonParse(row.metadata), } :
		{ value: null, metadata: null }
	, kvGet = (key, type, read) => {
		if (!isStr(type)) type = type?.type
		return isArr(key)
			? new Map(key.map(k => [k, read(dbGet.get(k), type)]))
			: read(dbGet.get(key), type)
	}
	return {
		get(key, type) {
			return kvGet(key, type, readValue)
		},
		getWithMetadata(key, type) {
			return kvGet(key, type, readMeta)
		},
		async put(key, val, opts) {
			if (val == null) throw TypeError('KV put() requires a value')
			var buf = r2Body(val)
			dbSet.run(
				key,
				isFn(buf.then) ? await buf : buf,
				opts?.metadata ? JSON.stringify(opts.metadata) : null,
				opts?.expiration ?? (opts?.expirationTtl ? (Date.now() / 1000 | 0) + opts.expirationTtl : null)
			)
		},
		delete(key) {
			dbDel.run(key)
		},
		list(opts) {
			var { objects, truncated, cursor } = dbList(opts)
			return { keys: objects, list_complete: !truncated, cursor }
		},
	}
}
, r2Wrap = (row, key) => row ? r2Object(
	row.value != null ? new Response(row.value, { headers: { 'content-type': row.type } }) : {},
	(row.key = key ?? row.name, row)
) : null
, checkCond = (cond, row, val, h) => !cond || !row || !(
	(h = cond.get && cond, val = h ? h.get('if-match')?.replace(/^"|"$/g, '') : cond.etagMatches) && val !== row.etag ||
	(val = h ? h.get('if-none-match')?.replace(/^"|"$/g, '') : cond.etagDoesNotMatch) && val === row.etag ||
	(row = new Date(row.uploaded), val = h ? h.get('if-unmodified-since') : cond.uploadedBefore) && row >= new Date(val) ||
	(val = h ? h.get('if-modified-since') : cond.uploadedAfter) && row <= new Date(val)
)
, R2 = (db, opts) => {
	var { name, ttl } = optsName(opts)
	, { dbDel, dbGet, dbInfo, dbList, dbSet } = kvTable(db, {
		name,
		extra: ',size INTEGER,etag TEXT,type TEXT,custom TEXT,uploaded TEXT',
		fresh: ttl ? ' AND uploaded>strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\', \'-' + (ttl | 0) + ' seconds\')' : '',
		wrap: r2Wrap,
	})
	return {
		get(key, opts) {
			var row = dbGet.get(key)
			return row ? r2Wrap(checkCond(opts?.onlyIf, row) ? row : { ...row, value: null }, key) : null
		},
		async put(key, val, opts) {
			var buf = r2Body(val)
			if (isFn(buf.then)) buf = await buf
			if (opts?.onlyIf && !checkCond(opts.onlyIf, dbInfo(key))) return null
			var etag = createHash('md5').update(buf).digest('hex')
			, type = putType(opts)
			, size = buf.length
			, custom = opts?.customMetadata || {}
			dbSet.run(key, buf, size, etag, type, JSON.stringify(custom), new Date().toJSON())
			return r2Object({}, { key, size, etag, type, custom })
		},
		delete: keys => {
			[].concat(keys).forEach(k => dbDel.run(k))
		},
		head: dbInfo,
		list: dbList,
	}
}
// Parses to [expr, minLow(0-29), minHigh(30-59), hour, day, month, dow]
// Minutes split at 30 so every mask fits in 32 bits
// Cloudflare dow is 1 = Sunday .. 7 = Saturday
, cronNames = 'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDECSUNMONTUEWEDTHUFRISAT'
, cronNum = s => isNaN(s) ? cronNames.indexOf(s) / 3 % 12 + 1 : +s
, parseCron = expr => {
	var masks = [expr], max = [59, 23, 31, 12, 7]
	expr.trim().toUpperCase().split(/\s+/).forEach((field, i) => {
		for (var part of field.split(',')) {
			var [range, step] = part.split('/')
			, [lo, hi] = range === '*' ? [i < 2 ? 0 : 1, max[i]] : range.split('-').map(cronNum)
			, v = lo
			for (; v <= (step ? hi || max[i] : hi ?? lo); v += +step || 1) {
				masks[i ? i + 2 : v < 30 ? 1 : 2] |= 1 << (i ? v : v % 30)
			}
		}
	})
	return masks
}
, startCron = (cron, scheduled, env) => {
	var timer
	, crons = [].concat(cron || '* * * * *').map(parseCron)
	, name = 'cron ' + crons.map(c => c[0]).join('; ')
	, lastMin = -1
	, tick = () => (timer = setTimeout(check, 60050 - Date.now() % 60000)).unref?.()
	, check = () => {
		var now = new Date()
		, min = 0 | (now / 60000)
		if (min !== lastMin) {
			lastMin = min
			var m = now.getMinutes(), a = 1 << m % 30, b = m < 30 ? 1 : 2
			, h = 1 << now.getHours(), d = 1 << now.getDate()
			, mo = 1 << now.getMonth() + 1, dow = 1 << now.getDay() + 1
			for (m of crons) if (
				m[b] & a && m[3] & h && m[4] & d && m[5] & mo && m[6] & dow
			) scheduled({ scheduledTime: +now, cron: m[0] }, env, { waitUntil() {} })
		}
		tick()
	}
	tick()
	console.log('Started', name)
	return {
		name,
		close: () => clearTimeout(timer),
	}
}

export { Cache, D1, DurableObject, KV, R2, evict, durableAlarms, durableObject, kvMap, parseCron, startCron }

