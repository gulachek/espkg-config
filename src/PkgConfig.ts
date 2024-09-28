import { join, basename, dirname } from "node:path";
import { readFile, stat } from "node:fs/promises";

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
      const req = await this.getPackage(name);

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

  private async getPackage(name: string): Promise<Package | null> {
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
        const un = await this.getPackage(name + uninstalled);

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

    if (!location) return null;

    pkg = await this.parsePackageFile(key, location);

    if (!pkg) return null;

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
    while (true) {
      const line = await readOneLine(file);
      if (!line) return pkg;

      pkg.parseLine(line, path);
    }
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
    // TODO error if already defined cflags
    const trimmed = this.trimAndSub(str, path);

    const { error, argv } = gShellParseArgv(trimmed);
    if (error) {
      // TODO handle error
      throw new Error(error);
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

class FileStream {
  private contents: string;
  private path: string;
  private pos = 0;

  constructor(path: string) {
    this.path = path;
    this.contents = "";
  }

  async load(): Promise<void> {
    if (!this.contents) {
      this.contents = await readFile(this.path, "utf8");
    }
  }

  getc(): string {
    if (this.pos < this.contents.length)
      return this.contents.charAt(this.pos++);

    return "";
  }

  ungetc(char: string): void {
    if (char !== this.contents.charAt(--this.pos)) {
      /* 1 based character pos in most editors for err msg */
      throw new Error(
        `ungetc(): char "${char}" doesn't match the previously read char at position ${
          this.pos + 1
        } "${this.contents.charAt(this.pos)}"`
      );
    }
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}

interface GParseArgvResult {
  error?: string;
  argv: string[];
}

function tokenizeCommandLine(cmdLine: string): GParseArgvResult {
  let currentQuote = ""; // this is like reference having '\0'
  let quoted = false;
  let currentToken = new Token();
  const result: GParseArgvResult = {
    argv: [],
  };

  let retval: string[] = result.argv;
  const p = new CharPtr(cmdLine);

  while (p.deref()) {
    if (currentQuote === "\\") {
      if (p.deref() !== "\n") {
        currentToken.ensure();
        currentToken.append("\\" + p.deref());
      }

      currentQuote = "";
    } else if (currentQuote === "#") {
      while (p.deref() && p.deref() !== "\n") p.advance();

      currentQuote = "";

      if (!p.deref()) break;
    } else if (currentQuote) {
      if (p.deref() === currentQuote && !(currentQuote === '"' && quoted)) {
        currentQuote = "";
      }

      currentToken.ensure();
      currentToken.append(p.deref());
    } else {
      switch (p.deref()) {
        case "\n":
          currentToken.delimit(retval);
          break;
        case " ":
        case "\t":
          if (currentToken.exists && currentToken.len > 0)
            currentToken.delimit(retval);
          break;
        case "'":
        case '"':
          currentToken.ensure();
          currentToken.append(p.deref());
        case "\\":
          currentQuote = p.deref();
          break;
        case "#":
          if (p.pos === 0) {
            currentQuote = p.deref();
            break;
          }
          switch (p.deref(-1)) {
            case " ":
            case "\n":
            case "":
              currentQuote = p.deref();
              break;
            default:
              currentToken.ensure();
              currentToken.append(p.deref());
              break;
          }
          break;
        default:
          currentToken.ensure();
          currentToken.append(p.deref());
          break;
      }
    }

    if (p.deref() !== "\\") quoted = false;
    else quoted = !quoted;

    p.advance();
  }

  currentToken.delimit(retval);

  if (currentQuote) {
    if (currentQuote === "\\")
      result.error = `Text ended just after a '\\' character. (The text was '${cmdLine}')`;
    else
      result.error = `Text ended before matching quote was found for ${currentQuote}. (The text was '${cmdLine}')`;

    return result;
  }

  if (result.argv.length < 0) {
    result.error = `Text was empty (or contained only whitespace)`;
    return result;
  }

  return result;
}

function gShellParseArgv(cmdLine: string): GParseArgvResult {
  const tokenResult = tokenizeCommandLine(cmdLine);
  if (tokenResult.argv.length < 1) return tokenResult;

  const argv: string[] = [];

  const tokens = tokenResult.argv;
  for (const tok of tokens) {
    const { result, error } = gShellUnquote(tok);
    if (error) return { argv: [], error };

    argv.push(result);
  }

  return {
    argv,
  };
}

function gShellUnquote(qString: string): { result: string; error?: string } {
  let start = new CharPtr(qString);
  const end = new CharPtr(qString);
  let retval = "";

  while (start.deref()) {
    while (start.deref() && !(start.deref() === '"' || start.deref() === "'")) {
      if (start.deref() === "\\") {
        start.advance();
        if (start.deref()) {
          if (start.deref() !== "\n") retval += start.deref();
          start.advance();
        }
      } else {
        retval += start.deref();
        start.advance();
      }
    }

    if (start.deref()) {
      const error = unquoteStringInplace(start, end);
      if (error) {
        return { result: "", error };
      } else {
        retval += start.toString();
        start = end;
      }
    }
  }

  return { result: retval };
}

function unquoteStringInplace(str: CharPtr, end: CharPtr): string {
  const dest = str.dup();
  const s = str.dup();
  const quoteChar = s.deref();

  if (!(s.deref() === '"' || s.deref() === "'")) {
    end.copyFrom(str);
    return "Quoted text doesn't begin with a quotation mark";
  }

  s.advance();

  if (quoteChar === '"') {
    while (s.deref()) {
      switch (s.deref()) {
        case '"':
          dest.setChar("\0");
          s.advance();
          end.copyFrom(s);
          return "";

        case "\\":
          s.advance();
          switch (s.deref()) {
            case '"':
            case "\\":
            case "`":
            case "$":
            case "\n":
              dest.setChar(s.deref());
              s.advance();
              dest.advance();
              break;

            default:
              dest.setChar("\\");
              dest.advance();
              break;
          }
          break;

        default:
          dest.setChar(s.deref());
          dest.advance();
          dest.advance();
          break;
      }
    }
  } else {
    while (s.deref()) {
      if (s.deref() === "'") {
        dest.setChar("\0");
        s.advance();
        end.copyFrom(s);
        return "";
      } else {
        dest.setChar(s.deref());
        dest.advance();
        dest.advance();
      }
    }
  }

  dest.setChar("\0");
  end.copyFrom(s);
  return "Unmatched quotation mark in command line or other shell-quoted text";
}

function strdupEscapeShell(str: string): string {
  return str;
}

class CharPtr {
  private i: number = 0;
  private chars: string[] = [];

  public constructor(str?: string) {
    str = str || "";

    for (let i = 0; i < str.length; ++i) {
      this.chars.push(str.charAt(i));
    }
  }

  public dup(): CharPtr {
    const out = new CharPtr();
    out.chars = this.chars;
    out.i = this.i;
    return out;
  }

  public setChar(c: string): void {
    if (c.length !== 1) {
      throw new Error(
        "Expected setChar to have argument of string of length 1"
      );
    }

    if (this.i < 0 || this.i >= this.chars.length) {
      throw new Error("setChar setting out of bounds");
    }
  }

  public copyFrom(other: CharPtr): void {
    this.chars = other.chars;
    this.i = other.i;
  }

  public deref(offset?: number): string {
    let o = typeof offset === "undefined" ? 0 : offset;
    let i = this.i + o;

    if (i < 0 || i > this.chars.length)
      throw new Error(
        "This is a bug with espkg-config. CharPtr offset out of bounds"
      );

    if (i < this.chars.length) {
      const c = this.chars[i];
      if (c === "\0") return "";

      return c;
    }

    return "";
  }

  public advance(): void {
    ++this.i;
  }

  public get pos(): number {
    return this.i;
  }

  public toString(): string {
    const nullIndex = this.chars.indexOf("\0", this.i);
    if (nullIndex === -1) {
      return this.chars.slice(this.i).join("");
    } else {
      return this.chars.slice(this.i, nullIndex).join("");
    }
  }
}

class Token {
  private str = "";
  private _exists = false;

  public ensure(): void {
    this._exists = true;
  }

  public delimit(retval: string[]): void {
    if (!this._exists) return;

    retval.push(this.str);

    this.str = "";
    this._exists = false;
  }

  public append(s: string): void {
    if (!this._exists) throw new Error("Token hasn't been allocated");
    this.str += s;
  }

  public get exists(): boolean {
    return this._exists;
  }

  public get len(): number {
    return this.str.length;
  }
}
