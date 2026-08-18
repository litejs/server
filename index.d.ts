
// Type definitions for @litejs/server

//
// util.mjs
//

export const UNDEF: undefined
export function b64Arr(str: string): Uint8Array
export function b64Dec(str: string): string
export function b64Enc(buf: unknown): string
export function b64Url(buf: unknown): string
export function fail(msg?: string): never
export const hasOwn: typeof Object.hasOwn
export function header(src: { headers?: Headers | { get(name: string): string | null } } | null | undefined, name: string): string
export function hex(val: unknown): string
export const isArr: typeof Array.isArray
export function isFn(fn: unknown): fn is (...args: any[]) => any
export function isNum(num: unknown): num is number
export function isObj(obj: unknown): obj is Record<string, unknown>
export function isStr(str: unknown): str is string
export function joinBuf(...parts: unknown[]): Uint8Array
export function toNum(val: unknown): number | null
export function toStr(val: unknown): string
export function toUint(val: unknown): Uint8Array

//
// app.mjs
//

export type Env = Record<string, any>

export interface Ctx {
	waitUntil(promise: Promise<unknown>): void
	[key: string]: any
}

export interface ServerRequest extends Request {
	header(name: string): string | null
	origin: string
	// path is percent-encoded and mount-stripped, fullPath is decoded
	path: string
	fullPath: string
	query: string
	searchParams: URLSearchParams
	param: Record<string, string>
	route?: string
	mount?: string
	resStatus?: number
	resHeaders: Record<string, string>
}

export type HandlerResult = Response | Error | number | string | object | null | void
export type Handler = (req: ServerRequest, env: Env, ctx: Ctx) => HandlerResult | Promise<HandlerResult>
export type RouteHandler = Handler | HandlerResult

export interface RouterOptions {
	extensions?: Record<string, string>
	notFound?: Handler
}

export interface AppOptions extends RouterOptions {
	method?: Record<string, string>
	notAllowed?: Handler
}

export interface RouterInstance {
	routes: unknown[]
	match(req: ServerRequest): RegExpExecArray | "" | null
	add(route: string, handler: RouteHandler, _raw?: string): this
	use(...fns: Handler[]): void
	handle(req: ServerRequest, env: Env, ctx: Ctx, matched: RegExpExecArray): Promise<HandlerResult>
}

// Route and mount paths are written without leading and trailing '/' - 'hello/{name}' NOT '/hello/{name}/'
export interface AppInstance {
	(req: ServerRequest, env: Env, ctx: Ctx): Promise<HandlerResult>
	routers: Record<string, RouterInstance>
	del(route: string, handler: RouteHandler, _raw?: string): AppInstance
	get(route: string, handler: RouteHandler, _raw?: string): AppInstance
	head(route: string, handler: RouteHandler, _raw?: string): AppInstance
	patch(route: string, handler: RouteHandler, _raw?: string): AppInstance
	post(route: string, handler: RouteHandler, _raw?: string): AppInstance
	put(route: string, handler: RouteHandler, _raw?: string): AppInstance
	all(route: string, handler: RouteHandler, _raw?: string): AppInstance
	mount(path: string, sub: Handler): AppInstance
	use(...fns: Handler[]): AppInstance
}

export function App(opts?: AppOptions): AppInstance
export function Router(extensions?: Record<string, string>): RouterInstance

//
// lib/node.mjs + lib/env.mjs
//

export interface Server {
	name?: string
	close(): void
	reload?(): void
}

export function listen(app: Handler, env?: Env): Server
export function loadEnv(file?: string | false, rest?: Env): Env & { SERVER_NAME: string }
export function readFiles(dir: string, root?: string, ext?: string): string[]
export function readCert(env: Env): { key: string, cert: string } | false | undefined
export function httpsRedirect(env: Env): (req: Request) => Response
export function setupShutdown(servers: Server | Server[], opts?: { exitTime?: number, onReload?: () => void }): void
export function worker(app: Handler, env?: Env): (req: Request, env?: Env, ctx?: Ctx) => Promise<Response>

//
// Server() - one entrypoint per app, resolved by #runtime
//

export type FetchHandler = (req: Request, env?: Env, ctx?: Ctx) => Promise<Response>
// What the host wants as its module default: { fetch } on Cloudflare and Vercel,
// the handler itself on Netlify, nothing where the library owns the socket (Node.js, Bun, Deno, txiki) or registers a fetch listener.
export function Server(app: Handler, dir?: string): FetchHandler | { fetch: FetchHandler } | void

//
// lib/serve.mjs
//

export function serveRange(req: Request, res: Response | Promise<Response>): Promise<Response>
export function serveStatic(baseDir?: string, opts?: { defaultMime?: string }): { fetch(req: Request): Promise<Response> }

//
// Platform primitives, each runtime's own, resolved from #runtime
//

export const sep: string
export function body(file: string): ReadableStream | Promise<Uint8Array>
export function cwd(): string
export function remove(file: string): void
export function resolve(...parts: string[]): string
export function stat(file: string): Promise<{ isFile: boolean, size: number }>
export function createHash(algorithm: string): { update(data: unknown): { digest(enc: string): string } }

//
// DB - node:sqlite DatabaseSync, bun:sqlite on Bun, tjs:sqlite on txiki
//

export interface DBStatement {
	all(...params: unknown[]): any[]
	get(...params: unknown[]): any
	run(...params: unknown[]): { changes: number | bigint, lastInsertRowid: number | bigint }
}

export class DB {
	constructor(path?: string, opts?: object)
	exec(sql: string): void
	prepare(sql: string): DBStatement
	close(): void
}

//
// lib/shim-cloudflare.mjs
//

export type BodyValue = string | Uint8Array | ArrayBuffer | number[] | ReadableStream | Blob | Response

export interface CacheShim {
	match(req: Request | string): Promise<Response> | undefined
	put(req: Request | string, res: Response): void
	delete(req: Request | string): boolean
}

export function Cache(map?: Map<string, any>): CacheShim

export interface D1Result {
	results: any[]
	success: boolean
	meta: { duration: number, changed_db: boolean, changes?: number | bigint, last_row_id?: number | bigint }
}

export interface D1Statement {
	all(): D1Result
	bind(...values: unknown[]): D1Statement
	first(col?: string): any
	raw(opts?: { columnNames?: boolean }): unknown[][]
	run(): D1Result
}

export interface D1Database {
	batch(stmts: D1Statement[]): D1Result[]
	exec(sql: string): { count: number, duration: number }
	getBookmark(): null
	prepare(sql: string): D1Statement
	withSession(): D1Database
}

export function D1(db: DB): D1Database

export interface DurableObjectId {
	name: string | null
	equals(other: DurableObjectId | string): boolean
	toString(): string
}

export interface SqlExecResult {
	columnNames: string[]
	rowsRead: number
	rowsWritten: number
	one(): any
	raw(): unknown[][]
	toArray(): any[]
}

export interface SqlStorage {
	exec(query: string, ...binds: unknown[]): SqlExecResult
}

export interface DurableObjectKv {
	get(key: string): any
	put(key: string, value: unknown): void
	delete(key: string): boolean
	list(opts?: { start?: string, startAfter?: string, prefix?: string, end?: string, limit?: number, reverse?: boolean }): Map<string, any>
}

export interface DurableObjectStorage extends DurableObjectKv {
	kv: DurableObjectKv
	deleteAll(): void
	deleteAlarm(): void
	getAlarm(): number | null
	setAlarm(time: number | Date): void
	transactionSync<T>(fn: () => T): T
	transaction<T>(fn: () => T | Promise<T>): Promise<T>
	sql: SqlStorage
}

export interface DurableObjectState {
	id: DurableObjectId
	blockConcurrencyWhile<T>(fn: () => T | Promise<T>): Promise<T>
	storage: DurableObjectStorage
}

export class DurableObject {
	ctx: DurableObjectState
	env: Env
	constructor(ctx: DurableObjectState, env: Env)
}

export interface DurableObjectNamespace<T = any> {
	get(id: DurableObjectId): T
	getByName(name: string): T
	idFromName(name: string): DurableObjectId
	idFromString(hex: string, name?: string): DurableObjectId
	newUniqueId(): DurableObjectId
}

export function durableObject<T extends DurableObject>(
	Cls: new (ctx: any, env: any) => T,
	dir: string,
	env?: Env,
	alarms?: Map<string, { time: number }>
): DurableObjectNamespace<T>

export function durableAlarms(db: DB): Map<string, { time: number }>
export function kvMap(db: DB, table: string | { name?: string }, preserveKeys?: string[] | null): Map<string, any>

export type KVGetType = 'text' | 'json' | 'arrayBuffer' | 'stream'

export interface KVListResult {
	keys: { name: string, metadata: unknown, expiration?: number }[]
	list_complete: boolean
	cursor?: string
}

export interface KVNamespace {
	get(key: string, type?: KVGetType | { type?: KVGetType }): any
	get(key: string[], type?: KVGetType | { type?: KVGetType }): Map<string, any>
	getWithMetadata(key: string, type?: KVGetType | { type?: KVGetType }): { value: any, metadata: any }
	getWithMetadata(key: string[], type?: KVGetType | { type?: KVGetType }): Map<string, { value: any, metadata: any }>
	put(key: string, value: BodyValue, opts?: { metadata?: unknown, expiration?: number, expirationTtl?: number }): Promise<void>
	delete(key: string): void
	list(opts?: { prefix?: string, cursor?: string, limit?: number }): KVListResult
}

export function KV(db: DB, name?: string): KVNamespace

export interface R2Object {
	key: string
	size: number
	etag: string
	httpEtag: string
	httpMetadata: { contentType: string }
	customMetadata: Record<string, string>
	uploaded: Date
	writeHttpMetadata(headers: Headers): void
}

export type R2ObjectBody = R2Object & Response

export type R2Conditional = Headers | {
	etagMatches?: string
	etagDoesNotMatch?: string
	uploadedBefore?: Date | string
	uploadedAfter?: Date | string
}

export interface R2PutOptions {
	onlyIf?: R2Conditional
	httpMetadata?: { contentType?: string }
	contentType?: string
	customMetadata?: Record<string, string>
}

export interface R2ListResult {
	objects: R2Object[]
	truncated: boolean
	cursor?: string
}

export interface R2Bucket {
	get(key: string, opts?: { onlyIf?: R2Conditional }): R2ObjectBody | null
	put(key: string, value: BodyValue, opts?: R2PutOptions): Promise<R2Object | null>
	delete(keys: string | string[]): void
	head(key: string): R2Object | null
	list(opts?: { prefix?: string, cursor?: string, limit?: number, reverse?: boolean }): R2ListResult
}

export function R2(db: DB, opts?: string | { name?: string, ttl?: number }): R2Bucket

export function parseCron(expr: string): (string | number)[]
export function startCron(
	cron: string | string[] | null | undefined,
	scheduled: (controller: { scheduledTime: number, cron: string }, env: Env, ctx: Ctx) => unknown,
	env?: Env
): Server

//
// lib/dedupe.mjs
//

export function dedupe(handler: Handler, key?: string): Handler

//
// lib/do.mjs
//

export function migrate(db: DB | SqlStorage, schema?: string[], migrations_table?: string): void

export class DO extends DurableObject {
	static schema?: string[]
}

//
// lib/s3.mjs
//

export interface AwsApiOptions {
	accessId: string
	secret: string
	bucket?: string
	region?: string
	service?: string
	endpoint?: string
	fetch?: typeof fetch
}

export interface AwsApi {
	request(method: string, key?: string, body?: BodyInit | null, query?: string, extra?: Record<string, string>): Promise<Response>
	url(key: string, opts?: { method?: string, expires?: number, date?: string, query?: string }): Promise<string>
}

export function awsApi(opts: AwsApiOptions): AwsApi
export function awsVerify(req: Request, getSecret: (id: string) => string | undefined | Promise<string | undefined>, skew?: number): Promise<string | false | undefined>

export interface S3Bucket extends AwsApi {
	get(key: string): Promise<R2ObjectBody | null>
	head(key: string): Promise<R2Object | null>
	put(key: string, value: BodyValue, opts?: R2PutOptions): Promise<R2Object>
	delete(keys: string | string[]): Promise<void>
	list(opts?: { prefix?: string, cursor?: string, limit?: number }): Promise<R2ListResult>
}

export function S3(opts: AwsApiOptions): S3Bucket
