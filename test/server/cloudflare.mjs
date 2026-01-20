
import app from './app.mjs'
import { worker } from '../../index.mjs'

export { Counter } from './counter.mjs'
export default {
	fetch: worker(app),
}

