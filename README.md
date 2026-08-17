[1]: https://badgen.net/coveralls/c/github/litejs/server
[2]: https://coveralls.io/r/litejs/server
[3]: https://badgen.net/packagephobia/install/@litejs/server
[4]: https://packagephobia.now.sh/result?p=@litejs/server
[5]: https://badgen.net/badge/icon/Buy%20Me%20A%20Tea/orange?icon=kofi&label
[6]: https://www.buymeacoffee.com/lauriro


LiteJS Server &ndash; [![Coverage][1]][2] [![Size][3]][4] [![Buy Me A Tea][5]][6]
=============

A small, zero-dependency HTTP application core that runs the same code across
local runtimes (Bun, Deno, Node.js, txiki.js),
cloud providers (Cloudflare Workers, Deno Deploy, Netlify, Vercel),
and browser service workers.

## Usage

`npm install @litejs/server`

```javascript
// server.mjs
import { App, Server } from "@litejs/server"

const app = App()

// Middleware runs only when a route matches
app.use((req, env) => {
	// Return a response to stop further execution
})

// Write route paths without leading or trailing `/`
// Only the first matching route is executed
app.get("hello/world", (req, env) => "Hello MOON!")
app.get("hello/{name}", (req, env) => "Hello " + req.param.name)
app.get("bye/{name}", (req, env) => "Bye " + req.param.name)
app.get("bye/moon", (req, env) => { /* Never executed because the previous handler matches */ })
app.get("teapot", (req) => (req.resStatus = 418, "no coffee"))
app.get("notFound", () => 404) // Return a number to send a status code

// Group routes and mount them under a prefix, also without leading or trailing `/`
const subApp = App()
.post("", (req, env) => {
    // POST /api -> req.path == "/" and req.fullPath == "/api"
    return { data: [] }
})
.post("echo", async (req, env) => {
    // POST /api/echo -> req.path == "/echo" and req.fullPath == "/api/echo"
    return await req.json()
})

app.mount("api", subApp)

// A common entry point that handles runtime differences.
// On Cloudflare and Vercel, it returns `{ fetch }`; on Netlify, the handler itself;
// on Node.js, Bun, Deno, and txiki.js, it starts the server.
export default Server(app)
```

Handlers receive `(req, env, ctx)` and may return
a native `Response`,
a number (status only),
an object or array (serialized to JSON),
or any value accepted as the body of a new `Response`.

Set the status with `req.resStatus = 409` and add headers with `req.resHeaders.allow = "GET, PUT"`.
Thrown errors map to `err.code || 500`; 5xx bodies are kept generic.

Requests include `param`, `path`, `fullPath`, `query`, `searchParams`, and `header(name)`.
Routes match against `path`, the raw, percent-encoded pathname;
`fullPath` and `param` values are decoded.

### Routes

 - `user/{username}` matches one path segment (no `/`)
 - `post/{id+}` matches one or more digits
 - `files/{rest*}.ext` greedily matches all characters
 - `a/{dir/}{name}` matches zero or more slash-terminated directories
 - `pub/\{x}` matches the literal path `pub/{x}`


### Runtime environments

More complex setups require manually configured environments.
For example, `env.KV` is provided natively on Cloudflare but must be configured for local runtimes.

Runtime-specific environments can be selected in several ways.
One option is to use a separate entry file for each runtime.
Another is to use conditional imports in `package.json`, allowing runtimes to share an entry point:

```json
{
  "imports": {
    "#env": {
      "workerd": "./env/workerd.mjs",
      "default": "./env/local.mjs"
    }
  }
}
```

Configure `ASSETS` and `KV` bindings in `wrangler.jsonc` for Cloudflare.
On local runtimes, `serveStatic` provides `ASSETS`, while a SQLite-backed shim provides `KV`.

```javascript
// env/workerd.mjs
export { env } from "cloudflare:workers"
```

```javascript
// env/local.mjs
import { DB, KV, serveStatic } from "@litejs/server"
var db = new DB(":memory:")
, env = {
	ASSETS: serveStatic("public"),
	KV: KV(db, "kv"),
}
export { env }
```

The same server entry point runs on Cloudflare, Bun, Deno, Node.js, and txiki.js:

```javascript
// server.mjs
import { Server } from "@litejs/server"
import { env } from "#env"
import { app } from "./app.mjs"

export default Server(app, env)
```


Runnable examples are in [`demo/`](demo/) and [`test/server/`](test/server/).

> Copyright (c) 2026 Lauri Rooden &lt;lauri@rooden.ee&gt;  
[MIT License](https://litejs.com/MIT-LICENSE.txt) |
[GitHub repo](https://github.com/litejs/server) |
[npm package](https://npmjs.org/package/@litejs/server) |
[Buy Me A Tea][6]

