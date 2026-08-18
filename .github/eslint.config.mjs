export default [{
	files: ['.github/eslint.config.mjs', '*.mjs', 'lib/*.mjs'],
	languageOptions: {
		ecmaVersion: 2021,
		sourceType: 'module',
		globals: {
			addEventListener: 'readonly',
			atob: 'readonly',
			btoa: 'readonly',
			Bun: 'readonly',
			caches: 'readonly',
			clearTimeout: 'readonly',
			clients: 'readonly',
			console: 'readonly',
			crypto: 'readonly',
			Deno: 'readonly',
			fetch: 'readonly',
			Headers: 'readonly',
			process: 'readonly',
			ReadableStream: 'readonly',
			Request: 'readonly',
			Response: 'readonly',
			setInterval: 'readonly',
			setTimeout: 'readonly',
			skipWaiting: 'readonly',
			TextDecoder: 'readonly',
			TextEncoder: 'readonly',
			tjs: 'readonly',
			URL: 'readonly',
			WebSocketPair: 'readonly'
		}
	},
	linterOptions: {
		reportUnusedDisableDirectives: 'error'
	},
	rules: {
		'max-depth': ['error', 6],
		'no-irregular-whitespace': 'error',
		'no-new': 'error',
		'no-undef': 'error',
		'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
		quotes: ['error', 'single', { avoidEscape: true }],
		semi: ['error', 'never']
	}
}]
