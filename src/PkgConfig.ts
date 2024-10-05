import { join, basename, dirname } from 'node:path';
import { gShellParseArgv } from './gShell';
import { FileStream, isRegularFile } from './files';
import { CharPtr } from './CharPtr';

export class PkgConfig {
	private searchPaths: string[];
	private packages: Map<string, Package>;
	private disableUninstalled = false;
	private globals = new Map<string, string>();

	/** @todo
	 * global variables:
	 * pc_sysrootdir
	 * pc_top_builddir
	 *
	 * requires private
	 * libs private
	 * pkg virtual package
	 * module versions in names
	 */

	public constructor(opts: { searchPaths: string[] }) {
		this.searchPaths = [...opts.searchPaths];
		this.packages = new Map<string, Package>();
	}

	async cflags(moduleList: string[]): Promise<string[]> {
		const packages: Package[] = [];

		for (const name of moduleList) {
			const req = await this.getPackage(name, true);

			// TODO version test
			packages.push(req);
		}

		const result: string[] = [];

		result.push(
			...this.getMultiMerged(packages, FlagType.CFLAGS_OTHER, false, true),
		);
		result.push(
			...this.getMultiMerged(packages, FlagType.CFLAGS_I, true, true),
		);

		return result;
	}

	private getMultiMerged(
		packages: Package[],
		flagType: FlagType,
		inPathOrder: boolean,
		includePrivate: boolean,
	): string[] {
		const list: Flag[] = [];
		const visited = new Set<string>();
		const expanded: Package[] = [];

		// fill_list
		for (let i = packages.length - 1; i >= 0; --i) {
			this.recursiveFillList(packages[i], includePrivate, visited, expanded);
		}

		if (inPathOrder) {
			expanded.sort((a, b) => a.pathPosition - b.pathPosition);
		}

		for (const pkg of expanded) {
			// TODO handle libs
			const flags = pkg.cflags;

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

	private recursiveFillList(
		pkg: Package,
		includePrivate: boolean,
		visited: Set<string>,
		expanded: Package[],
	): void {
		if (visited.has(pkg.key)) return;

		visited.add(pkg.key);

		const reqs = includePrivate ? pkg.requiresPrivate : pkg.requires;
		for (let i = reqs.length - 1; i >= 0; --i) {
			this.recursiveFillList(reqs[i], includePrivate, visited, expanded);
		}

		expanded.unshift(pkg);
	}

	private async getPackage(
		name: string,
		mustExist: boolean,
	): Promise<Package | null> {
		let pkg: Package | null = this.packages.get(name);
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
				const un = await this.getPackage(name + uninstalled, false);

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

		pkg = await this.parsePackageFile(key, location);

		//if (!pkg) return null;

		if (location.includes('uninstalled.pc')) pkg.uninstalled = true;
		pkg.pathPosition = pathPosition;
		this.packages.set(key, pkg);

		for (const ver of pkg.requiresEntries) {
			const req = await this.getPackage(ver.name, mustExist);
			if (!req) {
				throw new Error(
					`Package '${ver.name}', required by '${pkg.key}', not found`,
				);
			}

			pkg.requiredVersions.set(ver.name, ver);
			pkg.requires.push(req);
		}

		for (const ver of pkg.requiresPrivateEntries) {
			const req = await this.getPackage(ver.name, mustExist);
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
	): Promise<Package | null> {
		const pkg = new Package(key, this.globals);

		if (path) {
			pkg.pcFileDir = dirname(path);
		} else {
			pkg.pcFileDir = '???????';
		}

		pkg.vars.set('pcfiledir', pkg.pcFileDir);

		const file = new FileStream(path);
		await file.load();
		while (!file.eof()) {
			const line = await readOneLine(file);
			pkg.parseLine(line, path);
		}

		return pkg;
	}
}

class Package {
	public key: string;
	public uninstalled: boolean;
	public pcFileDir: string;
	public vars = new Map<string, string>();
	public cflags: Flag[] = [];
	public pathPosition: number = 0;
	public name?: string;
	public version?: string;
	public description?: string;
	private globals: Map<string, string>;
	public requiresEntries: RequiredVersion[] = [];
	public requiresPrivateEntries: RequiredVersion[] = [];
	public requiredVersions = new Map<string, RequiredVersion>();
	public requires: Package[] = [];
	public requiresPrivate: Package[] = [];

	constructor(key: string, globals: Map<string, string>) {
		this.key = key;
		this.globals = globals;
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
	}

	public parseLine(untrimmed: string, path: string): void {
		// TODO check how trim_string & trim compare
		const str = untrimmed.trim();

		const match = str.match(/^([A-Za-z0-9_.]+)\s*([:=])\s*(.*)$/);
		if (!match) return;

		const tag = match[1];
		const op = match[2];
		const rest = match[3];

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
					this.parseRequiresPrivate(rest, path);
					break;
				case 'Requires':
					this.parseRequires(rest, path);
					break;
				case 'Libs.private':
					// TODO
					break;
				case 'Libs':
					// TODO
					break;
				case 'Cflags':
				case 'CFlags':
					this.parseCflags(rest, path);
					break;
				case 'Conflicts':
					// TODO
					break;
				case 'URL':
					// TODO
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
			const arg = strdupEscapeShell(argv[i].trim());

			const includeMatch = arg.match(/^-I\s*(.*)$/);
			if (includeMatch) {
				const flag = new Flag(FlagType.CFLAGS_I, [arg]);
				this.cflags.push(flag);
			} else if (
				(arg === '-idirafter' || arg === '-isystem') &&
				i + 1 < argv.length
			) {
				const option = strdupEscapeShell(argv[i + 1]);
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
		// TODO handle dup Requires field

		const trimmed = this.trimAndSub(str, path);
		this.requiresEntries = this.parseModuleList(trimmed, path);
	}

	private parseRequiresPrivate(str: string, path: string): void {
		// TODO handle dup Requires.private field

		const trimmed = this.trimAndSub(str, path);
		this.requiresPrivateEntries = this.parseModuleList(trimmed, path);
	}

	private parseModuleList(str: string, path: string): RequiredVersion[] {
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

			if (!ver.name) assertNotReached();
		}

		return retval;
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
		const varval = this.globals.get(varName);

		// no feature to override variables. can be requested

		return varval || this.vars.get(varName);
	}
}

enum FlagType {
	CFLAGS_I,
	CFLAGS_OTHER,
}

class Flag {
	readonly type: FlagType;
	readonly args: string[];

	constructor(type: FlagType, args: string[]) {
		this.type = type;
		this.args = args;
	}

	public hasType(type: FlagType): boolean {
		return this.type === type;
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

async function readOneLine(file: FileStream): Promise<string> {
	let quoted = false;
	let comment = false;

	let line = '';

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
				case '\n':
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
				case '\n':
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
				default:
					if (!comment) line += c;
			}
		}
	}
}

function strdupEscapeShell(str: string): string {
	return str;
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
		case '\n':
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

					if (!s.deref()) state = ModuleSplitState.OUTSIDE_MODULE;
					else if (isModuleSeparator(s.deref()))
						state = ModuleSplitState.OUTSIDE_MODULE;
					else if (isOperatorChar(s.deref()))
						state = ModuleSplitState.BEFORE_OPERATOR;
					else state = ModuleSplitState.OUTSIDE_MODULE;
				} else if (isModuleSeparator(p.deref())) {
					state = ModuleSplitState.OUTSIDE_MODULE;
				}

				break;

			case ModuleSplitState.BEFORE_OPERATOR:
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

function assertNotReached(): never {
	throw new Error('PkgConfig is in an unexpected state. Please file a bug.');
}

enum ComparisonType {
	LESS_THAN,
	GREATER_THAN,
	LESS_THAN_EQUAL,
	GREATER_THAN_EQUAL,
	EQUAL,
	NOT_EQUAL,
	ALWAYS_MATCH,
}

class RequiredVersion {
	public name: string;
	public comparison: ComparisonType;
	public version: string;
	public owner?: Package;
}
