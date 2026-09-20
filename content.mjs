
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
	var part, tmp, needle, reader, boundary
	, CRLF2 = toUint('\r\n\r\n')
	, body = Data()
	, buf = CRLF2
	, cut = (pos, len, out = buf.subarray(0, pos)) => (buf = buf.subarray(pos + len), out)
	, disposition = accept('form-data;name=;filename=')
	, negod = accept({
		'application/json': str => JSON.parse(str || '{}'),
		'application/x-www-form-urlencoded': querystring,
		'multipart/*;boundary=': 1,
		...opts.accept
	})(header(req, 'content-type')) || fail('Unsupported Media Type', 415)
	, next = async (pos, i) => {
		for (; needle; buf = joinBuf(buf, tmp.value)) {
			for (pos = 0; (pos = buf.indexOf(needle[0], pos)) > -1; pos++) {
				for (i = 1; i < needle.length && buf[pos + i] === needle[i]; i++);
				if (i === needle.length) return (needle = 0, cut(pos, i))
			}
			// Hand out all but a tail that could start the needle
			if ((pos = buf.length - needle.length + 1) > 0) return cut(pos, 0)
			if ((tmp = await reader.next()).done) tmp.value = needle
		}
	}
	// No read-ahead: a pull made before anyone reads would run next() concurrently with the drain
	, read = () => new ReadableStream({
		pull: async ctrl => (tmp = await next())?.length ? ctrl.enqueue(tmp) : ctrl.close()
	}, { highWaterMark: 0 })
	, readAll = async (src, name, chunks = [], size = 0) => {
		for await (var chunk of src) if ((size += chunk.length) > opts[name]) fail(name + ' exceeded', 413)
		else chunks.push(chunk)
		return toStr(joinBuf(...chunks))
	}
	if (negod.type !== 'multipart') return negod.o(await readAll(req.body || [], 'maxBodySize'), negod)
	reader = (negod.boundary && req.body || fail('Bad Request', 400)).values()
	try {
		for (needle = boundary = toUint('\r\n--' + negod.boundary); ; ) {
			while (await next());
			if ((tmp = await readAll(read(needle = CRLF2), 'maxFieldSize'))[0] !== '\r') return body
			part = {
				...disposition(/^content-disposition:[ \t]*(.*)/im.exec(tmp)?.[1]) || fail('Bad Request', 400),
				type: /^content-type:[ \t]*(.*)/im.exec(tmp)?.[1],
				body: read(needle = boundary)
			}
			if (opts[tmp = part.filename ? 'maxFiles' : 'maxFields']-- < 1) fail(tmp + ' exceeded', 413)
			setForm(body, part.name, await (part.filename ? opts.file(part) : readAll(part.body, 'maxFieldSize')))
		}
	} finally {
		reader.return()
	}
}


export { content, querystring }

