import { expect } from 'chai';
import { gShellParseArgv, gShellUnquote } from '../gShell';

// main goal is to hit the edge cases that don't seem
// feasible with normal pkg-config workflows. You might
// ask why they should still be tested/implemented. It's
// a fair point, but if something like variable substitution
// overriding came into place, then things like '\n' in the
// line might become possible, whereas the current
// implementation avoids it. Easy enough to be thorough and
// test this.
describe('gShellParseArgv', () => {
	it('parses newlines as tokens', () => {
		const { argv, error } = gShellParseArgv('hello\nworld');
		expect(argv).to.deep.equal(['hello', 'world']);
		expect(!!error).to.be.false;
	});
});

describe('gShellUnquote', () => {
	it('returns unquoted text as is', () => {
		const { result, error } = gShellUnquote('hello');
		expect(result).to.equal('hello');
		expect(error).to.be.undefined;
	});

	it('returns error with unmatched quote', () => {
		const { result, error } = gShellUnquote('"hello');
		expect(result).to.equal('');
		expect(error).to.match(
			/Unmatched quotation mark in command line or other shell-quoted text/,
		);
	});
});
