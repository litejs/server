
import { UNDEF, Data, fail, header, isArr, joinBuf, toStr, toUint } from './util.mjs'
import { accept } from './accept.mjs'


var setForm = (map, path, val, step = map, key = path.split('[', 1)[0]) => {
	path.replace(/\[(.*?)\]/g, (_, sub) => {
		step = step[key] ||= +sub != sub ? Data() : []
		key = sub
	})
	if (isArr(step)) key = step.length
	step[key] = step[key] == UNDEF ? val : [].concat(step[key], val)
}
, querystring = str => {
	var map = Data()
	new URLSearchParams(str || '').forEach((val, key) => setForm(map, key, val))
	return map
}
, content = async (req, opts) => {
	opts = {
		maxBodySize: 1e6, maxFields: 1000, maxFieldSize: 1e5, maxFiles: 1000, maxFileSize: 1e7,
		file: async part => new File([await readAll(part.body, 'maxFileSize')], part.filename, { type: part.type }),
		...opts
	}
	var part, tmp, gen, headers, reader, boundary
	, body = Data()
	// Leading CRLF lets the first boundary match like every other one
	, buf = toUint('\r\n')
	, CRLF2 = toUint('\r\n\r\n')
	, disposition = accept('form-data;name=;filename=')
	, negod = accept({
		'application/json': str => JSON.parse(str || '{}'),
		'application/x-www-form-urlencoded': querystring,
		'multipart/*;boundary=': 1,
		...opts.accept
	})(header(req, 'content-type')) || fail('Unsupported Media Type', 415)
	, read = async function* (needle, len = needle.length, pos, i) {
		for (;; buf = joinBuf(buf, tmp.value)) {
			for (pos = 0; (pos = buf.indexOf(needle[0], pos)) > -1; pos++) {
				for (i = 1; i < len && buf[pos + i] === needle[i]; i++);
				if (i === len) {
					if (pos) yield buf.subarray(0, pos)
					buf = buf.subarray(pos + len)
					return
				}
			}
			// Hand out all but a tail that could start the needle
			if ((pos = buf.length - len + 1) > 0) {
				yield buf.subarray(0, pos)
				buf = buf.subarray(pos)
			}
			if ((tmp = await reader.next()).done) tmp.value = needle
		}
	}
	, readAll = async (src, name, chunks = [], size = 0) => {
		for await (var chunk of src) if ((size += chunk.length) > opts[name]) fail(name + ' exceeded', 413)
		else chunks.push(chunk)
		return joinBuf(...chunks)
	}
	if (negod.type !== 'multipart') return negod.o(toStr(await readAll(req.body || [], 'maxBodySize')), negod)
	reader = (negod.boundary && req.body || fail('Bad Request', 400)).values()
	for (gen = read(boundary = toUint('\r\n--' + negod.boundary)); ; ) {
		// Drain the preamble or what a consumer left of the previous part
		for await (tmp of gen);
		// After a boundary: '--' closes, CRLF opens the headers
		if ((tmp = toStr(await readAll(read(CRLF2), 'maxFieldSize')))[0] !== '\r') return body
		headers = {}
		tmp.replace(/^([^:\r\n]+):[ \t]*(.*)/gm, (_, key, val) => headers[key.toLowerCase()] = val)
		part = { ...disposition(headers['content-disposition']) || fail('Bad Request', 400), type: headers['content-type'], headers }
		if (opts[tmp = part.filename ? 'maxFiles' : 'maxFields']-- < 1) fail(tmp + ' exceeded', 413)
		gen = read(boundary)
		part.body = new ReadableStream({
			pull: async ctrl => (tmp = await gen.next()).done ? ctrl.close() : ctrl.enqueue(tmp.value)
		})
		// A part body is read here or by the file hook; whatever is left unread is dropped
		setForm(body, part.name, part.filename ? await opts.file(part) : toStr(await readAll(part.body, 'maxFieldSize')))
	}
}


export { content, querystring }

