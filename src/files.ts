import { readFile, stat } from 'node:fs/promises';

export class FileStream {
	private contents: string;
	private path: string;
	private pos = 0;

	constructor(path: string) {
		this.path = path;
		this.contents = '';
	}

	public async load(): Promise<void> {
		if (!this.contents) {
			this.contents = await readFile(this.path, 'utf8');
		}
	}

	public eof(): boolean {
		return this.pos >= this.contents.length;
	}

	public getc(): string {
		if (!this.eof()) return this.contents.charAt(this.pos++);
		return '';
	}

	public ungetc(char: string): void {
		if (char !== this.contents.charAt(--this.pos)) {
			/* 1 based character pos in most editors for err msg */
			throw new Error(
				`ungetc(): char "${char}" doesn't match the previously read char at position ${
					this.pos + 1
				} "${this.contents.charAt(this.pos)}"`,
			);
		}
	}
}

export async function isRegularFile(path: string): Promise<boolean> {
	try {
		const st = await stat(path);
		return st.isFile();
	} catch {
		return false;
	}
}
