/*
 * Copyright (C) 2024 Nicholas Gulachek
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA
 * 02111-1307, USA.
 */

import { join, basename, dirname } from 'node:path';
import { gShellParseArgv } from './gShell';
import { FileStream, isRegularFile } from './files';
import { CharPtr } from './CharPtr';

/** The pkg-config version we're mimicking */
const SIMULATED_VERSION = '0.29.2';

/** Return type of pkg-config flags calculations */
export type PkgResult = {
	/** Flags computed by pkg-config to pass to compiler/linker CLI arguments */
	flags: string[];

	/** Absolute paths of the .pc files that were loaded during the computation */
	files: string[];
};

/** Options to configure the PkgConfig behavior */
export type PkgOptions = {
	/** Ordered list of directories to search for .pc files like `PKG_CONFIG_PATH` */
	searchPaths: string[];
};

/**
 * Top level object representing the pkg-config implementation
 */
export class PkgConfig {
	private searchPaths: string[];
	private disableUninstalled = false;

	/** Construct the PkgConfig object */
	public constructor(opts: PkgOptions) {
		this.searchPaths = [...opts.searchPaths];
	}

	/**
	 * Compute compiler flags for the given list of modules
	 * @param moduleList The names of modules to compute flags for
	 * @returns The flags necessary to compile against the given modules
	 * @remarks The moduleList argument can accept versioned modules like 'foo = 1.2.3'
	 */
	public async cflags(moduleList: string[]): Promise<PkgResult> {
		const globalState = new GlobalState();
		const { packages, files } = await this.loadPackages(
			moduleList,
			globalState,
		);
		const flags: string[] = [];

		flags.push(
			...this.getMultiMerged(
				packages,
				'cflags',
				FlagType.CFLAGS_OTHER,
				false,
				true,
			),
		);
		flags.push(
			...this.getMultiMerged(packages, 'cflags', FlagType.CFLAGS_I, true, true),
		);

		return { flags, files };
	}

	/**
	 * Compute linker flags for the given list of modules
	 * @param moduleList The names of modules to compute flags for
	 * @returns The flags necessary to link against the given modules
	 * @remarks The moduleList argument can accept versioned modules like 'foo = 1.2.3'
	 */
	public async libs(moduleList: string[]): Promise<PkgResult> {
		const globalState = new GlobalState();
		globalState.ignorePrivateReqs = true;
		const { packages, files } = await this.loadPackages(
			moduleList,
			globalState,
		);
		const flags: string[] = [];

		flags.push(
			...this.getMultiMerged(packages, 'libs', FlagType.LIBS_L, true, false),
		);

		const lFlags = FlagType.LIBS_OTHER | FlagType.LIBS_l;
		flags.push(...this.getMultiMerged(packages, 'libs', lFlags, false, false));

		return { flags, files };
	}

	/**
	 * Compute static linker flags for the given list of modules
	 * @param moduleList The names of modules to compute flags for
	 * @returns The flags necessary to statically link against the given modules
	 * @remarks The moduleList argument can accept versioned modules like 'foo = 1.2.3'
	 */
	public async staticLibs(moduleList: string[]): Promise<PkgResult> {
		const globalState = new GlobalState();
		const { packages, files } = await this.loadPackages(
			moduleList,
			globalState,
		);
		const flags: string[] = [];

		flags.push(
			...this.getMultiMerged(
				packages,
				'privateLibs',
				FlagType.LIBS_L,
				true,
				true,
			),
		);

		const lFlags = FlagType.LIBS_OTHER | FlagType.LIBS_l;
		flags.push(
			...this.getMultiMerged(packages, 'privateLibs', lFlags, false, true),
		);

		return { flags, files };
	}

	private async loadPackages(
		moduleList: string[],
		globalState: GlobalState,
	): Promise<{ packages: Package[]; files: string[] }> {
		const packages: Package[] = [];
		const reqs = moduleList.map((m) => RequiredVersion.fromUserArg(m));

		for (const req of reqs) {
			const pkg = await this.getPackage({
				name: req.name,
				mustExist: true,
				globalState,
			});

			if (!req.test(pkg.version)) {
				throw new Error(
					`Requested '${req.toString()}' but version of ${pkg.name} is ${pkg.version}`,
				);
			}

			packages.push(pkg);
		}

		return { packages, files: globalState.loadedFiles() };
	}

	private getMultiMerged(
		packages: Package[],
		keyProp: 'cflags' | 'libs' | 'privateLibs',
		flagType: FlagType,
		inPathOrder: boolean,
		includePrivate: boolean,
	): string[] {
		const list: Flag[] = [];
		const visited = new Set<string>();
		const expanded: Package[] = [];

		// fill_list
		for (let i = packages.length - 1; i >= 0; --i) {
			recursiveFillList(packages[i], includePrivate, visited, expanded);
		}

		if (inPathOrder) {
			expanded.sort((a, b) => a.pathPosition - b.pathPosition);
		}

		for (const pkg of expanded) {
			const flags = pkg[keyProp];

			for (const flag of flags) {
				if (flag.hasType(flagType)) {
					// flag_list_strip_duplicates
					if (list.length < 1 || !flag.equals(list[list.length - 1])) {
						list.push(flag);
					}
				}
			}
		}

		// SKIP flag_list_to_string (we want a parsed array)
		const out: string[] = [];
		for (const f of list) {
			out.push(...f.args);
		}

		return out;
	}

	private async getPackage(opts: {
		name: string;
		mustExist: boolean;
		globalState: GlobalState;
	}): Promise<Package | null> {
		const { name, mustExist, globalState } = opts;
		let pkg = globalState.getLoadedPackage(name);
		if (pkg) return pkg;

		let location: string | null = null;
		let key: string = name;
		let pathPosition = 0;

		const pc = '.pc';
		if (name.endsWith(pc)) {
			location = name;
			const bname = basename(location);
			key = bname.slice(0, bname.length - pc.length);
		} else {
			const uninstalled = '-uninstalled';

			if (!this.disableUninstalled && !name.endsWith(uninstalled)) {
				const un = await this.getPackage({
					name: name + uninstalled,
					mustExist: false,
					globalState,
				});

				if (un) return un;
			}

			for (const searchPath of this.searchPaths) {
				pathPosition++;
				const path = join(searchPath, name + pc);
				if (await isRegularFile(path)) {
					location = path;
					break;
				}
			}
		}

		if (!location) {
			if (mustExist)
				throw new Error(
					`Package "${name}" was not found in the PkgConfig searchPath`,
				);

			return null;
		}

		pkg = await this.parsePackageFile(key, location, globalState);

		//if (!pkg) return null;

		if (location.includes('uninstalled.pc')) pkg.uninstalled = true;
		pkg.pathPosition = pathPosition;
		globalState.cachePackage(pkg);

		for (const ver of pkg.requiresEntries) {
			const req = await this.getPackage({
				name: ver.name,
				mustExist: false,
				globalState,
			});
			if (!req) {
				throw new Error(
					`Package '${ver.name}', required by '${pkg.key}', not found`,
				);
			}

			pkg.requiredVersions.set(ver.name, ver);
			pkg.requires.push(req);
		}

		for (const ver of pkg.requiresPrivateEntries) {
			const req = await this.getPackage({
				name: ver.name,
				mustExist: false,
				globalState,
			});
			if (!req) {
				throw new Error(
					`Package '${ver.name}', required by '${pkg.key}', not found`,
				);
			}

			pkg.requiredVersions.set(ver.name, ver);
			pkg.requiresPrivate.push(req);
		}

		pkg.requiresPrivate = [...pkg.requiresPrivate, ...pkg.requires];

		pkg.verify();

		return pkg;
	}

	private async parsePackageFile(
		key: string,
		path: string,
		globalState: GlobalState,
	): Promise<Package | null> {
		const pkg = new Package(key, globalState);

		pkg.pcFile = path;
		pkg.vars.set('pcfiledir', dirname(pkg.pcFile));

		const file = new FileStream(path);
		await file.load();
		while (!file.eof()) {
			const line = readOneLine(file);
			pkg.parseLine(line, path);
		}

		return pkg;
	}
}

class Package {
	public key: string;
	public uninstalled: boolean;
	public pcFile?: string;
	public vars = new Map<string, string>();
	public cflags: Flag[] = [];
	public libs: Flag[] = [];
	public privateLibs: Flag[] = [];
	private hasLibs = false;
	private hasPrivateLibs = false;
	public pathPosition: number = 0;
	public name?: string;
	public version?: string;
	public description?: string;
	private globalState: WeakRef<GlobalState>;
	public requiresEntries: RequiredVersion[] = [];
	public requiresPrivateEntries: RequiredVersion[] = [];
	public conflicts: RequiredVersion[] = [];
	public requiredVersions = new Map<string, RequiredVersion>();
	public requires: Package[] = [];
	public requiresPrivate: Package[] = [];
	public url?: string;

	constructor(key: string, globalState: GlobalState) {
		this.key = key;
		this.globalState = new WeakRef(globalState);
	}

	public verify(): void {
		if (typeof this.name === 'undefined') {
			throw new Error(`Package '${this.key}' has no Name: field`);
		}

		if (typeof this.version === 'undefined') {
			throw new Error(`Package '${this.key}' has no Version: field`);
		}

		if (typeof this.description === 'undefined') {
			throw new Error(`Package '${this.key}' has no Description: field`);
		}

		for (const req of this.requiresPrivate) {
			const ver = this.requiredVersions.get(req.key);
			if (ver) {
				if (!ver.test(req.version)) {
					let err = `Package '${this.key}' requires '${ver.toString()}' but version of ${req.key} is ${req.version}`;
					if (req.url)
						err += `\nYou may find new versions of ${req.name} at ${req.url}`;

					throw new Error(err);
				}
			}
		}

		const visited = new Set<string>();
		const transitiveRequires: Package[] = [];
		recursiveFillList(this, true, visited, transitiveRequires);

		for (const req of transitiveRequires) {
			for (const ver of this.conflicts) {
				if (ver.name === req.key && ver.test(req.version)) {
					throw new Error(
						`Version '${req.version}' of ${req.key} creates a conflict. (${ver.toString()} conflicts with ${this.key} '${this.version}')`,
					);
				}
			}
		}
	}

	public parseLine(untrimmed: string, path: string): void {
		const str = untrimmed.trim();

		const match = str.match(/^([A-Za-z0-9_.]+)\s*([:=])\s*(.*)$/);
		if (!match) return;

		const tag = match[1];
		const op = match[2];
		const rest = match[3];

		const globalState = this.globalState.deref();
		let ignorePrivateReqs = false;
		if (globalState) ignorePrivateReqs = globalState.ignorePrivateReqs;

		if (op === ':') {
			switch (tag) {
				case 'Name':
					if (typeof this.name === 'string') {
						throw new Error(`Name field occurs multiple times in '${path}'`);
					}

					this.name = this.trimAndSub(rest, path);
					break;
				case 'Version':
					if (typeof this.version === 'string') {
						throw new Error(`Version field occurs multiple times in '${path}'`);
					}

					this.version = this.trimAndSub(rest, path);
					break;
				case 'Description':
					if (typeof this.description === 'string') {
						throw new Error(
							`Description field occurs multiple times in '${path}'`,
						);
					}

					this.description = this.trimAndSub(rest, path);
					break;
				case 'Requires.private':
					ignorePrivateReqs || this.parseRequiresPrivate(rest, path);
					break;
				case 'Requires':
					this.parseRequires(rest, path);
					break;
				case 'Libs.private':
					this.parseLibsPrivate(rest, path);
					break;
				case 'Libs':
					this.parseLibs(rest, path);
					break;
				case 'Cflags':
				case 'CFlags':
					this.parseCflags(rest, path);
					break;
				case 'Conflicts':
					this.parseConflicts(rest, path);
					break;
				case 'URL':
					if (typeof this.url === 'string') {
						throw new Error(`URL field occurs multiple times in '${path}'`);
					}

					this.url = this.trimAndSub(rest, path);
					break;
				default:
					// pkg-config doesn't error here hoping for future compatibility
					break;
			}
		} else if (op === '=') {
			if (this.vars.has(tag)) {
				throw new Error(
					`Duplicate definition of variable '${tag}' in '${path}'`,
				);
			}

			this.vars.set(tag, this.trimAndSub(rest, path));
		}
	}

	private parseLibs(str: string, path: string): void {
		if (this.hasLibs) {
			throw new Error(`Libs field occurs multiple times in '${path}'`);
		}

		this.hasLibs = true;
		const trimmed = this.trimAndSub(str, path);
		if (!trimmed) return;

		const { error, argv } = gShellParseArgv(trimmed);
		if (error)
			throw new Error(
				`Couldn't parse Libs field into an argument vector: ${error}`,
			);

		this.libs = this.doParseLibs(argv);
		this.privateLibs.push(...this.libs);
	}

	private parseLibsPrivate(str: string, path: string): void {
		if (this.hasPrivateLibs) {
			throw new Error(`Libs.private field occurs multiple times in '${path}'`);
		}

		this.hasPrivateLibs = true;
		const trimmed = this.trimAndSub(str, path);
		if (!trimmed) return;

		const { error, argv } = gShellParseArgv(trimmed);
		if (error)
			throw new Error(
				`Couldn't parse Libs.private field into an argument vector: ${error}`,
			);

		this.privateLibs.push(...this.doParseLibs(argv));
	}

	private doParseLibs(argv: string[]): Flag[] {
		const libs: Flag[] = [];

		// TODO msvc syntax?
		for (let i = 0; i < argv.length; ++i) {
			const arg = argv[i].trim();

			if (arg.startsWith('-l') && !arg.startsWith('-lib:')) {
				const flag = new Flag(FlagType.LIBS_l, [arg]);
				libs.push(flag);
			} else if (arg.startsWith('-L')) {
				const flag = new Flag(FlagType.LIBS_L, [arg]);
				libs.push(flag);
			} else if (
				(arg === '-framework' || arg === '-Wl,-framework') &&
				i + 1 < argv.length
			) {
				const framework = argv[i + 1].trim();
				const flag = new Flag(FlagType.LIBS_OTHER, [arg, framework]);
				libs.push(flag);
				i++;
			} else if (arg) {
				libs.push(new Flag(FlagType.LIBS_OTHER, [arg]));
			}
		}

		return libs;
	}

	private parseCflags(str: string, path: string): void {
		if (this.cflags.length > 0) {
			throw new Error(`Cflags field occurs more than once in '${path}'`);
		}

		const trimmed = this.trimAndSub(str, path);

		const { error, argv } = gShellParseArgv(trimmed);
		if (trimmed && error) {
			throw new Error(
				`Couldn't parse Cflags field into an argument vector: ${error}`,
			);
		}

		let i = 0;
		while (i < argv.length) {
			const arg = argv[i].trim();

			const includeMatch = arg.match(/^-I\s*(.*)$/);
			if (includeMatch) {
				const flag = new Flag(FlagType.CFLAGS_I, [arg]);
				this.cflags.push(flag);
			} else if (
				(arg === '-idirafter' || arg === '-isystem') &&
				i + 1 < argv.length
			) {
				const option = argv[i + 1];
				const flag = new Flag(FlagType.CFLAGS_I, [arg, option]);
				this.cflags.push(flag);
				i++;
			} else if (arg) {
				const flag = new Flag(FlagType.CFLAGS_OTHER, [arg]);
				this.cflags.push(flag);
			}

			++i;
		}
	}

	private parseRequires(str: string, path: string): void {
		// pkg-config BUG: reference implementation only sets requires_entries while
		// parsing, but checks the requires object, which will never exist until
		// after being done parsing. So it overrides Requires instead of errors
		const trimmed = this.trimAndSub(str, path);
		this.requiresEntries = parseModuleList(trimmed, path);
	}

	private parseRequiresPrivate(str: string, path: string): void {
		// pkg-config BUG: reference implementation only sets requires_private_entries while
		// parsing, but checks the requires_private object, which will never exist until
		// after being done parsing. So it overrides Requires.private instead of errors
		const trimmed = this.trimAndSub(str, path);
		this.requiresPrivateEntries = parseModuleList(trimmed, path);
	}

	private parseConflicts(str: string, path: string): void {
		if (this.conflicts.length > 0) {
			throw new Error(`Conflicts field occurs multiple times in '${path}'`);
		}

		const trimmed = this.trimAndSub(str, path);
		this.conflicts = parseModuleList(trimmed, path);
	}

	private trimAndSub(str: string, path: string): string {
		const trimmed = str.trim();
		let subst = '';
		const p = new CharPtr(trimmed);
		while (p.deref()) {
			if (p.deref() === '$' && p.deref(1) === '$') {
				subst += '$';
				p.advance();
				p.advance();
			} else if (p.deref() === '$' && p.deref(1) === '{') {
				p.advance();
				p.advance();
				const varStart = p.dup();
				while (p.deref() && p.deref() !== '}') p.advance();

				const varname = varStart.slice(p.ptrdiff(varStart));

				p.advance();

				const varval = this.getVar(varname);

				if (typeof varval === 'undefined') {
					throw new Error(`Variable '${varname}' not defined in '${path}'`);
				}

				subst += varval;
			} else {
				subst += p.deref();
				p.advance();
			}
		}

		return subst;
	}

	private getVar(varName: string): string | undefined {
		const globalState = this.globalState.deref();
		let varval = '';
		if (globalState) varval = globalState.getVar(varName);

		// no feature to override variables. can be requested

		return varval || this.vars.get(varName);
	}
}

enum FlagType {
	CFLAGS_I = 1 << 0,
	CFLAGS_OTHER = 1 << 1,
	LIBS_L = 1 << 2,
	LIBS_l = 1 << 3,
	LIBS_OTHER = 1 << 4,
}

class Flag {
	readonly type: FlagType;
	readonly args: string[];

	constructor(type: FlagType, args: string[]) {
		this.type = type;
		this.args = args;
	}

	public hasType(type: FlagType): boolean {
		return (this.type & type) !== 0;
	}

	public equals(other: Flag): boolean {
		if (this.type !== other.type) return false;

		if (this.args.length !== other.args.length) return false;

		for (let i = 0; i < this.args.length; ++i) {
			if (this.args[i] !== other.args[i]) return false;
		}

		return true;
	}
}

function readOneLine(file: FileStream): string {
	let quoted = false;
	let comment = false;

	let line = '';

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const c = file.getc();
		if (!c /* EOF */) {
			if (quoted) line += '\\';
			return line;
		}

		if (quoted) {
			quoted = false;

			switch (c) {
				case '#':
					line += '#';
					break;
				case '\r':
				case '\n': {
					const nextC = file.getc();

					if (
						!(
							//!c || <-- pkg-config bug
							(
								!nextC ||
								(c === '\r' && nextC === '\n') ||
								(c === '\n' && nextC === '\r')
							)
						)
					)
						file.ungetc(nextC);

					break;
				}
				default:
					line += `\\${c}`;
			}
		} else {
			switch (c) {
				case '#':
					comment = true;
					break;
				case '\\':
					if (!comment) quoted = true;
					break;
				case '\n': {
					const nextC = file.getc();
					if (
						!(
							//!c || // <-- pkg-config bug
							//(c === "\r" && nextC === "\n") || <-- pkg-config bug
							(!nextC || (c === '\n' && nextC === '\r'))
						)
					)
						file.ungetc(nextC);

					return line;
				}
				default:
					if (!comment) line += c;
			}
		}
	}
}

enum ModuleSplitState {
	OUTSIDE_MODULE,
	IN_MODULE_NAME,
	BEFORE_OPERATOR,
	IN_OPERATOR,
	AFTER_OPERATOR,
	IN_MODULE_VERSION,
}

function isSpace(c: string): boolean {
	switch (c) {
		case ' ':
		case '\n':
		case '\t':
		case '\f':
		case '\v':
			return true;
		default:
			return false;
	}
}

function isModuleSeparator(c: string): boolean {
	return c === ',' || isSpace(c);
}

function isOperatorChar(c: string): boolean {
	switch (c) {
		case '<':
		case '>':
		case '!':
		case '=':
			return true;
		default:
			return false;
	}
}

function parseModuleList(str: string, path: string): RequiredVersion[] {
	const split = splitModuleList(str);
	const retval: RequiredVersion[] = [];

	for (const iter of split) {
		const p = new CharPtr(iter);
		const ver = new RequiredVersion();
		ver.comparison = ComparisonType.ALWAYS_MATCH;
		ver.owner = this;
		retval.push(ver);

		while (p.deref() && isModuleSeparator(p.deref())) p.advance();

		let start = p.dup();

		while (p.deref() && !isSpace(p.deref())) p.advance();

		while (p.deref() && isModuleSeparator(p.deref())) {
			p.setChar('\0');
			p.advance();
		}

		if (!start.deref()) {
			throw new Error(
				`Empty package name in Requires or Conflicts in file '${path}'`,
			);
		}

		ver.name = start.toString();
		start = p.dup();

		while (p.deref() && !isSpace(p.deref())) p.advance();

		while (p.deref() && isSpace(p.deref())) {
			p.setChar('\0');
			p.advance();
		}

		if (start.deref()) {
			switch (start.toString()) {
				case '=':
					ver.comparison = ComparisonType.EQUAL;
					break;
				case '>=':
					ver.comparison = ComparisonType.GREATER_THAN_EQUAL;
					break;
				case '<=':
					ver.comparison = ComparisonType.LESS_THAN_EQUAL;
					break;
				case '>':
					ver.comparison = ComparisonType.GREATER_THAN;
					break;
				case '<':
					ver.comparison = ComparisonType.LESS_THAN;
					break;
				case '!=':
					ver.comparison = ComparisonType.NOT_EQUAL;
					break;
				default:
					throw new Error(
						`Unknown version comparison operator '${start.toString()}' after package name '${ver.name}' in file '${path}'`,
					);
			}
		}

		start = p.dup();

		while (p.deref() && !isModuleSeparator(p.deref())) p.advance();

		while (p.deref() && isModuleSeparator(p.deref())) {
			p.setChar('\0');
			p.advance();
		}

		if (ver.comparison !== ComparisonType.ALWAYS_MATCH && !start.deref()) {
			throw new Error(
				`Comparison operator but no version after package name '${ver.name}' in file '${path}'`,
			);
		}

		if (start.deref()) ver.version = start.toString();

		/* istanbul ignore next */
		if (!ver.name) assertNotReached();
	}

	return retval;
}
function splitModuleList(str: string): string[] {
	const retval: string[] = [];
	let state = ModuleSplitState.OUTSIDE_MODULE;
	let lastState = ModuleSplitState.OUTSIDE_MODULE;

	let start = new CharPtr(str);
	const p = start.dup();

	while (p.deref()) {
		switch (state) {
			case ModuleSplitState.OUTSIDE_MODULE:
				if (!isModuleSeparator(p.deref()))
					state = ModuleSplitState.IN_MODULE_NAME;
				break;

			case ModuleSplitState.IN_MODULE_NAME:
				if (isSpace(p.deref())) {
					const s = p.dup();
					while (s.deref() && isSpace(s.deref())) s.advance();

					if (isOperatorChar(s.deref()))
						state = ModuleSplitState.BEFORE_OPERATOR;
					else state = ModuleSplitState.OUTSIDE_MODULE;
				} else if (isModuleSeparator(p.deref())) {
					state = ModuleSplitState.OUTSIDE_MODULE;
				}

				break;

			case ModuleSplitState.BEFORE_OPERATOR:
				/* istanbul ignore else */
				if (isOperatorChar(p.deref())) state = ModuleSplitState.IN_OPERATOR;
				else if (!isSpace(p.deref())) assertNotReached();
				break;

			case ModuleSplitState.IN_OPERATOR:
				if (!isOperatorChar(p.deref())) state = ModuleSplitState.AFTER_OPERATOR;
				break;

			case ModuleSplitState.AFTER_OPERATOR:
				if (!isSpace(p.deref())) state = ModuleSplitState.IN_MODULE_VERSION;
				break;

			case ModuleSplitState.IN_MODULE_VERSION:
				if (isModuleSeparator(p.deref()))
					state = ModuleSplitState.OUTSIDE_MODULE;
				break;

			/* istanbul ignore next */
			default:
				assertNotReached();
		}

		if (
			state === ModuleSplitState.OUTSIDE_MODULE &&
			lastState !== ModuleSplitState.OUTSIDE_MODULE
		) {
			const module = start.slice(p.ptrdiff(start));
			retval.push(module);

			start = p.dup();
		}

		lastState = state;
		p.advance();
	}

	const n = p.ptrdiff(start);
	if (n !== 0) {
		const module = start.slice(n);
		retval.push(module);
	}

	return retval;
}

/* istanbul ignore next */
function assertNotReached(): never {
	throw new Error('PkgConfig is in an unexpected state. Please file a bug.');
}

enum ComparisonType {
	LESS_THAN = '<',
	GREATER_THAN = '>',
	LESS_THAN_EQUAL = '<=',
	GREATER_THAN_EQUAL = '>=',
	EQUAL = '=',
	NOT_EQUAL = '!=',
	ALWAYS_MATCH = '(any)',
}

function isDigit(c: string): boolean {
	return '0' <= c && c <= '9';
}

function isAlpha(c: string): boolean {
	return ('a' <= c && c <= 'z') || ('A' <= c && c <= 'Z');
}

function isAlnum(c: string): boolean {
	return isDigit(c) || isAlpha(c);
}

export function rpmVerCmp(a: string, b: string): number {
	if (a === b) return 0;

	let isNum = false;

	const str1 = new CharPtr(a);
	const str2 = new CharPtr(b);

	const one = str1.dup();
	const two = str2.dup();

	while (one.deref() && two.deref()) {
		while (one.deref() && !isAlnum(one.deref())) one.advance();
		while (two.deref() && !isAlnum(two.deref())) two.advance();

		if (!(one.deref() && two.deref())) break;

		str1.copyFrom(one);
		str2.copyFrom(two);

		if (isDigit(str1.deref())) {
			while (str1.deref() && isDigit(str1.deref())) str1.advance();
			while (str2.deref() && isDigit(str2.deref())) str2.advance();
			isNum = true;
		} else {
			while (str1.deref() && isAlpha(str1.deref())) str1.advance();
			while (str2.deref() && isAlpha(str2.deref())) str2.advance();
			isNum = false;
		}

		const oldCh1 = str1.deref();
		str1.setChar('\0');
		const oldCh2 = str2.deref();
		str2.setChar('\0');

		//if (one.ptrdiff(str1) === 0) return -1; can't happen
		if (two.ptrdiff(str2) === 0) return isNum ? 1 : -1;

		if (isNum) {
			while (one.deref() === '0') one.advance();
			while (two.deref() === '0') two.advance();

			const oneStr = one.toString();
			const twoStr = two.toString();
			if (oneStr.length > twoStr.length) return 1;
			if (twoStr.length > oneStr.length) return -1;
		}

		const oneStr = one.toString();
		const twoStr = two.toString();
		if (oneStr < twoStr) return -1;
		if (twoStr < oneStr) return 1;

		oldCh1 && str1.setChar(oldCh1);
		one.copyFrom(str1);
		oldCh2 && str2.setChar(oldCh2);
		two.copyFrom(str2);
	}

	if (!one.deref() && !two.deref()) return 0;
	if (!one.deref()) return -1;
	return 1;
}

export class RequiredVersion {
	public name: string;
	public comparison: ComparisonType;
	public version: string;
	public owner?: Package;

	private static parseErr(arg: unknown, msg: string): never {
		throw new Error(`Error parsing package requirement from '${arg}': ${msg}`);
	}

	public static fromUserArg(arg: unknown): RequiredVersion {
		if (typeof arg !== 'string') {
			this.parseErr(arg, 'Package name is not a string');
		}

		const pieces = arg.trim().split(/\s+/);
		if (pieces.length < 1 || !pieces[0]) {
			this.parseErr(arg, 'No package name found');
		}

		const req = new RequiredVersion();
		req.name = pieces[0];

		if (pieces.length === 1) {
			req.comparison = ComparisonType.ALWAYS_MATCH;
			req.version = '';
			return req;
		}

		const op = pieces[1];
		switch (op) {
			case '=':
				req.comparison = ComparisonType.EQUAL;
				break;
			case '>=':
				req.comparison = ComparisonType.GREATER_THAN_EQUAL;
				break;
			case '<=':
				req.comparison = ComparisonType.LESS_THAN_EQUAL;
				break;
			case '>':
				req.comparison = ComparisonType.GREATER_THAN;
				break;
			case '<':
				req.comparison = ComparisonType.LESS_THAN;
				break;
			case '!=':
				req.comparison = ComparisonType.NOT_EQUAL;
				break;
			default:
				this.parseErr(arg, `Invalid comparison operator '${op}'`);
		}

		if (pieces.length != 3) {
			this.parseErr(
				arg,
				`Expected format <name> [<op> <version>] but given string has ${pieces.length} tokens`,
			);
		}

		req.version = pieces[2];
		return req;
	}

	public test(version: string): boolean {
		const rc = rpmVerCmp(version, this.version);
		switch (this.comparison) {
			case ComparisonType.LESS_THAN:
				return rc < 0;
			case ComparisonType.GREATER_THAN:
				return rc > 0;
			case ComparisonType.LESS_THAN_EQUAL:
				return rc <= 0;
			case ComparisonType.GREATER_THAN_EQUAL:
				return rc >= 0;
			case ComparisonType.EQUAL:
				return rc === 0;
			case ComparisonType.NOT_EQUAL:
				return rc !== 0;
			case ComparisonType.ALWAYS_MATCH:
				return true;
			/* istanbul ignore next */
			default:
				assertNotReached();
		}
	}

	public toString(): string {
		return `${this.name} ${this.comparison} ${this.version}`;
	}
}

class GlobalState {
	private packages = new Map<string, Package>();
	private vars = new Map<string, string>();
	public ignorePrivateReqs = false;

	constructor() {
		const pkgKey = 'pkg-config';
		const pkg = new Package(pkgKey, this);
		pkg.name = pkgKey;
		pkg.version = SIMULATED_VERSION;
		pkg.description = `pkg-config is a system for managing compile/link flags for libraries`;
		pkg.url = 'http://pkg-config.freedesktop.org/';
		this.packages.set(pkgKey, pkg);
	}

	public getLoadedPackage(key: string): Package | null {
		return this.packages.get(key) || null;
	}

	public cachePackage(pkg: Package): void {
		this.packages.set(pkg.key, pkg);
	}

	public getVar(name: string): string | null {
		return this.vars.get(name) || null;
	}

	public loadedFiles(): string[] {
		const files: string[] = [];

		for (const [_, pkg] of this.packages) {
			pkg.pcFile && files.push(pkg.pcFile);
		}

		return files;
	}
}

function recursiveFillList(
	pkg: Package,
	includePrivate: boolean,
	visited: Set<string>,
	expanded: Package[],
): void {
	if (visited.has(pkg.key)) return;

	visited.add(pkg.key);

	const reqs = includePrivate ? pkg.requiresPrivate : pkg.requires;
	for (let i = reqs.length - 1; i >= 0; --i) {
		recursiveFillList(reqs[i], includePrivate, visited, expanded);
	}

	expanded.unshift(pkg);
}
