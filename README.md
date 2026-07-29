[1]: https://badgen.net/coveralls/c/github/litejs/server
[2]: https://coveralls.io/r/litejs/server
[3]: https://badgen.net/packagephobia/install/@litejs/server
[4]: https://packagephobia.now.sh/result?p=@litejs/server
[5]: https://badgen.net/badge/icon/Buy%20Me%20A%20Tea/orange?icon=kofi&label
[6]: https://www.buymeacoffee.com/lauriro


LiteJS Server &ndash; [![Coverage][1]][2] [![Size][3]][4] [![Buy Me A Tea][5]][6]
=============

A small, zero-dependency HTTP application core that runs the same code across
Bun, Cloudflare Workers, Deno, Node.js, and on browser Service Worker.


## Usage

`npm install @litejs/server`

```javascript
// app.mjs
import { App } from "@litejs/server"

const app = App()

// Middlewares runs only if any route matches
app.use((req, env) => {
	// return a response to stop further execution
})

// Route paths are written without leading and trailing '/'
// Only single, first matching route get executed!
app.get('hello/world', (req, env) => 'Hello MOON!')
app.get('hello/{name}', (req, env) => 'Hello ' + req.param.name)
app.get('bye/{name}', (req, env) => 'Bye ' + req.param.name)
app.get('bye/moon', (req, env) => { /* Never executed as previous handler matches */ })
app.get('teapot', (req) => (req.resStatus = 418, "no coffee"))
app.get('notFound', () => 404) // Return a number to send status code

// Group routes and mount under a prefix, also without leading and trailing '/'
const subApp = App()
.post("", (req, env) => {
    // GET /api -> req.path == '/' and req.fullPath == '/api'
    return { data: [] }
})
.post("echo", async (req, env) => {
    // POST /api/echo -> req.path == '/echo' and req.fullPath == '/api/echo'
    return await req.json()
})

app.mount("api", subApp)

export default app
```

Handlers receive `(req, env, ctx)` and may return
a native `Response`,
a number (status only),
an object or array (serialized to JSON),
or a body passed to new `Response`.

Set the status with `req.resStatus = 409`, extra headers with `req.resHeaders.allow = 'GET, PUT'`.
Thrown errors map to `err.code || 500`; 5xx bodies are kept generic.

Requests include `param`, `path`, `fullPath`, `query`, `searchParams`, and `header(name)`.
Routes match against `path`, the raw percent-encoded pathname;
`fullPath` and `param` values are decoded.

### Routes

 - `user/{username}` matches one path segment (no `/`)
 - `post/{id+}` matches one or more digits
 - `files/{rest*}.ext` matches all chars, greedy
 - `a/{dir/}{name}` matches zero or more slash-terminated directories
 - `pub/\{x}` matches the literal path `pub/{x}`


## Adapters

The same `app` runs on every runtime.
`@litejs/server` exports the matching adapter through conditional export,
so the one file below runs unchanged on Node.js, Bun, and Deno.

```javascript
// run.mjs
import {
    DB, KV, listen, loadEnv, serveStatic, setupShutdown
} from "@litejs/server"
import app from "./app.mjs"

const db = new DB("db.sqlite")
const env = loadEnv(".env.json", {
    ASSETS: serveStatic("public"),
    // Inject Cloudflare style KV on top of sqlite
    DEVICE: KV(db, "device"),
})
const server = listen(app, env)
app.get("/{path*}", env.ASSETS.fetch)

// Attach SIGINT/SIGTERM/SIGHUP/uncaughtException
setupShutdown([ server ])
```

Run it with `node run.mjs`, `bun run.mjs`, or `deno run -A run.mjs`.

### Runtimes

 - Node.js, Bun, Deno: import from `@litejs/server`; the runtime is detected automatically.
 - Cloudflare Workers: `import { worker } from "@litejs/server"`, then `export default { fetch: worker(app) }`.
 - Service Workers: `import { listen } from "@litejs/server"`.

On Node, Bun, and Deno `@litejs/server` also exports `serveStatic`, `loadEnv`,
`setupShutdown`, and SQLite-backed `DB` (D1) and `KV` shims.

Runnable examples are in [`test/server/`](test/server/).

> Copyright (c) 2026 Lauri Rooden &lt;lauri@rooden.ee&gt;  
[MIT License](https://litejs.com/MIT-LICENSE.txt) |
[GitHub repo](https://github.com/litejs/server) |
[npm package](https://npmjs.org/package/@litejs/server) |
[Buy Me A Tea][6]

