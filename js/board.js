'use strict';

/* ---------------------------------------------------------------------------
 * Board — the crate's contents.
 *
 * The grid is padded by one cell on every side. Playable cells are
 * rows 1..rows and cols 1..cols; the padding is always empty and exists so the
 * pathfinder can route a link "outside" the crate without special cases.
 * ------------------------------------------------------------------------- */
class Board {
    constructor() {
        this.rows = 0;
        this.cols = 0;
        this.mode = 1;
        this.grid = [];
    }

    /* ── Setup ─────────────────────────────────────────────────────────── */

    reset(cols, rows, fruitIds, mode = 1) {
        this.cols = cols;
        this.rows = rows;
        this.mode = mode;

        const total = rows * cols;
        let emptyCount = Math.max(2, Math.round(total * CONFIG.emptyRatio));
        let fill = total - emptyCount;
        if (fill % 2 !== 0) fill -= 1;           // every fruit must have a partner
        emptyCount = total - fill;

        // Build a paired deck from a shuffled pool. Cycling the pool keeps
        // every fruit in roughly equal supply regardless of grid size.
        const pool = Util.shuffle(fruitIds.slice());
        const deck = [];
        for (let i = 0; i < fill / 2; i++) {
            const id = pool[i % pool.length];
            deck.push(id, id);
        }
        Util.shuffle(deck);

        // Scatter the deck across the crate, leaving empty routing pockets.
        const cells = [];
        for (let row = 1; row <= rows; row++) {
            for (let col = 1; col <= cols; col++) cells.push({ row, col });
        }
        Util.shuffle(cells);

        this.grid = Array.from({ length: rows + 2 }, () =>
            new Array(cols + 2).fill(null)
        );

        for (let i = 0; i < fill; i++) {
            const { row, col } = cells[i];
            this.grid[row][col] = deck[i];
        }

        return { cells: total, tiles: fill, empties: emptyCount };
    }

    /* ── Queries ───────────────────────────────────────────────────────── */

    get(row, col) {
        return this.grid[row]?.[col] ?? null;
    }

    isEmpty(row, col) {
        return !this.get(row, col);
    }

    inBounds(row, col) {
        return row >= 1 && row <= this.rows && col >= 1 && col <= this.cols;
    }

    remaining() {
        let count = 0;
        for (let row = 1; row <= this.rows; row++) {
            for (let col = 1; col <= this.cols; col++) {
                if (this.grid[row][col]) count++;
            }
        }
        return count;
    }

    occupiedCells() {
        const cells = [];
        for (let row = 1; row <= this.rows; row++) {
            for (let col = 1; col <= this.cols; col++) {
                if (this.grid[row][col]) cells.push({ row, col });
            }
        }
        return cells;
    }

    /* ── Mutations ─────────────────────────────────────────────────────── */

    /**
     * Remove a matched pair and let gravity re-settle the crate.
     * Returns the tiles that moved so the renderer can animate the fall.
     */
    removePair(a, b) {
        this.grid[a.row][a.col] = null;
        this.grid[b.row][b.col] = null;
        return this.applyGravity();
    }

    applyGravity() {
        const moves = [];

        if (this.mode === 2) {
            // Down: compact each column towards the bottom edge.
            for (let col = 1; col <= this.cols; col++) {
                const stack = [];
                for (let row = 1; row <= this.rows; row++) {
                    const id = this.grid[row][col];
                    if (id) stack.push({ id, fromRow: row });
                }
                const empty = this.rows - stack.length;
                for (let row = 1; row <= this.rows; row++) {
                    const tile = row <= empty ? null : stack[row - empty - 1];
                    this.grid[row][col] = tile ? tile.id : null;
                    if (tile && tile.fromRow !== row) {
                        moves.push({ row, col, fromRow: tile.fromRow, id: tile.id });
                    }
                }
            }
        } else if (this.mode === 3) {
            // Left: compact each row towards the left edge.
            for (let row = 1; row <= this.rows; row++) {
                const stack = [];
                for (let col = 1; col <= this.cols; col++) {
                    const id = this.grid[row][col];
                    if (id) stack.push({ id, fromCol: col });
                }
                for (let col = 1; col <= this.cols; col++) {
                    const tile = stack.shift();
                    this.grid[row][col] = tile ? tile.id : null;
                    if (tile && tile.fromCol !== col) {
                        moves.push({ row, col, fromCol: tile.fromCol, id: tile.id });
                    }
                }
            }
        }

        return moves;
    }

    /**
     * Reshuffle the remaining tiles in place. Random attempts come first; if
     * they keep producing dead boards, a guaranteed link is planted.
     */
    shuffle(pathfinder) {
        const cells = this.occupiedCells();
        if (cells.length < 2) return true;

        const values = cells.map(cell => this.grid[cell.row][cell.col]);
        const attempts = 80;

        for (let attempt = 0; attempt < attempts; attempt++) {
            Util.shuffle(values);
            cells.forEach((cell, index) => {
                this.grid[cell.row][cell.col] = values[index];
            });
            if (pathfinder.findAnyMatch(this.grid, this.rows, this.cols)) return true;
        }

        this._plantGuaranteedMatch();
        return Boolean(pathfinder.findAnyMatch(this.grid, this.rows, this.cols));
    }

    _plantGuaranteedMatch() {
        const occupied = this.occupiedCells();
        if (occupied.length < 2) return;

        const id = this._mostCommonId();
        if (!id) return;

        // 1) Adjacent occupied cells always connect with zero turns.
        const keys = new Set(occupied.map(cell => `${cell.row},${cell.col}`));
        for (const cell of occupied) {
            const right = { row: cell.row, col: cell.col + 1 };
            const below = { row: cell.row + 1, col: cell.col };
            if (cell.col < this.cols && keys.has(`${right.row},${right.col}`)) {
                this._forcePairAt(id, cell, right);
                return;
            }
            if (cell.row < this.rows && keys.has(`${below.row},${below.col}`)) {
                this._forcePairAt(id, cell, below);
                return;
            }
        }

        // 2) Very sparse board: slide one copy next to another one.
        const copies = occupied.filter(cell => this.grid[cell.row][cell.col] === id);
        if (copies.length < 2) return;
        const anchor = copies[0];
        const mover = copies[1];

        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dr, dc] of directions) {
            const target = { row: anchor.row + dr, col: anchor.col + dc };
            if (!this.inBounds(target.row, target.col)) continue;
            if (this.grid[target.row][target.col]) continue;
            this.grid[mover.row][mover.col] = null;
            this.grid[target.row][target.col] = id;
            return;
        }
    }

    _forcePairAt(id, first, second) {
        const firstIsId = this.grid[first.row][first.col] === id;
        const secondIsId = this.grid[second.row][second.col] === id;
        if (firstIsId && secondIsId) return;

        const outside = this.occupiedCells().filter(cell =>
            !(cell.row === first.row && cell.col === first.col) &&
            !(cell.row === second.row && cell.col === second.col) &&
            this.grid[cell.row][cell.col] === id
        );

        const displacedFirst = this.grid[first.row][first.col];
        const displacedSecond = this.grid[second.row][second.col];
        this.grid[first.row][first.col] = id;
        this.grid[second.row][second.col] = id;

        let cursor = 0;
        if (!firstIsId && outside[cursor]) {
            const slot = outside[cursor++];
            this.grid[slot.row][slot.col] = displacedFirst;
        }
        if (!secondIsId && outside[cursor]) {
            const slot = outside[cursor++];
            this.grid[slot.row][slot.col] = displacedSecond;
        }
    }

    _mostCommonId() {
        const counts = new Map();
        for (let row = 1; row <= this.rows; row++) {
            for (let col = 1; col <= this.cols; col++) {
                const id = this.grid[row][col];
                if (!id) continue;
                counts.set(id, (counts.get(id) || 0) + 1);
            }
        }

        let bestId = null;
        let bestCount = 1;
        for (const [id, count] of counts) {
            if (count > bestCount) {
                bestCount = count;
                bestId = id;
            }
        }
        return bestId;
    }
}
