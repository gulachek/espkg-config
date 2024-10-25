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
