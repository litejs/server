# Plain workerd (no wrangler) serving the same app as wrangler.jsonc:
#   npm run run:workerd
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
	services = [
		(name = "main", worker = .mainWorker),
		(name = "kv", worker = .kvWorker),
		(name = "r2", worker = .r2Worker),
		(name = "assets", disk = (path = "public")),
		(name = "do-storage", disk = (path = "build/do", writable = true)),
	],
	sockets = [(name = "http", address = "127.0.0.1:8081", http = (), service = "main")],
);

const mainWorker :Workerd.Worker = (
	modules = [(name = "main", esModule = embed "build/workerd.mjs")],
	compatibilityDate = "2025-09-27",
	durableObjectNamespaces = [(className = "Counter", uniqueKey = "litejs-e2e-counter", enableSql = true)],
	durableObjectStorage = (localDisk = "do-storage"),
	bindings = [
		(name = "KV", kvNamespace = "kv"),
		(name = "R2", r2Bucket = "r2"),
		(name = "COUNTER", durableObjectNamespace = "Counter"),
		(name = "ASSETS", service = "assets"),
		(name = "S3_AWS_ID", fromEnvironment = "S3_AWS_ID"),
		(name = "S3_AWS_SECRET", fromEnvironment = "S3_AWS_SECRET"),
	],
);

const kvWorker :Workerd.Worker = (
	modules = [(name = "kv", esModule = embed "workerd-kv.mjs")],
	compatibilityDate = "2025-09-27",
);

const r2Worker :Workerd.Worker = (
	modules = [(name = "r2", esModule = embed "workerd-r2.mjs")],
	compatibilityDate = "2025-09-27",
);
