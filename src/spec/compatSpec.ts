import { expect } from 'chai';
import { resolve, delimiter } from 'node:path';
import { SpawnOptions, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { PkgConfig } from '../index';

describe('pkg-config', () => {
	let exe: PkgExe;
	let pkg: PkgConfig;

	beforeEach(() => {
		const dirs = ['test', 'test/d1', 'test/d2'].map((s) => resolve(s));

		exe = new PkgExe();
		exe.searchPaths.push(...dirs);

		pkg = new PkgConfig({
			searchPaths: dirs,
		});
	});

	async function expectCflags(
		names: string[],
		cflags: string[],
	): Promise<void> {
		const proof = await exe.cflags(names);
		const actual = await pkg.cflags(names);
		expect(cflags).to.deep.equal(
			proof,
			'The given cflags did not match the reference pkg-config behavior',
		);
		expect(actual).to.deep.equal(
			cflags,
			'The PkgConfig implementation did not match the expected cflags',
		);
	}

	describe('cflags', () => {
		async function expectFailure(
			names: string[],
			msgs: ErrorMatch,
		): Promise<void> {
			let exeFail = true,
				pkgFail = true;

			const { ref, self } = errMatchers(msgs);

			try {
				await exe.cflags(names);
				exeFail = false;
			} catch (ex) {
				expect(ex.message).to.match(
					ref,
					`Reference pkg-config behavior did not exit with expected error. Text:\n${ex.message}`,
				);
			}

			try {
				await pkg.cflags(names);
				pkgFail = false;
			} catch (ex) {
				expect(ex.message).to.match(
					self,
					`PkgConfig implementation did not throw expected error. Text:\n${ex.message}`,
				);
			}

			expect(
				exeFail,
				'Expected reference pkg-config behavior to exit with an error, but it exited successfully.',
			).to.be.true;

			expect(
				pkgFail,
				'Expected PkgConfig implementation to throw, but returned successfully.',
			).to.be.true;
		}

		it('gets basic flags from pc file', async () => {
			await expectCflags(['cflags-abc'], ['-a', '-b', '-c']);
		});

		it('expands variables to flags', async () => {
			await expectCflags(
				['cflags-expand'],
				['--hello', '--world', '${myvar}', '--hello', '--world'],
			);
		});

		it('includes cflags from required modules', async () => {
			await expectCflags(['req-abc'], ['-a', '-b', '-c']);
		});

		it('includes cflags from private required modules', async () => {
			await expectCflags(
				['req-pubpriv'],
				[
					'-DREQ_PUBPRIV',
					'-DPRIVATE',
					'-DPUBLIC',
					'-I/include/pubpriv',
					'-I/include/private',
					'-I/include/public',
				],
			);
		});

		it('sorts "include" flags after "other" flags', async () => {
			await expectCflags(
				['cflags-i-other'],
				[
					'--other', // this was the last option in the file
					'-I  include/dir',
					'-isystem',
					'isystem/option',
					'-idirafter',
					'idirafter/option',
				],
			);
		});

		it('deduplicates consecutive identical flags after sorting "include"/"other"', async () => {
			await expectCflags(
				['cflags-i-other', 'cflags-other-i'],
				[
					'--other',
					'-I  include/dir',
					'-isystem',
					'isystem/option',
					'-idirafter',
					'idirafter/option',
					'-I include/dir',
					'-isystem',
					'isystem/option',
					'-idirafter',
					'idirafter/option',
				],
			);
		});

		it('treats -isystem as "other" if no successive option is given', async () => {
			await expectCflags(
				['cflags-isystem-last'],
				['--other', '-isystem', '-Iinclude'],
			);
		});

		it('treats -idirafter as "other" if no successive option is given', async () => {
			await expectCflags(
				['cflags-idirafter-last'],
				['--other', '-idirafter', '-Iinclude'],
			);
		});

		it('is an empty array when cflags is empty', async () => {
			await expectCflags(['cflags-empty'], []);
		});

		it('finds a module identified by filename', async () => {
			await expectCflags(['test/cflags-abc.pc'], ['-a', '-b', '-c']);
		});

		it('strips comments from flags', async () => {
			await expectCflags(['cflags-comment'], ['--no-comment']);
		});

		it('fails if the first character in cflags is escaped #', async () => {
			await expectFailure(
				['bad-cflags-begin-esc-comment'],
				/Couldn't parse Cflags[a-z ]+: Text was empty/,
			);
		});

		it('has empty cflags if it begins with \\<space>\\#', async () => {
			await expectCflags(['cflags-begin-esc-space-comment'], []);
		});

		it('fails if it has unmatched quotes', async () => {
			await expectFailure(
				['bad-cflags-unmatched-quote'],
				/Couldn't parse Cflags[a-z ]+: Text ended before matching quote/,
			);
		});

		it('accepts CFlags as well (normally Cflags)', async () => {
			await expectCflags(['cflags-capital-f'], ['CFlags']);
		});

		it('is case sensitive for Cflags/CFlags', async () => {
			await expectCflags(['cflags-all-caps'], []);
		});

		it('looks up a <module>-uninstalled variant and reads its cflags', async () => {
			await expectCflags(['removed'], ['--i-am-uninstalled']);
		});

		it('fails if Cflags ends with backslash as last byte of file', async () => {
			await expectFailure(['cflags-lingering-backslash'], {
				ref: /Couldn't parse Cflags[a-z ]+: Text ended just after a “\\”/,
				self: /Couldn't parse Cflags[a-z ]+: Text ended just after a '\\'/,
			});
		});

		it('fails if multiple CFlags fields are present', async () => {
			await expectFailure(
				['bad-multi-cflags'],
				/Cflags field occurs (\w+ )+in '.+bad-multi-cflags.pc'/,
			);
		});

		it('ok if multiple leading cflags fields are defined and empty', async () => {
			await expectCflags(['cflags-multi-empty-ok'], ['--nonempty']);
		});

		it("fails if module doesn't exist", async () => {
			await expectFailure(['does-not-exist'], {
				ref: /Package does-not-exist was not found in the pkg-config search path/,
				self: /Package "does-not-exist" was not found in the PkgConfig searchPath/,
			});
		});

		// TODO is this breaking change? Is it ok to not go through shell eval? Expansion etc
		it('handles many escape chars in pkg file', async () => {
			await expectCflags(
				['cflags-shell-esc'],
				[
					'-a b',
					'hello#world',
					'--line-feed',
					'--carriage-return',
					'--crlf',
					'--lfcr',
					'--single quote\\',
					'--double "quote',
					'--escape\\ space',
				],
			);
		});

		it('does not repeat flags for a repeated module', async () => {
			await expectCflags(['cflags-abc', 'cflags-abc'], ['-a', '-b', '-c']);
		});

		/**
		 * Confusing behavior:
		 *
		 * Internally, pkg-config seems to attempt to avoid duplicative parsing
		 * by keeping a hash table of key -> pkg mappings. The key ends up being
		 * the specified module name (like 'module') or the basename of an
		 * explicit file (like 'module' in '/dir/module.pc'). There seems to be
		 * odd behavior where the raw given name is looked up prior to computing
		 * the basename though, meaning that a filename will never end up in the
		 * hash table keys, but it will override whatever was previously there.
		 *
		 * pkg-config also then combines all modules together in reverse order,
		 * deduplicating by key, so the last loaded module with the key wins.
		 *
		 * Practically this seems to mean that the last filename wins
		 */
		describe('prefers the last specified filename', () => {
			it('with filename second', async () => {
				await expectCflags(
					['overloaded', 'test/subdir/overloaded.pc'],
					['--subdir-flags'],
				);
			});

			it('with filename first', async () => {
				await expectCflags(
					['test/subdir/overloaded.pc', 'overloaded'],
					['--subdir-flags'],
				);
			});

			it('with two filenames one way', async () => {
				await expectCflags(
					['test/subdir/overloaded.pc', 'test/overloaded.pc'],
					['--default-flags'],
				);
			});

			it('with two filenames the other way', async () => {
				await expectCflags(
					['test/overloaded.pc', 'test/subdir/overloaded.pc'],
					['--subdir-flags'],
				);
			});
		});

		it('sorts CFLAGS_I in search path order and CFLAGS_OTHER in given order', async () => {
			await expectCflags(
				['mod2', 'mod1'],
				[
					'--other2',
					'--another2',
					'--other1',
					'--another1',
					'-Iinclude/d1',
					'-isystem',
					's1',
					'-Iinclude/d2',
					'-isystem',
					's2',
				],
			);
		});

		it('treats direct filename as earlier path order than module resolution', async () => {
			await expectCflags(
				['cflags-i-other', 'test/d1/mod1.pc'],
				[
					'--other',
					'--other1',
					'--another1',
					'-Iinclude/d1',
					'-isystem',
					's1',
					'-I  include/dir',
					'-isystem',
					'isystem/option',
					'-idirafter',
					'idirafter/option',
				],
			);
		});

		it('fails if package has duplicate name', async () => {
			await expectFailure(
				['bad-dup-name'],
				/Name field occurs [a-z ]+in '.*bad-dup-name.pc'/,
			);
		});

		it('fails if package has no name', async () => {
			await expectFailure(
				['bad-no-name'],
				/Package 'bad-no-name' has no Name: field/,
			);
		});

		it('fails if package has duplicate version', async () => {
			await expectFailure(
				['bad-dup-version'],
				/Version field occurs [a-z ]+in '.*bad-dup-version.pc'/,
			);
		});

		it('fails if package has no version', async () => {
			await expectFailure(
				['bad-no-version'],
				/Package 'bad-no-version' has no Version: field/,
			);
		});

		it('fails if package has duplicate description', async () => {
			await expectFailure(
				['bad-dup-desc'],
				/Description field occurs [a-z ]+in '.*bad-dup-desc.pc'/,
			);
		});

		it('fails if package has no description', async () => {
			await expectFailure(
				['bad-no-desc'],
				/Package 'bad-no-desc' has no Description: field/,
			);
		});

		it('fails if variable is defined twice', async () => {
			await expectFailure(
				['bad-dup-var'],
				/Duplicate definition of variable 'myvar' in '.*bad-dup-var.pc'/,
			);
		});

		it('fails if variable used but not defined', async () => {
			await expectFailure(
				['bad-undef-var'],
				/Variable 'undef' not defined in '.*bad-undef-var.pc'/,
			);
		});
	});
});

class PkgExe {
	exe: string;
	searchPaths: string[] = [];

	constructor() {
		this.exe = resolve('pkg-config/pkg-config');
	}

	private async spawn(args: string[]): Promise<string> {
		return spawnAsync(this.exe, args, {
			env: {
				PKG_CONFIG_PATH: this.searchPaths.join(delimiter),
			},
		});
	}

	async cflags(names: string[]): Promise<string[]> {
		const pkgOut = await this.spawn(['--cflags', ...names]);
		return shellSplitWords(pkgOut);
	}
}

interface Resolvers<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(err: Error): void;
}

function withResolvers<T>(): Resolvers<T> {
	let resolve: (val: T) => void;
	let reject: (err: Error) => void;

	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

function readStream(stream: Readable): Promise<string> {
	const chunks: Uint8Array[] = [];
	const { resolve, reject, promise } = withResolvers<string>();
	stream.on('data', (chunk) => {
		chunks.push(chunk);
	});
	stream.on('error', (err) => reject(err));
	stream.on('close', () => {
		const totalBuf = Buffer.concat(chunks);
		resolve(totalBuf.toString('utf8'));
	});

	return promise;
}

async function spawnAsync(
	exe: string,
	args: string[],
	opts?: SpawnOptions,
): Promise<string> {
	const proc = spawn(exe, args, opts);
	const stdout = readStream(proc.stdout);
	const stderr = readStream(proc.stderr);

	const procExit = new Promise<number>((res, rej) => {
		proc.on('exit', (code) => res(code));
		proc.on('error', (err) => rej(err));
	});

	const code = await procExit;
	if (code === 0) {
		return stdout;
	} else {
		const errStr = await stderr;
		throw new Error(
			`Process "${exe}" exited with status '${code}':\n${errStr}`,
		);
	}
}

async function shellSplitWords(words: string): Promise<string[]> {
	const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)));';
	const jsonWords = await spawnAsync('/bin/sh', [
		'-c',
		`node -e '${script}' -- ${words}`,
	]);
	return JSON.parse(jsonWords) as string[];
}

interface ErrorMatchObj {
	ref: RegExp;
	self: RegExp;
}

type ErrorMatch = RegExp | ErrorMatchObj;

function isErrMatchObj(obj: unknown): obj is ErrorMatchObj {
	return (
		typeof obj === 'object' &&
		obj.hasOwnProperty('self') &&
		obj.hasOwnProperty('ref')
	);
}

function errMatchers(match: ErrorMatch): ErrorMatchObj {
	if (isErrMatchObj(match)) return match;

	return { ref: match, self: match };
}
