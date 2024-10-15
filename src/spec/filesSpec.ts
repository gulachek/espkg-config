import { expect } from 'chai';
import { FileStream } from '../files';

// only unit test cases not covered by main tests
// ideally they're edge cases that seem responsible to
// program against but don't seem possible to hit in real life
// which should be rare

describe('FileStream', () => {
	it('throws an error if ungetc is given wrong char', async () => {
		const stream = new FileStream(__filename);
		await stream.load();

		const c = stream.getc();
		expect(c).to.equal('i'); // first char of this file

		expect(() => stream.ungetc('m')).to.throw(
			/ungetc\(\): char "m" doesn't match the previously read char at position 1 "i"/,
		);
	});
});
