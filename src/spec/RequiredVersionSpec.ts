import { expect } from 'chai';
import { RequiredVersion } from '../PkgConfig';

function parse(s: string): RequiredVersion {
	return RequiredVersion.fromUserArg(s);
}

function fail(s: unknown, match: RegExp): void {
	let failed = false;

	try {
		RequiredVersion.fromUserArg(s);
	} catch (ex) {
		expect(ex.message).to.match(match);
		failed = true;
	}

	expect(
		failed,
		`Expected '${s}' to throw while parsing, but it successfully parsed`,
	).to.be.true;
}

describe('RequiredVersion parsing', () => {
	it('parses a standalone module name', () => {
		const v = parse('name');
		expect(v.name).to.equal('name');
	});

	it('trims whitespace around the name', () => {
		const v = parse('\t\v\f  \nname  \f ');
		expect(v.name).to.equal('name');
	});

	it('is part of the name until a space', () => {
		const v = parse('less=more');
		expect(v.name).to.equal('less=more');
	});

	it('parses =', () => {
		const v = parse('less = more');
		expect(v.comparison).to.equal('=');
	});

	it('parses !=', () => {
		const v = parse('less != more');
		expect(v.comparison).to.equal('!=');
	});

	it('parses <', () => {
		const v = parse('less < more');
		expect(v.comparison).to.equal('<');
	});

	it('parses <=', () => {
		const v = parse('less <= more');
		expect(v.comparison).to.equal('<=');
	});

	it('parses >=', () => {
		const v = parse('less >= more');
		expect(v.comparison).to.equal('>=');
	});

	it('parses >', () => {
		const v = parse('less > more');
		expect(v.comparison).to.equal('>');
	});

	it('handles space between pieces', () => {
		const v = parse(' a.b.c \t\n\f\v=   \n\n\n1.2.3  \t');
		expect(v.name).to.equal('a.b.c');
		expect(v.comparison).to.equal('=');
		expect(v.version).to.equal('1.2.3');
	});

	it('does not have any escape mechanism', () => {
		const v = parse('foo\\ = 1.2');
		expect(v.name).to.equal('foo\\');
	});

	it('fails when given a number', () => {
		fail(42, /Package name is not a string/);
	});

	it('fails if no name', () => {
		fail('', /No package name found/);
	});

	it('fails with invalid operator', () => {
		fail('foo == 1.2.3', /Invalid comparison operator '=='/);
	});

	it('fails with operator and no version', () => {
		fail('foo = ', /Expected format <name> \[<op> <version>\]/);
	});

	it('fails with too many tokens', () => {
		fail('foo = hello world', /Expected format <name> \[<op> <version>\]/);
	});
});
