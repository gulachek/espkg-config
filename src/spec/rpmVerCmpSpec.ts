import { rpmVerCmp } from '../PkgConfig';
import { expect } from 'chai';

function lt(a: string, b: string): void {
	expect(rpmVerCmp(a, b)).to.be.lessThan(0);
}

function eq(a: string, b: string): void {
	expect(rpmVerCmp(a, b)).to.equal(0);
}

function gt(a: string, b: string): void {
	expect(rpmVerCmp(a, b)).to.be.greaterThan(0);
}

/* went through all of these to verify. for example
 * (lldb) expr rpmvercmp("","")
 * (int) $0 = 0
 * (lldb) expr rpmvercmp("&*(",")*$")
 * (int) $1 = 0
 */
describe('rpmVerCmp', () => {
	it('treats two empty strings as eq', () => {
		eq('', '');
	});

	it('equal length non alphanum is equal', () => {
		eq('&*(', ')*&');
	});

	it('smaller non alphanum is still equal', () => {
		eq('*(', '(**');
	});

	it('non-alphanum followed by alphanum is greater', () => {
		gt('**a', '***');
		lt('***', '**a');
	});

	it('treats a number as greater than alpha', () => {
		gt('1', 'zzz');
		gt('1', 'ZZZ');
		lt('zzz', '1');
		lt('ZZZ', '1');
	});

	it('strips leading 0s on numbers', () => {
		eq('0010', '10');
		eq('0010', '00010');
		gt('2', '01');
		lt('00000000001', '10');
	});

	it('treats longer number as greater', () => {
		gt('1111111', '2');
		lt('3', '111');
	});

	it('compares strings lexically', () => {
		lt('abcd', 'bcde');
		lt('abcd', 'z');
		gt('abc', 'XYZ');
	});

	it('splits over non alphanumerics', () => {
		eq('abc.0012', 'abc.12');
		eq('abc.0012', 'abc**12');
	});

	it('splits over change from number to alpha', () => {
		eq('123abc', '0000123abc');
	});
});
