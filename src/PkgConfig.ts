import { join, basename, dirname } from "node:path";
import { gShellParseArgv } from "./gShell";
import { FileStream, isRegularFile } from "./files";

export class PkgConfig {
  private searchPaths: string[];
  private packages: Map<string, Package>;
  private disableUninstalled = false;

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
      ...this.getMultiMerged(packages, FlagType.CFLAGS_OTHER, false, true)
    );
    result.push(
      ...this.getMultiMerged(packages, FlagType.CFLAGS_I, true, true)
    );

    return result;
  }

  private getMultiMerged(
    packages: Package[],
    flagType: FlagType,
    inPathOrder: boolean,
    includePrivate: boolean
  ): string[] {
    const list: Flag[] = [];
    const visited = new Set<string>();
    const expanded: Package[] = [];

    // fill_list
    for (let i = packages.length - 1; i >= 0; --i) {
      this.recursiveFillList(packages[i], includePrivate, visited, expanded);
    }

    if (inPathOrder) {
      // TODO sort by path position
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

    // TODO handle pcsysrootdir?

    // SKIP flag_list_to_string (we want a parsed array)
    const out: string[] = [];
    for (const f of list) {
      out.push(...f.args);
    }

    return out;
  }

  private recursiveFillList(
    pkg: Package,
    _includePrivate: boolean,
    visited: Set<string>,
    expanded: Package[]
  ): void {
    if (visited.has(pkg.key)) return;

    visited.add(pkg.key);
    // TODO handle requires/requires.private

    expanded.unshift(pkg);
  }

  private async getPackage(
    name: string,
    mustExist: boolean
  ): Promise<Package | null> {
    let pkg: Package | null = this.packages.get(name);
    if (pkg) return pkg;

    let location: string | null = null;
    let key: string = name;

    const pc = ".pc";
    if (name.endsWith(pc)) {
      location = name;
      const bname = basename(location);
      key = bname.slice(0, bname.length - pc.length);
    } else {
      const uninstalled = "-uninstalled";

      if (!this.disableUninstalled && !name.endsWith(uninstalled)) {
        const un = await this.getPackage(name + uninstalled, false);

        if (un) return un;
      }

      for (const searchPath of this.searchPaths) {
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
          `Package "${name}" was not found in the PkgConfig searchPath`
        );

      return null;
    }

    pkg = await this.parsePackageFile(key, location);

    //if (!pkg) return null;

    this.packages.set(key, pkg);

    if (location.includes("uninstalled.pc")) pkg.uninstalled = true;

    // todo requires / requires.private
    return pkg;
  }

  private async parsePackageFile(
    key: string,
    path: string
  ): Promise<Package | null> {
    const pkg = new Package(key);

    if (path) {
      pkg.pcFileDir = dirname(path);
    } else {
      pkg.pcFileDir = "???????";
    }

    pkg.vars.set("pcfiledir", pkg.pcFileDir);

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

  constructor(key: string) {
    this.key = key;
  }

  public parseLine(untrimmed: string, path: string): void {
    // TODO check how trim_string & trim compare
    const str = untrimmed.trim();

    const match = str.match(/^([A-Za-z0-9_.]+)\s*([:=])\s*(.*)$/);
    if (!match) return;

    const tag = match[1];
    const op = match[2];
    const rest = match[3];

    if (op === ":") {
      switch (tag) {
        case "Name":
          // TODO
          break;
        case "Description":
          // TODO
          break;
        case "Requires.private":
          // TODO
          break;
        case "Requires":
          // TODO
          break;
        case "Libs.private":
          // TODO
          break;
        case "Libs":
          // TODO
          break;
        case "Cflags":
        case "CFlags":
          // TODO
          this.parseCflags(rest, path);
          break;
        case "Conflicts":
          // TODO
          break;
        case "URL":
          // TODO
          break;
        default:
          // pkg-config doesn't error here hoping for future compatibility
          break;
      }
    } else if (op === "=") {
      // TODO defines_prefix seems to be a windows thing by default. Do we care?
      if (this.vars.get(tag)) {
        // TODO duplicate definition error
        throw new Error("Duplicate variable... needs testing");
      }

      //this.vars.set(tag, this.trimAndSub(rest));
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
        `Couldn't parse Cflags field into an argument vector: ${error}`
      );
    }

    let i = 0;
    while (i < argv.length) {
      const arg = strdupEscapeShell(argv[i].trim());

      const includeMatch = arg.match(/^-I\s*(.*)$/);
      if (includeMatch) {
        const flag = new Flag(FlagType.CFLAGS_I, [includeMatch[1]]);
        this.cflags.push(flag);
      } else if (
        (arg === "-idirafter" || arg === "-isystem") &&
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

  private trimAndSub(str: string, _path: string): string {
    // TODO trim and sub
    return str.trim();
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

  let line = "";

  while (true) {
    const c = file.getc();
    if (!c /* EOF */) {
      if (quoted) line += "\\";
      return line;
    }

    if (quoted) {
      quoted = false;

      switch (c) {
        case "#":
          line += "#";
          break;
        case "\r":
        case "\n":
          const nextC = file.getc();

          if (
            !(
              //!c || <-- pkg-config bug
              (
                !nextC ||
                (c === "\r" && nextC === "\n") ||
                (c === "\n" && nextC === "\r")
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
        case "#":
          comment = true;
          break;
        case "\\":
          if (!comment) quoted = true;
          break;
        case "\n":
          const nextC = file.getc();
          if (
            !(
              //!c || // <-- pkg-config bug
              //(c === "\r" && nextC === "\n") || <-- pkg-config bug
              (!nextC || (c === "\n" && nextC === "\r"))
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
