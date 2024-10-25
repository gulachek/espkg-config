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

export class CharPtr {
	private i: number = 0;
	private chars: string[] = [];

	public constructor(str?: string) {
		str = str || '';

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

	public slice(n: number): string {
		let i = this.i;
		while (i < this.chars.length && i - this.i < n && this.chars[i] !== '\0') {
			++i;
		}

		return this.chars.slice(this.i, i).join('');
	}

	public ptrdiff(rhsOther: CharPtr): number {
		if (this.chars !== rhsOther.chars) {
			throw new Error(
				"Invalid ptrdiff operation. Pointers don't share a common base",
			);
		}

		return this.i - rhsOther.i;
	}

	public setChar(c: string): void {
		if (c.length !== 1) {
			throw new Error(
				`Expected setChar to have argument of string of length 1 (given "${c}")`,
			);
		}

		if (this.i < 0 || this.i > this.chars.length) {
			throw new Error(`setChar setting out of bounds (given '${c}')`);
		}

		if (this.i === this.chars.length && c !== '\0') {
			throw new Error(
				`setChar setting non-null character '${c}' in place of null-terminator`,
			);
		}

		this.chars[this.i] = c;
	}

	public copyFrom(other: CharPtr): void {
		this.chars = other.chars;
		this.i = other.i;
	}

	public deref(offset?: number): string {
		const o = typeof offset === 'undefined' ? 0 : offset;
		const i = this.i + o;

		if (i < 0 || i > this.chars.length)
			throw new Error(
				'This is a bug with espkg-config. CharPtr offset out of bounds',
			);

		if (i < this.chars.length) {
			const c = this.chars[i];
			if (c === '\0') return '';

			return c;
		}

		return '';
	}

	public advance(): void {
		++this.i;
	}

	public get pos(): number {
		return this.i;
	}

	public toString(): string {
		const nullIndex = this.chars.indexOf('\0', this.i);
		if (nullIndex === -1) {
			return this.chars.slice(this.i).join('');
		} else {
			return this.chars.slice(this.i, nullIndex).join('');
		}
	}
}
