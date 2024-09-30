import { CharPtr } from "./CharPtr";

export interface GParseArgvResult {
  error?: string;
  argv: string[];
}

export function gShellParseArgv(cmdLine: string): GParseArgvResult {
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

  if (result.argv.length < 1) {
    result.error = `Text was empty (or contained only whitespace)`;
    return result;
  }

  return result;
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
          s.advance();
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
        s.advance();
      }
    }
  }

  dest.setChar("\0");
  end.copyFrom(s);
  return "Unmatched quotation mark in command line or other shell-quoted text";
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
