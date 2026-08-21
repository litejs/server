import {
	App,
	Cache,
	D1,
	DB,
	DO,
	Data,
	DurableObjectState,
	Env,
	KV,
	R2,
	R2Object,
	Router,
	S3,
	Server,
	ServerRequest,
	aProto,
	anyObj,
	awsVerify,
	b64Url,
	dedupe,
	durableObject,
	each,
	emit,
	getProto,
	hex,
	hide,
	isObj,
	listen,
	loadEnv,
	migrate,
	off,
	oProto,
	on,
	one,
	ownSlot,
	serve,
	serveStatic,
	setProto,
	setupShutdown,
	startCron,
	toNum,
	unlisten,
	worker
} from "@litejs/server"

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends
	(<T>() => T extends B ? 1 : 2) ? true : false
type Expect<T extends true> = T

const app = App()
const headOnly = App({ method: { GET: null } })
headOnly.head("health", 204)
const router = Router({})
// @ts-expect-error Router internals are not exposed
router.routes
// @ts-expect-error Router requires an extensions map
Router()
app.get("users/{id}", req => ({ id: req.param.id }))
	.head("users/{id}", req => 204)
	.get("files/{path*}", req => req.param.path)
app.post("users", async (req, env, ctx) => (ctx.waitUntil(Promise.resolve()), 201))
app.all("health", "OK")
app.use(req => { req.resHeaders["x-served-by"] = "litejs" })
app.mount("api", App())
app.get("cached", dedupe(async req => req.path))
const routeMatch: RegExpExecArray | "" | null = app.routers.GET.match({} as ServerRequest)

const db = new DB(":memory:")
const kv = KV(db, "kv")
const r2 = R2(db, "r2")
const env = loadEnv(false, {
	ASSETS: serveStatic("public"),
	KV: kv,
	R2: r2,
})

class Counter extends DO {
	static schema = ["CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER)"]
	value(): number {
		return this.ctx.storage.sql.exec("SELECT value FROM counter").one()?.value ?? 0
	}
}
const ns = durableObject(Counter, "/tmp/do", env)
const counter = ns.get(ns.idFromName("main"))
const byName = ns.getByName("main")

migrate(db, ["CREATE TABLE t (id INTEGER)"])
const d1 = D1(db)
const rows: any[] = d1.prepare("SELECT * FROM t WHERE id=?").bind(1).all().results

const cache = Cache()
const hit = cache.match(new Request("http://localhost/"))

const putRes = kv.put("key", "value", { expirationTtl: 60, metadata: { a: 1 } })
const listed = kv.list({ prefix: "key" })
const obj = r2.get("key")
const etag: string | undefined = obj?.etag
const body: Promise<string> | undefined = obj?.text()

const s3 = S3({ accessId: "id", secret: "secret", bucket: "bucket", region: "auto" })
const uploaded: Promise<R2Object> = s3.put("key", "data", { contentType: "text/plain" })
const presigned: Promise<string> = s3.url("key", { expires: 3600 })
const verified: Promise<string | false | undefined> = awsVerify(new Request("http://localhost/"), () => "secret")

const server = serve(app, env)
const cron = startCron("*/5 * * * *", (controller, env, ctx) => controller.scheduledTime)
setupShutdown([server, cron])

const fetchHandler = worker(app, env)
const res: Promise<Response> = fetchHandler(new Request("http://localhost/"))

const emitter = {}
const owner = {}
on(emitter, "change", (value: number) => value)
one(emitter, "spent", () => {}, owner)
listen(owner, emitter, "change", () => {}, null, "group")
const emitted: Promise<number> = emit(emitter, "change", 1)
off(emitter, "change", () => {})
unlisten(owner, "group")

const proto = Data({ inherited: 1 })
const data = Data({ own: 2 }, proto)
const nullProto: Record<string, unknown> = Data()
const slot: number[] = ownSlot(data, "slot", () => [])
const hidden = hide(data, "slot", 1)
const parent: object | null = getProto(data)
setProto(data, null)
each("a,b", (value, key) => value.length + key)
each([1, 2], (value, key) => value + key)
each({ a: 1 }, (value, key) => key.length + value)
// the type guards narrow, anyObj to anything with a property, isObj to plain data
const unknownValue: unknown = data
const anyNarrowed: object | null = anyObj(unknownValue) ? unknownValue : null
const objNarrowed: unknown = isObj(unknownValue) ? unknownValue.own : null

const num: number | null = toNum("5min")
const encoded: string = b64Url("data")
const digest: string = hex(new Uint8Array([1, 2]))

type ExpectServerName = Expect<Equal<typeof env.SERVER_NAME, string>>
type ExpectServer = Expect<Equal<typeof server, Server>>
type ExpectCounter = Expect<Equal<typeof counter, Counter>>
type ExpectByName = Expect<Equal<typeof byName, Counter>>
type ExpectCtx = Expect<Equal<Counter["ctx"], DurableObjectState>>
type ExpectEnv = Expect<Equal<Parameters<typeof serve>[1], Env | undefined>>
type ExpectEmit = Expect<Equal<typeof emitted, Promise<number>>>
type ExpectData = Expect<Equal<typeof data, { own: number }>>
type ExpectSlot = Expect<Equal<typeof hidden, typeof data>>
type ExpectProto = Expect<Equal<typeof aProto, any[]>>

// runtime references to ensure values exist
void putRes
void listed
void etag
void body
void hit
void rows
void uploaded
void presigned
void verified
void res
void num
void encoded
void digest
void nullProto
void slot
void parent
void anyNarrowed
void objNarrowed
void oProto
void routeMatch
