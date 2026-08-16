
import { createReadStream, promises, rmSync } from 'node:fs'
import { Readable } from 'node:stream'

export { resolve, sep } from 'node:path'

var cwd = () => process.cwd()
, remove = file => rmSync(file, { force: true })
, stat = async file => {
	var st = await promises.stat(file)
	return { isFile: st.isFile(), size: st.size }
}
, body = file => Readable.toWeb(createReadStream(file))


export { body, cwd, remove, stat }

