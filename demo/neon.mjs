
export default {
	buckets: { "litejs-test": { access: "private" } },
	functions: { api: { name: "litejs-server-demo", source: "./build/neon/index.mjs" } },
}

