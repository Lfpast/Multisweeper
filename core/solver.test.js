import { describe, expect, it } from "bun:test";
import { isAmbiguous } from "./solver.js";
import { Tile } from "./tile.js";

/**
 * Helper to create a get function from a 2D array of tiles.
 * @param {import("./tile.js").Tile[][]} tiles
 * @returns {(x: number, y: number) => import("./tile.js").Tile}
 */
const createGet = (tiles) => (x, y) => {
	const row = tiles[x];
	if (!row) throw new Error(`Invalid x coordinate: ${x}`);
	const t = row[y];
	if (!t) throw new Error(`Invalid y coordinate: ${y}`);
	return t;
};

/**
 * Helper to create an isVisible function from a 2D array of booleans.
 * @param {boolean[][]} visible
 * @returns {(x: number, y: number) => boolean}
 */
const createIsVisible = (visible) => (x, y) => {
	const row = visible[x];
	if (!row) return false;
	return !!row[y];
};

describe("Solver (isAmbiguous)", () => {
	it("should return true when game is ambiguous (1-1 pattern on corner)", () => {
		const W = 2;
		const H = 2;
		// Setup:
		// 1 1
		// ? ? (One mine, one empty)

		// Visible: top row
		const visible = [
			[true, false], // x=0: (0,0) visible, (0,1) hidden
			[true, false], // x=1: (1,0) visible, (1,1) hidden
		];

		// Tiles:
		// (0,0)=1, (1,0)=1
		// (0,1)=Mine, (1,1)=Emp
		const tiles = [
			[Tile.Num(1), Tile.Min],
			[Tile.Num(1), Tile.Emp],
		];

		expect(isAmbiguous(W, H, createIsVisible(visible), createGet(tiles))).toBe(
			true,
		);
	});

	it("should return false when game is NOT ambiguous (1-2-1 pattern)", () => {
		const W = 3;
		const H = 2;
		// 1 2 1
		// ? ? ?
		// (0,0)=1, (1,0)=2, (2,0)=1.
		// (0,1)=?, (1,1)=?, (2,1)=?.
		// (1,1) is guaranteed safe.

		const visible = [
			[true, false],
			[true, false],
			[true, false],
		];

		const tiles = [
			[Tile.Num(1), Tile.Min], // x=0
			[Tile.Num(2), Tile.Emp], // x=1
			[Tile.Num(1), Tile.Min], // x=2
		];

		expect(isAmbiguous(W, H, createIsVisible(visible), createGet(tiles))).toBe(
			false,
		);
	});

	it("should return false when a safe tile can be deduced (1-1 pattern with extra neighbor)", () => {
		const W = 3;
		const H = 2;
		// 1 1
		// A B C
		// (0,0)=1, neighbors A(0,1), B(1,1)
		// (1,0)=1, neighbors A(0,1), B(1,1), C(2,1) (Assuming C is neighbor of (1,0))
		// Wait, (1,0) neighbors are (0,0), (2,0), (0,1), (1,1), (2,1).
		// (0,0) and (2,0) are visible (let's say (2,0) is empty/visible).

		// Let's construct:
		// 1 1 .
		// ? ? ?
		// (0,0)=1. Neighbors: (0,1), (1,1). (Ignoring visible ones)
		// (1,0)=1. Neighbors: (0,1), (1,1), (2,1).
		// Constraint 1: (0,1) + (1,1) = 1
		// Constraint 2: (0,1) + (1,1) + (2,1) = 1
		// Implies (2,1) = 0 (Safe).

		const visible = [
			[true, false], // (0,0) visible
			[true, false], // (1,0) visible
			[true, false], // (2,0) visible (Empty/Safe)
		];

		const tiles = [
			[Tile.Num(1), Tile.Min], // (0,1) is Mine (or (1,1))
			[Tile.Num(1), Tile.Emp], // (1,1) is Emp (or Mine)
			[Tile.Emp, Tile.Emp], // (2,1) is Safe
		];
		// Let's make (0,1) the mine.
		// (0,0) sees (0,1) and (1,1). 1 mine. OK.
		// (1,0) sees (0,1), (1,1), (2,1). 1 mine. OK.
		// (2,0) sees (1,1), (2,1). 0 mines.
		// Wait, if (2,0) is Empty and visible, it would have revealed neighbors.
		// So (2,0) cannot be Empty and visible with hidden neighbors unless it's a Number 0?
		// But Tile.Num(0) is invalid.
		// Empty tiles automatically reveal neighbors.
		// So if (2,0) is visible, (1,1) and (2,1) MUST be visible.
		// So this setup is physically impossible in the game engine (flood fill).
		// BUT, the solver just takes `visible` state. It doesn't care if it's reachable.
		// However, let's try to make it realistic.
		// Use a '1' at (2,0) that sees a mine elsewhere? No.

		// Let's just use the solver logic. It doesn't enforce flood fill.
		// We want to test the deduction logic.

		expect(isAmbiguous(W, H, createIsVisible(visible), createGet(tiles))).toBe(
			false,
		);
	});

	it("should return false when no tiles are visible (Safe Start assumption)", () => {
		const W = 2;
		const H = 2;
		const visible = [
			[false, false],
			[false, false],
		];
		const tiles = [
			[Tile.Emp, Tile.Emp],
			[Tile.Emp, Tile.Emp],
		];
		// If no tiles are visible, the game assumes the first click is safe (or at least allowed),
		// so it's not considered "ambiguous" in a way that ends the game.
		expect(isAmbiguous(W, H, createIsVisible(visible), createGet(tiles))).toBe(
			false,
		);
	});

	it("should return false when all non-mine tiles are visible (Game Won state)", () => {
		// Actually isAmbiguous returns false if there are no hidden tiles.
		const W = 1;
		const H = 1;
		const visible = [[true]];
		const tiles = [[Tile.Emp]];
		expect(isAmbiguous(W, H, createIsVisible(visible), createGet(tiles))).toBe(
			false,
		);
	});

	it("should return true if only mines can be deduced but no safe tiles", () => {
		// 1
		// ?
		// (0,0)=1. (0,1)=?.
		// (0,1) MUST be a mine.
		// But isAmbiguous returns true because we can't CLICK safely.
		const W = 1;
		const H = 2;
		const visible = [[true, false]];
		const tiles = [[Tile.Num(1), Tile.Min]];

		expect(isAmbiguous(W, H, createIsVisible(visible), createGet(tiles))).toBe(
			true,
		);
	});
});
