import { expect } from 'chai';
import { resolve, delimiter, join } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { SpawnOptions, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { PkgConfig } from '../index';

const dynamicTestDir = resolve('test/.dynamic');

describe('pkg-config', () => {
	let exe: PkgExe;
	let pkg: PkgConfig;

	beforeEach(async () => {
		const dirs = ['test', 'test/d1', 'test/d2'].map((s) => resolve(s));
		dirs.push(dynamicTestDir);

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
		const { flags: actual } = await pkg.cflags(names);
		expect(cflags).to.deep.equal(
			proof,
			'The given cflags did not match the reference pkg-config behavior',
		);
		expect(actual).to.deep.equal(
			cflags,
			'The PkgConfig implementation did not match the expected cflags',
		);
	}

	async function expectLibs(names: string[], libs: string[]): Promise<void> {
		const proof = await exe.libs(names);
		const { flags: actual } = await pkg.libs(names);
		expect(libs).to.deep.equal(
			proof,
			'The given libs did not match the reference pkg-config behavior',
		);
		expect(actual).to.deep.equal(
			libs,
			'The PkgConfig implementation did not match the expected libs',
		);
	}

	async function expectStaticLibs(
		names: string[],
		libs: string[],
	): Promise<void> {
		const proof = await exe.staticLibs(names);
		const { flags: actual } = await pkg.staticLibs(names);
		expect(libs).to.deep.equal(
			proof,
			'The given static libs did not match the reference pkg-config behavior',
		);
		expect(actual).to.deep.equal(
			libs,
			'The PkgConfig implementation did not match the expected static libs',
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

		it('can require multiple modules in the same statement', async () => {
			await expectCflags(
				['req-multiple'],
				['-a', '-b', '-c', '-DPUBLIC', '-I/include/public'],
			);
		});

		it('can require versions from given arguments', async () => {
			await expectCflags(['cflags-abc = 1.2.3'], ['-a', '-b', '-c']);
		});

		it('fails if the given module version is not matched', async () => {
			await expectFailure(
				['cflags-abc < 1.2.3'],
				/Requested 'cflags-abc < 1.2.3' but version of cflags-abc is 1.2.3/,
			);
		});

		it('does not escape spaces in module names', async () => {
			await expectFailure(
				['cflags-abc\\ = 1.2.3'],
				/Package "?cflags-abc\\"? was not found/,
			);
		});

		it('picks up changes to test files', async () => {
			const preamble = 'Name:\nVersion:\nDescription:\n';
			await using t = await DynamicTest.init();
			const pcFile = join(t.d, 'cflags-dynamic.pc');

			await writeFile(pcFile, `${preamble}Cflags: --hello`);
			let { flags: cflags } = await pkg.cflags(['cflags-dynamic']);
			expect(cflags).to.deep.equal(['--hello']);

			await writeFile(pcFile, `${preamble}Cflags: --world`);
			cflags = (await pkg.cflags(['cflags-dynamic'])).flags;
			expect(cflags).to.deep.equal(['--world']);
		});

		it('returns the files that were loaded', async () => {
			const { files } = await pkg.cflags(['req-pubpriv']);
			const f = new Set(files);
			expect(f.has(resolve('test/req-pubpriv.pc'))).to.be.true;
			expect(f.has(resolve('test/public.pc'))).to.be.true;
			expect(f.has(resolve('test/private.pc'))).to.be.true;
			expect(f.size).to.equal(3);
		});

		describe('version operators', () => {
			const flags = ['-DPUBLIC', '-I/include/public'];

			it('=', async () => {
				await expectCflags(['ok-eq'], flags);
			});

			it('!=', async () => {
				await expectCflags(['ok-ne'], flags);
			});

			it('<', async () => {
				await expectCflags(['ok-lt'], flags);
			});

			it('<=', async () => {
				await expectCflags(['ok-lte'], flags);
			});

			it('>', async () => {
				await expectCflags(['ok-gt'], flags);
			});

			it('>=', async () => {
				await expectCflags(['ok-gte'], flags);
			});
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

		it('has a pkg-config virtual package', async () => {
			await expectCflags(['cflags-req-pc'], ['--success']);
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

		it('fails if URL is defined twice', async () => {
			await expectFailure(
				['bad-dup-url'],
				/URL field occurs [\w ]+in '.*bad-dup-url.pc'/,
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

		it('fails if required module has wrong exact version', async () => {
			await expectFailure(
				['bad-req-exact-ver'],
				/Package 'bad-req-exact-ver' requires 'cflags-abc = 1.1.1' but version of cflags-abc is 1.2.3/,
			);
		});

		it("suggests requirement's URL if mismatched version", async () => {
			await expectFailure(
				['bad-req-exact-ver'],
				/You may find new versions of cflags-abc at http:\/\/example.com\/abc/,
			);
		});

		it('Fails if there is a missing Requires entry', async () => {
			await expectFailure(
				['bad-req-missing'],
				/Package 'intentionally-missing', required by 'bad-req-missing', not found/,
			);
		});

		it('Fails if there is a missing Requires.private entry', async () => {
			await expectFailure(
				['bad-priv-req-missing'],
				/Package 'intentionally-missing', required by 'bad-priv-req-missing', not found/,
			);
		});

		it('Fails if Requires has a comparison w/o a version', async () => {
			await expectFailure(
				['bad-req-no-version'],
				/Comparison operator but no version after package name 'cflags-abc' in file '.*bad-req-no-version.pc'/,
			);
		});

		it('Fails if Requires has an empty module name', async () => {
			await expectFailure(
				['bad-req-empty-name'],
				/Empty package name in Requires or Conflicts in file '.*bad-req-empty-name.pc'/,
			);
		});

		it('Fails if Requires has an invalid operator', async () => {
			await expectFailure(
				['bad-req-op'],
				/Unknown version comparison operator '==' after package name 'cflags-abc' in file '.*bad-req-op.pc'/,
			);
		});

		it('Overrides previous Requires field with subsequent Requires field', async () => {
			await expectCflags(['dup-requires-override'], ['-a', '-b', '-c']);
		});

		it('Overrides previous Requires.private field with subsequent Requires.private field', async () => {
			await expectCflags(['dup-requires-private-override'], ['-a', '-b', '-c']);
		});

		it('Fails if duplicate Conflicts field is found', async () => {
			await expectFailure(
				['bad-dup-conflicts'],
				/Conflicts field occurs (twice|multiple times) in '.*bad-dup-conflicts.pc'/,
			);
		});

		it('Allows duplicate Conflicts fields as long as the prior ones were empty', async () => {
			await expectCflags(['dup-empty-conflicts-ok'], ['-Dok']);
		});

		it('Fails if subsequent empty Conflicts field is discovered after nonempty', async () => {
			await expectFailure(
				['bad-dup-empty-conflicts'],
				/Conflicts field occurs (twice|multiple times) in '.*bad-dup-empty-conflicts.pc'/,
			);
		});

		it('Fails if a transitive dependency conflicts with the package', async () => {
			await using t = await DynamicTest.init();

			await t.writePc('conflicts-foo', {
				name: 'Conflicts-Foo',
				version: 'a.b.c',
				conflicts: 'foo >= 1.2.3',
				requires: 'bar',
			});

			await t.writePc('bar', {
				requiresPrivate: 'foo',
			});

			await t.writePc('foo', {
				name: 'Foo',
				version: '1.2.4',
			});

			await expectFailure(
				['conflicts-foo'],
				/Version '?1.2.4'? of foo creates a conflict.\s+\(foo >= 1.2.3 conflicts with conflicts-foo '?a.b.c'?\)/,
			);
		});

		it('succeeds if transitive dependency does not conflict', async () => {
			await using t = await DynamicTest.init();

			await t.writePc('conflicts-foo', {
				name: 'Conflicts-Foo',
				version: 'a.b.c',
				conflicts: 'foo >= 1.2.3',
				requires: 'bar',
			});

			await t.writePc('bar', {
				requiresPrivate: 'foo',
			});

			await t.writePc('foo', {
				name: 'Foo',
				version: '1.2.2',
				cflags: '-Dfoo',
			});

			await expectCflags(['conflicts-foo'], ['-Dfoo']);
		});

		it('does not check for conflicts pulled outside packages transitive tree', async () => {
			await using t = await DynamicTest.init();

			await t.writePc('parent', {
				version: '1',
				requires: 'conflicts-parent',
			});

			await t.writePc('conflicts-parent', {
				conflicts: 'parent',
				cflags: '-Dconflicts-parent',
			});

			await expectCflags(['parent'], ['-Dconflicts-parent']);
		});
	});

	describe('libs', () => {
		async function expectFailure(
			names: string[],
			msgs: ErrorMatch,
		): Promise<void> {
			let exeFail = true,
				pkgFail = true;

			const { ref, self } = errMatchers(msgs);

			try {
				await exe.libs(names);
				exeFail = false;
			} catch (ex) {
				expect(ex.message).to.match(
					ref,
					`Reference pkg-config behavior did not exit with expected error. Text:\n${ex.message}`,
				);
			}

			try {
				await pkg.libs(names);
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

		it('returns the parsed Libs flags', async () => {
			await expectLibs(['libs-abc'], ['-L/usr/local/lib', '-labc']);
		});

		it('includes link flags only from public Requires', async () => {
			await expectLibs(
				['req-pubpriv'],
				['-L/lib/pubpriv', '-L/lib/public', '-lreq', '-lpublic'],
			);
		});

		it('can require versions from given arguments', async () => {
			await expectLibs(['libs-abc = 1.2.3'], ['-L/usr/local/lib', '-labc']);
		});

		it('sorts -L flags before -l and -framework', async () => {
			await expectLibs(
				['libs-sort'],
				[
					'-L/usr/local/lib',
					'-llib',
					'-framework',
					'Foo',
					'--other',
					'-Wl,-framework',
					'Bar',
				],
			);
		});

		it('sorts -L in path order', async () => {
			await expectLibs(
				['mod2', 'mod1'],
				['-Llib/d1', '-Llib/d2', '-l2', '-l1'],
			);
		});

		it('preserves ws in -l and -L', async () => {
			/* It looks like pkg-config tries to not do this, but the
			 * logic that's supposed to normalize the space right away comes
			 * right after the shell escaping function, rendering the space
			 * checks useless
			 */
			await expectLibs(['libs-space'], ['-L /lib', '-l lib']);
		});

		it('returns empty array when Libs is empty', async () => {
			await expectLibs(['libs-empty'], []);
		});

		it('fails with duplicate Libs fields', async () => {
			await expectFailure(
				['bad-dup-libs'],
				/Libs field occurs [a-z ]+in '.*bad-dup-libs.pc'/,
			);
		});

		it("fails if quote isn't terminated", async () => {
			await expectFailure(
				['bad-libs-open-quote'],
				/Couldn't parse Libs field into an argument vector: Text ended before matching quote was found for '/,
			);
		});

		it('picks up changes to test files', async () => {
			const preamble = 'Name:\nVersion:\nDescription:\n';
			await using t = await DynamicTest.init();
			const pcFile = join(t.d, 'libs-dynamic.pc');

			await writeFile(pcFile, `${preamble}Libs: --hello`);
			let { flags: libs } = await pkg.libs(['libs-dynamic']);
			expect(libs).to.deep.equal(['--hello']);

			await writeFile(pcFile, `${preamble}Libs: --world`);
			libs = (await pkg.libs(['libs-dynamic'])).flags;
			expect(libs).to.deep.equal(['--world']);
		});

		it('returns the files that were loaded', async () => {
			const { files } = await pkg.libs(['req-pubpriv']);
			const f = new Set(files);
			expect(f.has(resolve('test/req-pubpriv.pc'))).to.be.true;
			expect(f.has(resolve('test/public.pc'))).to.be.true;
			expect(f.size).to.equal(2);
		});

		it('Fails if a transitive dependency conflicts with the package', async () => {
			await using t = await DynamicTest.init();

			await t.writePc('conflicts-foo', {
				name: 'Conflicts-Foo',
				version: 'a.b.c',
				conflicts: 'foo >= 1.2.3',
				requires: 'bar',
			});

			await t.writePc('bar', {
				requires: 'foo',
			});

			await t.writePc('foo', {
				name: 'Foo',
				version: '1.2.4',
			});

			await expectFailure(
				['conflicts-foo'],
				/Version '?1.2.4'? of foo creates a conflict.\s+\(foo >= 1.2.3 conflicts with conflicts-foo '?a.b.c'?\)/,
			);
		});

		it('Succeeds if conflict is only pulled via Requires.private', async () => {
			await using t = await DynamicTest.init();

			await t.writePc('conflicts-foo', {
				name: 'Conflicts-Foo',
				version: 'a.b.c',
				conflicts: 'foo >= 1.2.3',
				requires: 'bar',
				libs: '-lconflicts-foo',
			});

			await t.writePc('bar', {
				requiresPrivate: 'foo',
			});

			await t.writePc('foo', {
				name: 'Foo',
				version: '1.2.4',
			});

			await expectLibs(['conflicts-foo'], ['-lconflicts-foo']);
		});
	});

	describe('staticLibs', () => {
		async function expectFailure(
			names: string[],
			msgs: ErrorMatch,
		): Promise<void> {
			let exeFail = true,
				pkgFail = true;

			const { ref, self } = errMatchers(msgs);

			try {
				await exe.staticLibs(names);
				exeFail = false;
			} catch (ex) {
				expect(ex.message).to.match(
					ref,
					`Reference pkg-config behavior did not exit with expected error. Text:\n${ex.message}`,
				);
			}

			try {
				await pkg.staticLibs(names);
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

		it('returns the parsed Libs flags', async () => {
			await expectStaticLibs(
				['libs-abc'],
				['-L/usr/local/lib', '-labc', '-lprivate'],
			);
		});

		it("returns the private libs first if they're defined first", async () => {
			await expectStaticLibs(
				['libs-cba'],
				['-L/usr/local/lib', '-lprivate', '-labc'],
			);
		});

		it('fails if Libs.private is defined multiple times', async () => {
			await expectFailure(
				['bad-dup-libs-private'],
				/Libs.private field occurs (twice|multiple times) in '.*bad-dup-libs-private.pc'/,
			);
		});

		it("fails if quote isn't terminated", async () => {
			await expectFailure(
				['bad-libs-private-open-quote'],
				/Couldn't parse Libs.private field into an argument vector: Text ended before matching quote was found for '/,
			);
		});

		it('sorts -L in path order', async () => {
			await expectStaticLibs(
				['mod2', 'mod1'],
				['-Llib/d1', '-Llib/d2', '-l2', '-l1'],
			);
		});

		it('includes link flags from private requirements', async () => {
			await expectStaticLibs(
				['req-pubpriv'],
				[
					'-L/lib/pubpriv',
					'-L/lib/private',
					'-L/lib/public',
					'-lreq',
					'-lprivate',
					'-lpublic',
				],
			);
		});

		it('picks up changes to test files', async () => {
			const preamble = 'Name:\nVersion:\nDescription:\n';
			await using t = await DynamicTest.init();
			const pcFile = join(t.d, 'libs-dynamic.pc');

			await writeFile(pcFile, `${preamble}Libs.private: --hello`);
			let { flags: libs } = await pkg.staticLibs(['libs-dynamic']);
			expect(libs).to.deep.equal(['--hello']);

			await writeFile(pcFile, `${preamble}Libs.private: --world`);
			libs = (await pkg.staticLibs(['libs-dynamic'])).flags;
			expect(libs).to.deep.equal(['--world']);
		});

		it('returns the files that were loaded', async () => {
			const { files } = await pkg.staticLibs(['req-pubpriv']);
			const f = new Set(files);
			expect(f.has(resolve('test/req-pubpriv.pc'))).to.be.true;
			expect(f.has(resolve('test/public.pc'))).to.be.true;
			expect(f.has(resolve('test/private.pc'))).to.be.true;
			expect(f.size).to.equal(3);
		});

		it('Fails if a transitive dependency conflicts with the package', async () => {
			await using t = await DynamicTest.init();

			await t.writePc('conflicts-foo', {
				name: 'Conflicts-Foo',
				version: 'a.b.c',
				conflicts: 'foo >= 1.2.3',
				requires: 'bar',
			});

			await t.writePc('bar', {
				requiresPrivate: 'foo',
			});

			await t.writePc('foo', {
				name: 'Foo',
				version: '1.2.4',
			});

			await expectFailure(
				['conflicts-foo'],
				/Version '?1.2.4'? of foo creates a conflict.\s+\(foo >= 1.2.3 conflicts with conflicts-foo '?a.b.c'?\)/,
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

	async libs(names: string[]): Promise<string[]> {
		const pkgOut = await this.spawn(['--libs', ...names]);
		return shellSplitWords(pkgOut);
	}

	async staticLibs(names: string[]): Promise<string[]> {
		const pkgOut = await this.spawn(['--libs', '--static', ...names]);
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
	return typeof obj === 'object' && 'self' in obj && 'ref' in obj;
}

function errMatchers(match: ErrorMatch): ErrorMatchObj {
	if (isErrMatchObj(match)) return match;

	return { ref: match, self: match };
}

class DynamicTest implements AsyncDisposable {
	public static async init(): Promise<DynamicTest> {
		await mkdir(dynamicTestDir);
		return new DynamicTest();
	}

	constructor() {}

	public get d(): string {
		return dynamicTestDir;
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		await rm(this.d, { recursive: true });
	}

	public writePc(name: string, opts: PcOpts): Promise<void> {
		const path = join(this.d, `${name}.pc`);
		const lines: string[] = [
			`Name: ${opts.name || ''}`,
			`Version: ${opts.version || ''}`,
			`Description: ${opts.description || ''}`,
		];

		if (opts.conflicts) lines.push(`Conflicts: ${opts.conflicts}`);
		if (opts.requires) lines.push(`Requires: ${opts.requires}`);
		if (opts.requiresPrivate)
			lines.push(`Requires.private: ${opts.requiresPrivate}`);
		if (opts.cflags) lines.push(`Cflags: ${opts.cflags}`);
		if (opts.url) lines.push(`URL: ${opts.url}`);
		if (opts.libs) lines.push(`Libs: ${opts.libs}`);
		if (opts.libsPrivate) lines.push(`Libs.private: ${opts.libsPrivate}`);

		if (opts.lines) lines.push(...opts.lines);

		return writeFile(path, lines.join('\n'), 'utf8');
	}
}

interface PcOpts {
	name?: string;
	version?: string;
	description?: string;
	conflicts?: string;
	requires?: string;
	requiresPrivate?: string;
	cflags?: string;
	url?: string;
	libs?: string;
	libsPrivate?: string;
	lines?: string[];
}
