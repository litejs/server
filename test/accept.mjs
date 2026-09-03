import '@litejs/cli/test.js'
import { accept } from '../index.mjs'

describe('accept', () => {
	function handleLargeHeader(nego) {
		// Test against a roughly 110 KB pathological header.
		var str = new Array(5000).join(', ab/cde;header=absent')
		, start = performance.now()
		nego(str)
		return performance.now() - start < 100
	}

	test('negotiates media types and parameters', assert => {
		var nego = accept([
			'*/json',
			'*/xhtml+*',
			'*/*+xml; a=',
			'text/csv;header=absent;delimiter=",";NULL="";br="\r\n"',
			'application/sql; table=table',
			'bar; title=',
			'*/*',
		])

		assert
		.strictEqual(nego('a'), null)
		.equal(nego('application/xml'), {
			match: 'application/xml',
			q: 1,
			rule: '*/*',
			type: 'application',
			subtype: 'xml',
			suffix: '',
		})
		.equal(nego('application/xaml+xml'), {
			match: 'application/xaml+xml',
			q: 1,
			rule: '*/*+xml',
			type: 'application',
			subtype: 'xaml',
			suffix: 'xml',
			a: '',
		})
		.equal(nego('text/csv'), {
			match: 'text/csv',
			q: 1,
			rule: 'text/csv',
			type: 'text',
			suffix: '',
			subtype: 'csv',
			header: 'absent',
			delimiter: ',',
			NULL: '',
			br: '\r\n',
		})
		.equal(nego('text/csv;header=present;delimiter=.;q=0.5'), {
			match: 'text/csv',
			q: 0.5,
			rule: 'text/csv',
			type: 'text',
			subtype: 'csv',
			suffix: '',
			header: 'present',
			delimiter: '.',
			NULL: '',
			br: '\r\n',
		})
		.equal(nego('text/csv ; delimiter=",;br=a" ; header=on.%;un=known;br="%0A"'), {
			match: 'text/csv',
			q: 1,
			rule: 'text/csv',
			type: 'text',
			subtype: 'csv',
			suffix: '',
			header: 'on.%',
			delimiter: ',;br=a',
			NULL: '',
			br: '\n',
		})
		.equal(nego('text/csv ;delimiter=""'), {
			match: 'text/csv',
			q: 1,
			rule: 'text/csv',
			type: 'text',
			suffix: '',
			subtype: 'csv',
			header: 'absent',
			delimiter: '',
			NULL: '',
			br: '\r\n',
		})
		.equal(nego('ab/cd;q=0.2, application/sql+xhtml, foo/xhtml+bar'), {
			match: 'foo/xhtml+bar',
			q: 1,
			rule: '*/xhtml+*',
			type: 'foo',
			subtype: 'xhtml',
			suffix: 'bar',
		})
		// Non-extended notation using quoted-string.
		.equal(nego('bar; title="US-$ rates"'), {
			rule: 'bar',
			match: 'bar',
			q: 1,
			title: 'US-$ rates',
		})
		// Extended notation using the Unicode character U+00A3 ("£").
		.equal(nego("bar; title*=utf-8'en'%C2%A3%20rates"), {
			rule: 'bar',
			match: 'bar',
			q: 1,
			title: '£ rates',
		})
		// Extended notation takes precedence over a plain parameter.
		.equal(nego("bar; title=\"EURO exchange rates\"; title*=UTF-8''%c2%a3%20and%20%e2%82%ac%20rates"), {
			rule: 'bar',
			match: 'bar',
			q: 1,
			title: '£ and € rates',
		})


		var map = {
			'*/json;br="\r\n"': function cb1() {},
			'*/*': function() {},
		}
		, nego2 = accept(map)

		assert.equal(nego2('application/xml'), {rule:'*/*',o:map['*/*'],q:1,match:'application/xml',type:'application',subtype:'xml',suffix:''})
		assert.equal(nego2('application/json'), {
			rule: '*/json',
			match: 'application/json',
			o: map['*/json;br="\r\n"'],
			type: 'application',
			subtype: 'json',
			suffix: '',
			q: 1,
			br: '\r\n',
		}).end()
	})

	test('negotiates charsets', assert => {
		var nego = accept('utf-8,iso-8859-15')

		assert
		.equal(nego('utf-8, iso-8859-1;q=0.5, *;q=0.1'), {
			rule: 'utf-8',
			match: 'utf-8',
			q: 1,
		})
		.equal(nego('ISO-8859-15;q=0.5, *;q=0.1'), {
			rule: 'iso-8859-15',
			match: 'ISO-8859-15',
			q: 0.5,
		})
		.equal(nego('iso,iso-123;q=0.5, *;q=0.1'), {
			rule: 'utf-8',
			match: '*',
			q: 0.1,
		})
		.ok(handleLargeHeader(nego))
		.end()
	})

	test('honors request quality factors and empty input', assert => {
		var nego = accept('gzip;q=0.5,br')
		, nego1 = accept('')
		, nego2 = accept([])
		, nego3 = accept({})
		, nego4 = accept(' gzip;q=0.5 , br ')

		assert
		// Surrounding whitespace is trimmed off the rules.
		.equal(nego4('br'), { rule: 'br', match: 'br', q: 1 })
		.equal(nego4('gzip;q=0.8'), { rule: 'gzip', match: 'gzip', q: 0.8 })
		.equal(nego('gzip, br').match, 'gzip', 'choice-side q is ignored')
		.equal(nego('br, gzip').match, 'br')
		.equal(nego('gzip'), {
			rule: 'gzip',
			match: 'gzip',
			q: 1,
		})
		.equal(nego('gzip\t;\tq=0.8'), {
			rule: 'gzip',
			match: 'gzip',
			q: 0.8,
		})
		.strictEqual(nego('//////'), null)
		.strictEqual(nego('gzip;q=0'), null)
		.strictEqual(nego(), null)
		.strictEqual(nego(''), null)
		.strictEqual(nego1('gzip'), null)
		.strictEqual(nego2('gzip'), null)
		.strictEqual(nego3('gzip'), null)
		.end()
	})
})
