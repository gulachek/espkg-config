export class CharPtr {
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
