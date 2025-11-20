import { describe, expect, it } from "bun:test";
import { Tile, TileHidden } from "./tile.js";

describe("Tile Definitions", () => {
	it("should have correct symbols", () => {
		expect(Tile.Emp.t.description).toBe("Empty Tile");
		expect(Tile.Min.t.description).toBe("Mine Tile");
		expect(TileHidden.description).toBe("Hidden Tile");
	});

	it("should create number tiles correctly", () => {
		const tile = Tile.Num(3);
		expect(tile.t.description).toBe("Number Tile");
		expect(tile.n).toBe(3);
	});

	it("should throw error for invalid number tiles", () => {
		expect(() => Tile.Num(0)).toThrow(RangeError);
		expect(() => Tile.Num(9)).toThrow(RangeError);
		expect(() => Tile.Num(-1)).toThrow(RangeError);
		expect(() => Tile.Num(100)).toThrow(RangeError);
	});

	it("should be immutable", () => {
		expect(Object.isFrozen(Tile)).toBe(true);
		expect(() => {
			// @ts-expect-error testing immutability
			Tile.NewProp = 1;
		}).toThrow();
	});
});
