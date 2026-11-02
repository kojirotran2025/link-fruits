'use strict';

/* ---------------------------------------------------------------------------
 * Pathfinder — the classic "link" rule:
 * two equal fruits connect when a path of at most two 90° turns can be drawn
 * through empty cells. The empty ring around the playable area counts as
 * empty, which is what allows paths to wrap around the crate.
 * ------------------------------------------------------------------------- */
class Pathfinder {
    /**
     * @returns {Array<{row:number,col:number}>|null} waypoints a → … → b
     */
    canConnect(grid, a, b) {
        if (!a || !b) return null;
        if (a.row === b.row && a.col === b.col) return null;

        const first = grid[a.row]?.[a.col];
        if (!first) return null;
        if (first !== grid[b.row]?.[b.col]) return null;

        return (
            this._zeroTurn(grid, a, b) ||
            this._oneTurn(grid, a, b) ||
            this._twoTurns(grid, a, b) ||
            null
        );
    }

    /** Are all cells strictly between a and b empty on their shared line? */
    _clearBetween(grid, a, b) {
        if (a.row === b.row) {
            const from = Math.min(a.col, b.col);
            const to = Math.max(a.col, b.col);
            for (let col = from + 1; col < to; col++) {
                if (grid[a.row][col]) return false;
            }
            return true;
        }

        if (a.col === b.col) {
            const from = Math.min(a.row, b.row);
            const to = Math.max(a.row, b.row);
            for (let row = from + 1; row < to; row++) {
                if (grid[row][a.col]) return false;
            }
            return true;
        }

        return false;
    }

    _zeroTurn(grid, a, b) {
        if (a.row !== b.row && a.col !== b.col) return null;
        return this._clearBetween(grid, a, b) ? [a, b] : null;
    }

    _oneTurn(grid, a, b) {
        const first = { row: a.row, col: b.col };
        if (!grid[first.row][first.col] &&
            this._clearBetween(grid, a, first) &&
            this._clearBetween(grid, first, b)) {
            return this._clean([a, first, b]);
        }

        const second = { row: b.row, col: a.col };
        if (!grid[second.row][second.col] &&
            this._clearBetween(grid, a, second) &&
            this._clearBetween(grid, second, b)) {
            return this._clean([a, second, b]);
        }

        return null;
    }

    _twoTurns(grid, a, b) {
        const rowCount = grid.length;
        const colCount = grid[0].length;

        // Leave a along its row, then solve the rest with at most one turn.
        for (let col = 0; col < colCount; col++) {
            if (col === a.col) continue;
            if (grid[a.row][col]) continue;
            const pivot = { row: a.row, col };
            if (!this._clearBetween(grid, a, pivot)) continue;
            const rest = this._oneTurn(grid, pivot, b);
            if (rest) return this._clean([a, ...rest]);
        }

        // Same, leaving vertically.
        for (let row = 0; row < rowCount; row++) {
            if (row === a.row) continue;
            if (grid[row][a.col]) continue;
            const pivot = { row, col: a.col };
            if (!this._clearBetween(grid, a, pivot)) continue;
            const rest = this._oneTurn(grid, pivot, b);
            if (rest) return this._clean([a, ...rest]);
        }

        return null;
    }

    /** Drop repeated consecutive waypoints (zero-length segments). */
    _clean(points) {
        const cleaned = [];
        for (const point of points) {
            const last = cleaned[cleaned.length - 1];
            if (!last || last.row !== point.row || last.col !== point.col) {
                cleaned.push({ row: point.row, col: point.col });
            }
        }
        return cleaned;
    }

    /**
     * Scan the crate for any legal pair. Grouping by fruit id keeps this cheap
     * enough to run after every single match.
     */
    findAnyMatch(grid, rows, cols) {
        const groups = new Map();

        for (let row = 1; row <= rows; row++) {
            for (let col = 1; col <= cols; col++) {
                const id = grid[row][col];
                if (!id) continue;
                if (!groups.has(id)) groups.set(id, []);
                groups.get(id).push({ row, col });
            }
        }

        for (const cells of groups.values()) {
            for (let i = 0; i < cells.length; i++) {
                for (let j = i + 1; j < cells.length; j++) {
                    if (this.canConnect(grid, cells[i], cells[j])) {
                        return [cells[i], cells[j]];
                    }
                }
            }
        }

        return null;
    }
}
