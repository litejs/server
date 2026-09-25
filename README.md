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
cloud providers (Cloudflare Workers, Deno Deploy, Fastly, Neon, Netlify, Vercel),
and browser service workers.

## Usage

`npm install @litejs/server`

```javascript
// server.mjs
import { App, Server } from "@litejs/server"

const app = App()

// Routes and middleware run in registration order
// Only middleware registered before the matching route runs
// Without a matching route, no middleware runs
app.use((req, env) => {
    // Return a truthy response to stop further execution
})

// Write route paths without leading or trailing `/`
// Only the first matching route is executed
app.get("hello/world", (req, env) => "Hello MOON!")
app.get("hello/{name}", (req, env) => "Hello " + req.param.name)
app.get("bye/{name}", (req, env) => "Bye " + req.param.name)
app.get("bye/moon", (req, env) => { /* Never executed because the previous handler matches */ })
app.get("teapot", (req) => (req.resStatus = 418, "no coffee"))
app.get("notFound", () => 404) // Return a number to send a status code

// Middleware does not accept a path; add it to a sub-app to scope it to the mount prefix.
// Mount the sub-app under a prefix written without leading or trailing `/`.
const subApp = App()
.use(auth)
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
Defer work to be executed after a response is handled with `req.defer(fn)`;
it runs through `ctx.waitUntil`, so a Worker stays alive for it.

Requests include `param`, `path`, `fullPath`, `query` and `searchParams`.
Routes match against `path`, the raw, percent-encoded pathname;
`fullPath` and `param` values are decoded.

### Routes

 - `user/{username}` matches one path segment (no `/`)
 - `post/{id+}` matches one or more digits
 - `files/{rest*}.ext` greedily matches all characters
 - `a/{dir/}{name}` matches zero or more slash-terminated directories
 - `pub/\{x}` matches the literal path `pub/{x}`


### Request body

Parse `application/json`, `application/x-www-form-urlencoded` and `multipart/form-data` into object, with `a[]=1&b[c]=2` syntax.
Multipart is streamed from req.body.

```javascript
import { content } from "@litejs/server"

app.post("upload", async (req, env) => {
    // Each file arrives as a File, capped by maxFileSize; a Blob carries its length, which R2 put needs
    const { title, file } = await content(req)
    await env.BUCKET.put(file.name, file, { httpMetadata: { contentType: file.type } })
    return { title, key: file.name }
})
```

To keep a large file out of memory, handle the part yourself:
`content(req, { file: part => upload(part.body).then(() => part.filename) })`.
The handler runs for each file part in order and its return value takes the file's place in the body.
A part has `name`, `filename`, `type` and `body`,
a `ReadableStream` that must be consumed before the next part is read;
what a handler leaves unread is dropped.
Limits `maxBodySize`, `maxFields`, `maxFieldSize`, `maxFiles` and `maxFileSize` throw a `413`,
an unknown type a `415`.
More types go in `accept`, an `accept()` rule to parser map merged over the built-in ones:
`{ accept: { "text/csv;header=": (str, negod) => ... } }`.


### Authentication

`basic` and `digest` check an `Authorization` header against a stored HA1, `sha256(user:realm:pass)`, and return the user name.
HA1 is a secret! It allow to log in without a password; encrypt it at rest if the store needs that.

`Oauth({ providers, onProfile })` runs the authorization-code flow for a map of `{ auth, token, user, iss? }` URLs
and hands `onProfile` the profile with the window id from `state`;
`env.SIGN_KEY` signs the Digest `nonce` and the OAuth `state`, and each provider needs `env.{NAME}_ID` and `env.{NAME}_SECRET`.

```javascript
import { App, basic, header } from "@litejs/server"

const users = (env, name) => env.USERS.get(name)
const api = App()

// A failed check gets a plain `401`, add `WWW-Authenticate` header to trigger browser's log in dialog
api.use(async (req, env) => !(req.user = await basic(req, env, header(req, "authorization"), users)) && 401)
api.get("me", req => ({ user: req.user }))
```


### WebSockets

On Bun, Deno, Node.js, txiki.js, Cloudflare, and Neon
`WebSocketServer(protocols, next?)` upgrades req to first matching protocol, `''` for no-protocol.
Each protocol holds optional listeners
`{ open(soc, req, env, ctx), message(soc, data, env, ctx), close(soc, code, reason, env, ctx), error(socket, error, env, ctx) }`
and the socket has `send()`, `close()` and `readyState`.
Fastly, Netlify and Vercel throw on an upgrade.
Cloudflare persist `soc.state` on Durable Object sleep.

```javascript
// Accept WebSockets on one route
app.get("ws", WebSocketServer({
    echo: { message: (soc, data) => soc.send(data) }
}, () => 426))
```

`WebSocketDO` holds sockets in a Durable Object, tagged by protocol:

```javascript
export class Room extends WebSocketDO {
    static ws = {
        chat: { message: (soc, data, env, ctx) => ctx.getWebSockets("chat").forEach(peer => peer !== soc && peer.send(data)) }
    }
    static app = App().get("/", (req, env, ctx) => ({ peers: ctx.getWebSockets().length }))
}

app.get("room/{name}", (req, env) => env.ROOM.getByName(req.param.name).fetch(req))
```

`WebSocketClient(url, protocol, map, { delay, env, ctx })` connects with the same map,
queues `send` until open and reconnects after a random `delay`, `[10000, 30000]` ms by default.



### Runtime environments

Handlers receive `env` as their second argument.
On Cloudflare it is the platform env with the bindings, elsewhere it is a plain object you must fill.

For example, Cloudflare provided `env.ASSETS` and `env.KV` needs a shim locally.
Keep that wiring in a conditional import in `package.json`, so every runtime shares the entry point:

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

`env/workerd.mjs` may be an empty file if no custom env needed.

```javascript
// env/workerd.mjs
import { env } from "@litejs/server"
// Add custom env value to use later
env.RUNTIME = "Cloudflare"
```

The local file appends `.env.json` and the process environment with `loadEnv()`,
then adds what the platform would have bound:

```javascript
// env/local.mjs
import { DB, KV, env, loadEnv, serveStatic } from "@litejs/server"

loadEnv(".env.json")
env.ASSETS = serveStatic("public")
env.KV = KV(new DB(env.DB_PATH || ":memory:"), "kv")
env.RUNTIME = "local"
```

Call `loadEnv()` to read the process environment alone.
The same server entry point then runs on Cloudflare, Bun, Deno, Node.js, and txiki.js:

```javascript
// server.mjs
import { Server } from "@litejs/server"
import "#env"
import { app } from "./app.mjs"

export default Server(app)
```


Runnable examples are in [`demo/`](demo/) and [`test/server/`](test/server/).

> Copyright (c) 2026 Lauri Rooden &lt;lauri@rooden.ee&gt;  
[MIT License](https://litejs.com/MIT-LICENSE.txt) |
[GitHub repo](https://github.com/litejs/server) |
[npm package](https://npmjs.org/package/@litejs/server) |
[Buy Me A Tea][6]

