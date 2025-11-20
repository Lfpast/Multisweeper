import { range, sampleSize } from "es-toolkit";
import { Board, board, surrounding } from "./board.js";
import { isAmbiguous } from "./solver.js";
import { Tile, TileEmp, TileHidden, TileMin } from "./tile.js";

/** @typedef {(cs: [number, number][]) => void} Observer */

export class Game {
	/** @type {Board} */
	board;
	/** @type {[number, number][]} */
	#changes = [];
	/** @type {Observer[]} */
	observers = [];

	/**
	 * Create a game board.
	 * @param {number} w
	 * @param {number} h
	 */
	constructor(w, h) {
		this.board = new Board(w, h);
	}

	/**
	 * Inserts an observer that is called when the board changes.
	 * @param {Observer} observer
	 * @returns {() => void} a function to remove the observer
	 */
	observe(observer) {
		this.observers.push(observer);
		return () => {
			const index = this.observers.indexOf(observer);
			if (index !== -1) {
				this.observers.splice(index, 1);
			}
		};
	}

	/** @param {...[number, number]} cs */
	#accumulate(...cs) {
		this.#changes.push(...cs);
	}

	#notify() {
		if (this.#changes.length > 0) {
			const cs = this.#changes.splice(0, this.#changes.length);
			for (const observer of this.observers) {
				observer(cs);
			}
		}
	}

	/**
	 * Initialize the game board randomly.
	 * @param {number} c the count of mines
	 * @param {number} sx the safe x coordinate
	 * @param {number} sy the safe y coordinate
	 */
	init(c, sx, sy) {
		const w = this.board.w;
		const h = this.board.h;
		if (!Number.isInteger(c))
			throw new TypeError(`Count must be an integer, got ${c}`);
		if (c < 0 || c >= w * h) {
			throw new RangeError(
				`Mine count ${c} must be between 0 and ${w * h - 1} for board of size ${w}x${h}`,
			);
		}
		if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
			throw new RangeError(
				`Safe coordinates (${sx}, ${sy}) out of bounds for board of size (${w}, ${h})`,
			);
		}

		/** @type {[number, number][]} */
		const coordinates = range(w * h).map((n) => [n % w, Math.floor(n / w)]);
		/** @type {[number, number][]} */
		const safeCoordinates = coordinates.filter(
			([x, y]) => !(x === sx && y === sy),
		);
		/** @type {[number, number][]} */
		const mines = sampleSize(safeCoordinates, c);

		// setup tiles of mine
		for (const [mx, my] of mines) {
			this.board.set(mx, my, Tile.Min);
		}

		// setup tiles of number
		for (const [x, y] of board(w, h)) {
			if (this.board.get(x, y).t === TileMin) continue;
			let n = 0;
			for (const [xx, yy] of surrounding(x, y)) {
				if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
				if (this.board.get(xx, yy).t === TileMin) {
					n++;
				}
			}
			if (n > 0) {
				this.board.set(x, y, Tile.Num(n));
			}
		}
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 */
	revealRec(x, y) {
		const w = this.board.w;
		const h = this.board.h;
		this.board.setVisible(x, y, true);
		this.#accumulate([x, y]);

		const t = this.board.get(x, y);
		if (t.t === TileEmp) {
			for (const [xx, yy] of surrounding(x, y)) {
				if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
				if (this.board.apply(xx, yy) === TileHidden) {
					this.revealRec(xx, yy);
				}
			}
		}
	}

	/**
	 * Reveal the {@link Tile} at (x, y) so that it becomes visible. Throw {@link RangeError} if out of bounds.
	 * Note that this function performs flood fill according to Minesweeper rules.
	 * @param {number} x
	 * @param {number} y
	 */
	reveal(x, y) {
		this.revealRec(x, y);
		this.#notify();
	}

	/**
	 * Check if the game is over.
	 * The game is over if a mine is revealed (Loss) or if all non-mine tiles are revealed (Win).
	 * @returns {"GAMING" | "LOSS" | "WIN"}
	 */
	isGameOver() {
		let win = true;
		for (const [x, y] of board(this.board.w, this.board.h)) {
			const { t } = this.board.get(x, y);
			const v = this.board.isVisible(x, y);
			if (v && t === TileMin) {
				return "LOSS";
			}
			if (!v && t !== TileMin) {
				win = false;
			}
		}
		if (
			win ||
			isAmbiguous(
				this.board.w,
				this.board.h,
				this.board.isVisible.bind(this.board),
				this.board.get.bind(this.board),
			)
		) {
			return "WIN";
		}
		return "GAMING";
	}

	/**
	 * Apply the board as a function. This function returns the {@link Tile} at (x, y) if it is visible,
	 * otherwise it returns {@link TileHidden}. Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @returns {Tile | TileHidden}
	 */
	apply(x, y) {
		return this.board.apply(x, y);
	}

	/**
	 * Get the {@link Tile} at (x, y). Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @returns {Tile}
	 */
	get(x, y) {
		return this.board.get(x, y);
	}

	/**
	 * Set the {@link Tile} at (x, y) to type t. Throw {@link RangeError} if out of bounds.
	 * @param {number} x
	 * @param {number} y
	 * @param {Tile} t
	 */
	set(x, y, t) {
		this.board.set(x, y, t);
	}
}
