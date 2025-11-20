import { beforeEach, describe, expect, it } from "bun:test";
import { create, Tile, TileHidden, TileMin } from "./game.js";

describe("Tile Definitions", () => {
    it("should have correct symbols", () => {
        expect(Tile.Emp.t.description).toBe("Empty Tile");
        expect(Tile.Min.t.description).toBe("Mine Tile");
    });

    it("should create number tiles correctly", () => {
        const tile = Tile.Num(3);
        expect(tile.t.description).toBe("Number Tile");
        expect(tile.n).toBe(3);
    });

    it("should throw error for invalid number tiles", () => {
        expect(() => Tile.Num(0)).toThrow(RangeError);
        expect(() => Tile.Num(9)).toThrow(RangeError);
    });
});

describe("Game Factory", () => {
    it("should create a game with valid dimensions", () => {
        const game = create(10, 20);
        expect(game).toBeDefined();
    });

    it("should throw TypeError for non-integer dimensions", () => {
        expect(() => create(10.5, 10)).toThrow(TypeError);
        expect(() => create(10, 10.5)).toThrow(TypeError);
    });

    it("should throw RangeError for non-positive dimensions", () => {
        expect(() => create(0, 10)).toThrow(RangeError);
        expect(() => create(10, -1)).toThrow(RangeError);
    });
});

describe("Game Instance", () => {
    /** @type {import("./game.js").Game} */
    let game;
    const W = 10;
    const H = 10;

    beforeEach(() => {
        game = create(W, H);
    });

    describe("Basic Access", () => {
        it("should initialize with hidden tiles", () => {
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    expect(game.apply(x, y)).toBe(TileHidden);
                }
            }
        });

        it("should get empty tiles by default", () => {
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    expect(game.get(x, y)).toBe(Tile.Emp);
                }
            }
        });

        it("should set and get tiles", () => {
            game.set(0, 0, Tile.Min);
            expect(game.get(0, 0)).toBe(Tile.Min);
        });

        it("should throw on out of bounds access", () => {
            expect(() => game.get(-1, 0)).toThrow(RangeError);
            expect(() => game.get(W, 0)).toThrow(RangeError);
            expect(() => game.set(0, H, Tile.Min)).toThrow(RangeError);
            expect(() => game.apply(W, H)).toThrow(RangeError);
        });
    });

    describe("Initialization (init)", () => {
        it("should place mines and numbers correctly on square board", () => {
            const minesCount = 5;
            game.init(minesCount, 0, 0);

            let mineFound = 0;
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    if (game.get(x, y).t === TileMin) {
                        mineFound++;
                    }
                }
            }
            expect(mineFound).toBe(minesCount);
        });

        it("should place mines and numbers correctly on non-square board", () => {
            const W2 = 3;
            const H2 = 10;
            const game2 = create(W2, H2);
            const minesCount = 5;
            game2.init(minesCount, 0, 0);

            let mineFound = 0;
            for (let x = 0; x < W2; x++) {
                for (let y = 0; y < H2; y++) {
                    if (game2.get(x, y).t === TileMin) {
                        mineFound++;
                    }
                }
            }
            expect(mineFound).toBe(minesCount);
        });

        it("should not place mine at safe coordinates", () => {
            const minesCount = 24; // Almost full board (5x5=25, max mines=24)
            const W3 = 5;
            const H3 = 5;
            const game3 = create(W3, H3);
            const safeX = 2;
            const safeY = 2;
            
            game3.init(minesCount, safeX, safeY);

            expect(game3.get(safeX, safeY).t).not.toBe(TileMin);
            // All others should be mines
            for (let x = 0; x < W3; x++) {
                for (let y = 0; y < H3; y++) {
                    if (x === safeX && y === safeY) continue;
                    expect(game3.get(x, y).t).toBe(TileMin);
                }
            }
        });

        it("should work with 0 mines", () => {
            game.init(0, 0, 0);
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    expect(game.get(x, y)).toBe(Tile.Emp);
                }
            }
        });

        it("should work with max mines (all but one)", () => {
            const maxMines = W * H - 1;
            game.init(maxMines, 0, 0);
            expect(game.get(0, 0)).not.toBe(Tile.Min);
            let mineCount = 0;
            for (let x = 0; x < W; x++) {
                for (let y = 0; y < H; y++) {
                    if (game.get(x, y).t === TileMin) mineCount++;
                }
            }
            expect(mineCount).toBe(maxMines);
        });

        it("should throw TypeError for non-integer mine count", () => {
            expect(() => game.init(5.5, 0, 0)).toThrow(TypeError);
        });

        it("should throw RangeError for invalid mine count", () => {
            expect(() => game.init(-1, 0, 0)).toThrow(RangeError);
            expect(() => game.init(W * H, 0, 0)).toThrow(RangeError);
        });

        it("should throw RangeError for invalid safe coordinates", () => {
            expect(() => game.init(5, -1, 0)).toThrow(RangeError);
            expect(() => game.init(5, W, 0)).toThrow(RangeError);
        });
    });

    describe("Gameplay (reveal)", () => {
        it("should reveal tiles", () => {
            game.set(0, 0, Tile.Min);
            game.reveal(0, 0);
            expect(game.apply(0, 0)).toBe(Tile.Min);
        });

        it("should notify observers on reveal", () => {
            /** @type {[number, number][]} */
            const changes = [];
            const dispose = game.observe((cs) => {
                changes.push(...cs);
            });

            game.reveal(0, 0);
            expect(changes.length).toBeGreaterThan(0);
            expect(changes).toContainEqual([0, 0]);

            dispose();
        });

        it("should stop notifying after dispose", () => {
            let callCount = 0;
            const dispose = game.observe(() => {
                callCount++;
            });

            game.reveal(0, 0);
            expect(callCount).toBe(1);

            dispose();
            game.reveal(1, 1);
            expect(callCount).toBe(1);
        });

        it("should flood reveal empty tiles", () => {
            const W = 3;
            const H = 3;
            const game = create(W, H);

            // Setup board manually
            game.set(2, 2, Tile.Min);
            game.set(1, 1, Tile.Num(1));
            game.set(1, 2, Tile.Num(1));
            game.set(2, 1, Tile.Num(1));

            // Reveal top-left corner
            game.reveal(0, 0);

            // Check that the mine is still hidden
            expect(game.apply(2, 2)).toBe(TileHidden);

            // Check that numbers are revealed
            expect(game.apply(1, 1)).not.toBe(TileHidden);
            expect(game.apply(1, 2)).not.toBe(TileHidden);
            expect(game.apply(2, 1)).not.toBe(TileHidden);

            // Check that empty tiles are revealed
            expect(game.apply(0, 0)).toBe(Tile.Emp);
            expect(game.apply(0, 1)).toBe(Tile.Emp);
            expect(game.apply(0, 2)).toBe(Tile.Emp);
            expect(game.apply(1, 0)).toBe(Tile.Emp);
            expect(game.apply(2, 0)).toBe(Tile.Emp);
        });

        it("should stop flood fill at numbers", () => {
            const W = 5;
            const H = 5;
            const game = create(W, H);

            // Wall of mines at row 2
            for (let x = 0; x < W; x++) {
                game.set(x, 2, Tile.Min);
            }
            // Set numbers for row 1 and 3
            for (let x = 0; x < W; x++) {
                game.set(x, 1, Tile.Num(1));
                game.set(x, 3, Tile.Num(1));
            }

            // Reveal (0, 0)
            game.reveal(0, 0);

            // Row 0 should be revealed (Empty)
            for (let x = 0; x < W; x++) {
                expect(game.apply(x, 0)).toBe(Tile.Emp);
            }
            // Row 1 should be revealed (Numbers)
            for (let x = 0; x < W; x++) {
                expect(game.apply(x, 1)).not.toBe(TileHidden);
                expect(game.apply(x, 1)).not.toBe(Tile.Emp);
            }

            // Row 2 (Mines) should be hidden
            for (let x = 0; x < W; x++) {
                expect(game.apply(x, 2)).toBe(TileHidden);
            }
        });
    });
});
