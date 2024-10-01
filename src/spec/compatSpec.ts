import { expect } from "chai";
import { resolve, sep } from "node:path";
import { SpawnOptions, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { PkgConfig } from "../index";

describe("pkg-config", () => {
  let exe: PkgExe;
  let pkg: PkgConfig;

  beforeEach(() => {
    exe = new PkgExe();
    exe.searchPaths.push(resolve("test"));

    pkg = new PkgConfig({
      searchPaths: [resolve("test")],
    });
  });

  async function expectCflags(
    names: string[],
    cflags: string[]
  ): Promise<void> {
    const proof = await exe.cflags(names);
    const actual = await pkg.cflags(names);
    expect(cflags).to.deep.equal(
      proof,
      "The given cflags did not match the reference pkg-config behavior"
    );
    expect(actual).to.deep.equal(
      cflags,
      "The PkgConfig implementation did not match the expected cflags"
    );
  }

  describe("cflags", () => {
    it("gets basic flags from pc file", async () => {
      await expectCflags(["cflags-abc"], ["-a", "-b", "-c"]);
    });

    it("finds a module identified by filename", async () => {
      await expectCflags(["test/cflags-abc.pc"], ["-a", "-b", "-c"]);
    });

    it("strips comments from flags", async () => {
      await expectCflags(["cflags-comment"], ["--no-comment"]);
    });

    // TODO is this breaking change? Is it ok to not go through shell eval? Expansion etc
    it("handles many escape chars in pkg file", async () => {
      await expectCflags(
        ["cflags-shell-esc"],
        [
          "-a b",
          "hello#world",
          "--line-feed",
          "--carriage-return",
          "--crlf",
          "--lfcr",
          "--single quote\\",
          '--double "quote',
          "--escape\\ space",
        ]
      );
    });

    it("does not repeat flags for a repeated module", async () => {
      await expectCflags(["cflags-abc", "cflags-abc"], ["-a", "-b", "-c"]);
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
    describe("prefers the last specified filename", () => {
      it("with filename second", async () => {
        await expectCflags(
          ["overloaded", "test/subdir/overloaded.pc"],
          ["--subdir-flags"]
        );
      });

      it("with filename first", async () => {
        await expectCflags(
          ["test/subdir/overloaded.pc", "overloaded"],
          ["--subdir-flags"]
        );
      });

      it("with two filenames one way", async () => {
        await expectCflags(
          ["test/subdir/overloaded.pc", "test/overloaded.pc"],
          ["--default-flags"]
        );
      });

      it("with two filenames the other way", async () => {
        await expectCflags(
          ["test/overloaded.pc", "test/subdir/overloaded.pc"],
          ["--subdir-flags"]
        );
      });
    });
  });
});

class PkgExe {
  exe: string;
  searchPaths: string[] = [];

  constructor() {
    this.exe = resolve("pkg-config/pkg-config");
  }

  private async spawn(args: string[]): Promise<string> {
    return spawnAsync(this.exe, args, {
      env: {
        PKG_CONFIG_PATH: this.searchPaths.join(sep),
      },
    });
  }

  async cflags(names: string[]): Promise<string[]> {
    const pkgOut = await this.spawn(["--cflags", ...names]);
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
  stream.on("data", (chunk) => {
    chunks.push(chunk);
  });
  stream.on("error", (err) => reject(err));
  stream.on("close", () => {
    const totalBuf = Buffer.concat(chunks);
    resolve(totalBuf.toString("utf8"));
  });

  return promise;
}

async function spawnAsync(
  exe: string,
  args: string[],
  opts?: SpawnOptions
): Promise<string> {
  const proc = spawn(exe, args, opts);
  const stdout = readStream(proc.stdout);
  const stderr = readStream(proc.stderr);

  const procExit = new Promise<number>((res, rej) => {
    proc.on("exit", (code) => res(code));
    proc.on("error", (err) => rej(err));
  });

  const code = await procExit;
  if (code === 0) {
    return stdout;
  } else {
    const errStr = await stderr;
    throw new Error(
      `Process "${exe}" exited with status '${code}':\n${errStr}`
    );
  }
}

async function shellSplitWords(words: string): Promise<string[]> {
  const script = "process.stdout.write(JSON.stringify(process.argv.slice(1)));";
  const jsonWords = await spawnAsync("/bin/sh", [
    "-c",
    `node -e '${script}' -- ${words}`,
  ]);
  return JSON.parse(jsonWords) as string[];
}
