/**
 * @type {unique symbol}
 * @typedef {{t: typeof TileEmp}} TileEmp
 */
export const TileEmp = Symbol("Empty Tile");
/**
 * @type {unique symbol}
 * @typedef {{t: typeof TileMin}} TileMin
 */
export const TileMin = Symbol("Mine Tile");

/**
 * @type {unique symbol}
 * @typedef {{t: typeof TileNum, n: number}} TileNum
 */
export const TileNum = Symbol("Number Tile");

/**
 * @type {unique symbol}
 * @typedef {typeof TileHidden} TileHidden
 */
export const TileHidden = Symbol("Hidden Tile");

/** @typedef {TileEmp | TileMin | TileNum} Tile */

export const Tile = Object.freeze({
	/** @type {TileEmp} */
	Emp: {
		t: TileEmp,
	},
	/** @type {TileMin} */
	Min: {
		t: TileMin,
	},
	/** @type {(n: number) => TileNum} */
	Num: (n) => {
		if (n <= 0 || n >= 9) {
			throw new RangeError(
				`The number ${n} in a number tile must be between 1 and 8`,
			);
		}
		return {
			t: TileNum,
			n,
		};
	},
});
