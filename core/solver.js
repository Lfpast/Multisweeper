/** @import { Tile } from "./tile.js" */
import { range } from "es-toolkit";
import { surrounding } from "./board.js";
import { TileMin, TileNum } from "./tile.js";

/**
 * Check if the current state is ambiguous (no safe moves possible).
 * @param {number} w
 * @param {number} h
 * @param {(x: number, y: number) => boolean} isVisible
 * @param {(x: number, y: number) => Tile} get
 * @returns {boolean}
 */
export const isAmbiguous = (w, h, isVisible, get) => {
	const hiddenTileToId = new Map();
	const idToHiddenTile = [];
	const constraints = [];
	let hasVisible = false;

	// 1. Build Constraints
	for (const x of range(w)) {
		for (const y of range(h)) {
			if (isVisible(x, y)) {
				hasVisible = true;
				const t = get(x, y);
				if (t.t === TileNum) {
					const neighbors = surrounding(x, y);
					const hiddenNeighbors = [];
					let minesAround = 0;

					for (const [nx, ny] of neighbors) {
						if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
						if (isVisible(nx, ny)) {
							if (get(nx, ny).t === TileMin) {
								minesAround++;
							}
						} else {
							hiddenNeighbors.push([nx, ny]);
						}
					}

					if (hiddenNeighbors.length > 0) {
						const remainingMines = t.n - minesAround;
						if (remainingMines === 0) return false; // All hidden are safe -> Not ambiguous

						const ids = hiddenNeighbors.map(([hx, hy]) => {
							const key = `${hx},${hy}`;
							if (!hiddenTileToId.has(key)) {
								hiddenTileToId.set(key, idToHiddenTile.length);
								idToHiddenTile.push([hx, hy]);
							}
							return hiddenTileToId.get(key);
						});
						constraints.push({ ids, value: remainingMines });
					}
				}
			}
		}
	}

	if (constraints.length === 0) {
		if (!hasVisible) return false;
		// Check if any hidden tiles exist
		for (const x of range(w)) {
			for (const y of range(h)) {
				if (!isVisible(x, y)) return true; // Hidden tiles but no constraints -> Ambiguous
			}
		}
		return false; // No hidden tiles -> Won (handled by isGameOver)
	}

	// 2. Build Graph for Components
	const numVars = idToHiddenTile.length;
	const adj = Array.from({ length: numVars }, () => []);

	for (const c of constraints) {
		for (let i = 0; i < c.ids.length; i++) {
			for (let j = i + 1; j < c.ids.length; j++) {
				const u = c.ids[i];
				const v = c.ids[j];
				// @ts-expect-error impossible out-of-bounds
				if (!adj[u].includes(v)) adj[u].push(v);
				// @ts-expect-error impossible out-of-bounds
				if (!adj[v].includes(u)) adj[v].push(u);
			}
		}
	}

	const visited = new Array(numVars).fill(false);

	// 3. Solve each component
	for (let i = 0; i < numVars; i++) {
		if (visited[i]) continue;

		/** @type {number[]} */
		const componentVars = [];
		const q = [i];
		visited[i] = true;
		while (q.length > 0) {
			const u = q.pop();
			if (u === undefined) continue;
			componentVars.push(u);
			// @ts-expect-error impossible out-of-bounds
			for (const v of adj[u]) {
				if (!visited[v]) {
					visited[v] = true;
					q.push(v);
				}
			}
		}

		// Filter constraints
		const compConstraints = constraints
			.filter((c) => c.ids.some((id) => componentVars.includes(id)))
			.map((c) => ({
				ids: c.ids
					.filter((id) => componentVars.includes(id))
					.map((id) => componentVars.indexOf(id)),
				value: c.value,
			}));

		// Solver
		/** @type {number[][]} */
		const solutions = [];
		const assignment = new Array(componentVars.length).fill(0);

		/** @type {(idx: number) => void} */
		const solve = (idx) => {
			if (idx === componentVars.length) {
				solutions.push([...assignment]);
				return;
			}

			// Try 0 (Safe)
			assignment[idx] = 0;
			if (check(idx)) solve(idx + 1);

			// Try 1 (Mine)
			assignment[idx] = 1;
			if (check(idx)) solve(idx + 1);
		};

		/** @type {(upto: number) => boolean} */
		const check = (upto) => {
			for (const c of compConstraints) {
				let sum = 0;
				let unassigned = 0;
				for (const vid of c.ids) {
					if (vid <= upto) sum += assignment[vid];
					else unassigned++;
				}
				if (sum > c.value) return false;
				if (sum + unassigned < c.value) return false;
			}
			return true;
		};

		solve(0);

		if (solutions.length === 0) continue;

		// Check for safe tiles
		for (let j = 0; j < componentVars.length; j++) {
			let alwaysSafe = true;
			for (const sol of solutions) {
				if (sol[j] === 1) {
					alwaysSafe = false;
					break;
				}
			}
			if (alwaysSafe) return false; // Found a safe tile -> Not ambiguous
		}
	}

	return true; // No safe tiles found in any component
};
