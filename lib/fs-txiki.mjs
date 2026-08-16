

import path from 'tjs:path'


var { resolve, sep } = path
, cwd = () => tjs.cwd()
, stat = async file => {
	var st = await tjs.stat(file)
	return { isFile: st.isFile, size: st.size }
}
, body = file => tjs.readFile(file)
, remove = file => { tjs.remove(file).catch(() => {}) }


export { body, cwd, remove, resolve, sep, stat }

