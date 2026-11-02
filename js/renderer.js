'use strict';

/* ---------------------------------------------------------------------------
 * Renderer — everything the player sees on the crate: paper, stickers, path
 * twine, removal confetti. Geometry is recalculated on resize; the board
 * itself never changes size.
 * ------------------------------------------------------------------------- */
class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

        this.geo = null;
        this.bg = null;

        this.images = new Map();
        this.time = 0;

        this.intro = 0;
        this.introOn = false;

        this.anim = { phase: 'idle', t: 0, dur: 0, points: null, pairs: null };
        this.shuffle = null;
        this.falls = null;
        this.shakes = [];
        this.particles = [];

        this.reduced = window.matchMedia
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false;
    }

    /* ── Assets ────────────────────────────────────────────────────────── */

    loadImages(fruits) {
        for (const fruit of fruits) {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => this.images.set(fruit.id, img);
            img.src = fruit.src;
        }
    }

    /* ── Geometry ──────────────────────────────────────────────────────── */

    configure(cols, rows, maxWidth, maxHeight) {
        const tile = tileSizeFor(cols, rows, maxWidth, maxHeight);
        const gap = Math.max(2, Math.round(tile * CONFIG.gapRatio));
        const pad = Math.max(10, Math.round(tile * CONFIG.padRatio));
        const width = cols * tile + (cols - 1) * gap + pad * 2;
        const height = rows * tile + (rows - 1) * gap + pad * 2;

        this.geo = {
            cols, rows, tile, gap, pad, width, height,
            step: tile + gap,
        };

        this.canvas.width = Math.round(width * this.dpr);
        this.canvas.height = Math.round(height * this.dpr);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        const ctx = this.ctx;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        this.cardGradient = ctx.createLinearGradient(0, -tile / 2, 0, tile / 2);
        this.cardGradient.addColorStop(0, '#fffdf6');
        this.cardGradient.addColorStop(1, '#fff5e2');

        this._buildBackground();
    }

    cellOrigin(row, col) {
        const { pad, step } = this.geo;
        return {
            x: pad + (col - 1) * step,
            y: pad + (row - 1) * step,
        };
    }

    center(row, col) {
        const origin = this.cellOrigin(row, col);
        const half = this.geo.tile / 2;
        return { x: origin.x + half, y: origin.y + half };
    }

    midpoint(a, b) {
        const first = this.center(a.row, a.col);
        const second = this.center(b.row, b.col);
        return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    }

    /** Border ring cells map to the middle of the routing lane, never off-canvas. */
    pathPoint(row, col) {
        const { pad, step, tile, rows, cols, width, height } = this.geo;
        const x = col <= 0
            ? pad * 0.5
            : col > cols
                ? width - pad * 0.5
                : pad + (col - 1) * step + tile / 2;
        const y = row <= 0
            ? pad * 0.5
            : row > rows
                ? height - pad * 0.5
                : pad + (row - 1) * step + tile / 2;
        return { x, y };
    }

    pxToCell(clientX, clientY) {
        if (!this.geo) return null;
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;

        const x = (clientX - rect.left) * (this.geo.width / rect.width);
        const y = (clientY - rect.top) * (this.geo.height / rect.height);
        const { pad, step, tile, cols, rows } = this.geo;

        const col = Math.floor((x - pad) / step) + 1;
        const row = Math.floor((y - pad) / step) + 1;
        if (row < 1 || row > rows || col < 1 || col > cols) return null;

        const origin = this.cellOrigin(row, col);
        if (x < origin.x || x > origin.x + tile) return null;
        if (y < origin.y || y > origin.y + tile) return null;

        return { row, col };
    }

    /* ── Animation controls ────────────────────────────────────────────── */

    startIntro() {
        this.intro = 0;
        this.introOn = true;
    }

    /** Clear every transient effect (used when a new crate is dealt). */
    reset() {
        this.cancelAnim();
        this.shuffle = null;
        this.falls = null;
        this.shakes = [];
        this.particles = [];
        this.intro = 0;
        this.introOn = false;
    }

    startPath(points) {
        this.anim = {
            phase: 'path',
            t: 0,
            dur: this.reduced ? 0.12 : CONFIG.animPath,
            points,
            pairs: null,
        };
    }

    startRemove(pairs) {
        this.anim = {
            phase: 'remove',
            t: 0,
            dur: this.reduced ? 0.1 : CONFIG.animRemove,
            points: null,
            pairs,
        };
    }

    cancelAnim() {
        this.anim = { phase: 'idle', t: 0, dur: 0, points: null, pairs: null };
    }

    animDone() {
        return this.anim.t >= this.anim.dur;
    }

    startShuffle(duration = CONFIG.animShuffle) {
        this.shuffle = { t: 0, dur: this.reduced ? 0.2 : duration };
    }

    startFalls(moves) {
        this.falls = moves && moves.length
            ? { moves, t: 0, dur: this.reduced ? 0.05 : CONFIG.animFall }
            : null;
    }

    shake(cells) {
        for (const cell of cells) {
            this.shakes.push({
                row: cell.row,
                col: cell.col,
                until: this.time + 0.26,
                amp: 1,
            });
        }
    }

    burst(pairs) {
        for (const cell of pairs) {
            const { x, y } = this.center(cell.row, cell.col);
            const tint = FRUIT_BY_ID[cell.id]?.tint || '#e8503a';

            for (let i = 0; i < 9; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 45 + Math.random() * 135;
                this.particles.push({
                    x,
                    y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed - 55,
                    life: 0.45 + Math.random() * 0.35,
                    max: 0.8,
                    size: 2 + Math.random() * 3.4,
                    color: i % 3 === 0 ? '#fff3d6' : tint,
                });
            }
        }
    }

    isBusy() {
        return this.anim.phase !== 'idle'
            || Boolean(this.falls)
            || Boolean(this.shuffle);
    }

    /* ── Tick ──────────────────────────────────────────────────────────── */

    update(dt) {
        if (!dt) return;
        this.time += dt;

        if (this.introOn) {
            this.intro += dt;
            if (this.intro > 1.1) this.introOn = false;
        }

        if (this.anim.phase !== 'idle') this.anim.t += dt;

        if (this.shuffle) {
            this.shuffle.t += dt;
            if (this.shuffle.t >= this.shuffle.dur) this.shuffle = null;
        }

        if (this.falls) {
            this.falls.t += dt;
            if (this.falls.t >= this.falls.dur) this.falls = null;
        }

        if (this.shakes.length) {
            this.shakes = this.shakes.filter(shake => shake.until > this.time);
        }

        for (const particle of this.particles) {
            particle.vy += 420 * dt;
            particle.vx *= 0.99;
            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;
            particle.life -= dt;
        }
        this.particles = this.particles.filter(particle => particle.life > 0);
    }

    /* ── Background (cached) ───────────────────────────────────────────── */

    _buildBackground() {
        const { width, height, pad, tile } = this.geo;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * this.dpr);
        canvas.height = Math.round(height * this.dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#fdf6e6');
        gradient.addColorStop(1, '#f7e8cd');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Halftone dot grid across the playable field.
        const spacing = Math.max(11, Math.round(tile * 0.24));
        ctx.fillStyle = 'rgba(120, 78, 38, 0.10)';
        for (let y = pad; y < height - pad; y += spacing) {
            for (let x = pad; x < width - pad; x += spacing) {
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Dotted route lane around the crate.
        const lane = pad * 0.5;
        this._roundPath(ctx, lane, lane, width - lane * 2, height - lane * 2, Math.min(18, pad));
        ctx.setLineDash([2, 7]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(90, 55, 25, 0.20)';
        ctx.stroke();
        ctx.setLineDash([]);

        this.bg = canvas;
    }

    /* ── Draw ──────────────────────────────────────────────────────────── */

    draw(board, view = {}) {
        if (!this.geo) return;
        const ctx = this.ctx;
        const { width, height, step, tile } = this.geo;

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (this.bg) ctx.drawImage(this.bg, 0, 0, width, height);

        const shakeMap = new Map(
            this.shakes.map(item => [`${item.row},${item.col}`, item])
        );
        const falling = this.falls
            ? new Set(this.falls.moves.map(move => `${move.row},${move.col}`))
            : null;
        const removing = this.anim.phase === 'remove'
            ? new Set(this.anim.pairs.map(pair => `${pair.row},${pair.col}`))
            : null;

        // Empty pockets get a faint "cut here" outline.
        for (let row = 1; row <= board.rows; row++) {
            for (let col = 1; col <= board.cols; col++) {
                if (!board.isEmpty(row, col)) continue;
                this._drawEmptySlot(row, col);
            }
        }

        const selected = view.selected;
        const hint = view.hint;

        for (let row = 1; row <= board.rows; row++) {
            for (let col = 1; col <= board.cols; col++) {
                const id = board.get(row, col);
                if (!id) continue;

                const key = `${row},${col}`;
                if (removing && removing.has(key)) continue;
                if (falling && falling.has(key)) continue;

                let scale = 1;
                let alpha = 1;
                let lift = 0;
                let rot = 0;
                let dx = 0;

                if (this.introOn) {
                    const progress = Util.clamp(
                        (this.intro - (row + col) * 0.012) / 0.34, 0, 1
                    );
                    const eased = Util.easeOutBack(progress);
                    scale *= 0.55 + 0.45 * eased;
                    alpha *= progress;
                    lift += (1 - progress) * 12;
                }

                if (this.shuffle) {
                    const wave = Math.sin(
                        Math.PI * Util.clamp(this.shuffle.t / this.shuffle.dur, 0, 1)
                    );
                    scale *= 1 - 0.85 * wave;
                    alpha *= 1 - 0.7 * wave;
                    rot += 0.16 * wave * ((row + col) % 2 ? 1 : -1);
                }

                const shake = shakeMap.get(key);
                if (shake) {
                    const remain = Util.clamp((shake.until - this.time) / 0.26, 0, 1);
                    dx += Math.sin(this.time * 78) * 3.4 * remain;
                }

                const isSelected = selected && selected.row === row && selected.col === col;
                const isHinted = hint && hint.some(cell => cell.row === row && cell.col === col);

                if (isSelected) {
                    lift += Math.max(2, tile * 0.07);
                    scale *= 1.04;
                }

                this._drawTile(row, col, id, {
                    scale, alpha, lift, rot, dx,
                    selected: isSelected,
                    hinted: isHinted,
                });
            }
        }

        // Gravity settle animation.
        if (this.falls) {
            const progress = Util.easeOutCubic(
                Util.clamp(this.falls.t / this.falls.dur, 0, 1)
            );
            for (const move of this.falls.moves) {
                const dx = move.fromCol
                    ? (move.fromCol - move.col) * step * (1 - progress)
                    : 0;
                const dy = move.fromRow
                    ? (move.fromRow - move.row) * step * (1 - progress)
                    : 0;
                this._drawTile(move.row, move.col, move.id, { dx, dy });
            }
        }

        // Removed pair: shrink, spin and fade.
        if (this.anim.phase === 'remove') {
            const progress = Util.clamp(this.anim.t / this.anim.dur, 0, 1);
            for (const pair of this.anim.pairs) {
                this._drawTile(pair.row, pair.col, pair.id, {
                    scale: 1 - 0.55 * progress,
                    alpha: 1 - progress,
                    lift: progress * tile * 0.18,
                    rot: progress * 0.28,
                });
            }
        }

        // Connection twine.
        if (this.anim.phase === 'path') {
            this._drawPath(
                this.anim.points,
                Util.clamp(this.anim.t / this.anim.dur, 0, 1)
            );
        }

        // Juice splashes.
        for (const particle of this.particles) {
            const alpha = Util.clamp(particle.life / particle.max, 0, 1);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    _drawEmptySlot(row, col) {
        const ctx = this.ctx;
        const { tile } = this.geo;
        const { x, y } = this.cellOrigin(row, col);
        const radius = Math.max(5, tile * 0.2);

        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(90, 55, 25, 0.16)';
        this._roundPath(ctx, x + 3, y + 3, tile - 6, tile - 6, radius);
        ctx.stroke();
        ctx.restore();
    }

    _drawTile(row, col, id, options = {}) {
        const ctx = this.ctx;
        const { tile } = this.geo;
        const { x, y } = this.cellOrigin(row, col);

        const dx = options.dx || 0;
        const dy = options.dy || 0;
        const scale = options.scale ?? 1;
        const alpha = options.alpha ?? 1;
        const lift = options.lift || 0;
        const hinted = Boolean(options.hinted);
        const selected = Boolean(options.selected);
        let rot = options.rot || 0;

        if (hinted) rot += Math.sin(this.time * 9) * 0.03;

        if (alpha <= 0.01 || scale <= 0.01) return;

        const radius = Math.max(5, tile * 0.2);
        const cx = x + tile / 2 + dx;
        const cy = y + tile / 2 + dy - lift;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;

        // Sticker shadow lip.
        ctx.fillStyle = 'rgba(80, 45, 20, 0.16)';
        this._roundPath(ctx, -tile / 2 + 1.5, -tile / 2 + 4, tile - 3, tile - 4, radius);
        ctx.fill();

        // Card.
        ctx.fillStyle = this.cardGradient || '#fffdf6';
        this._roundPath(ctx, -tile / 2 + 1.5, -tile / 2 + 1.5, tile - 3, tile - 4, radius);
        ctx.fill();

        ctx.lineWidth = selected ? Math.max(2, tile * 0.045) : 1.2;
        ctx.strokeStyle = selected ? '#2b1a12' : 'rgba(70, 40, 20, 0.16)';
        ctx.stroke();

        // Fruit sticker.
        const img = this.images.get(id);
        const size = tile * 0.86;
        if (img && img.complete && img.naturalWidth) {
            ctx.drawImage(img, -size / 2, -size / 2 + tile * 0.005, size, size);
        } else {
            const fruit = FRUIT_BY_ID[id];
            ctx.fillStyle = fruit?.tint || '#e8503a';
            ctx.beginPath();
            ctx.arc(0, 0, tile * 0.27, 0, Math.PI * 2);
            ctx.fill();
        }

        // State rings sit outside the card so the art stays untouched.
        if (selected) {
            ctx.lineWidth = Math.max(2.5, tile * 0.055);
            ctx.strokeStyle = '#f2b233';
            this._roundPath(ctx, -tile / 2 - 2.5, -tile / 2 - 2.5, tile + 5, tile + 5, radius + 3);
            ctx.stroke();
        }

        if (hinted) {
            const pulse = 0.55 + 0.45 * Math.sin(this.time * 6.5);
            ctx.lineWidth = Math.max(2.5, tile * 0.05);
            ctx.strokeStyle = `rgba(232, 80, 58, ${0.35 + 0.55 * pulse})`;
            ctx.setLineDash([5, 4]);
            ctx.lineDashOffset = -this.time * 18;
            this._roundPath(ctx, -tile / 2 - 3, -tile / 2 - 3, tile + 6, tile + 6, radius + 3.5);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    /* ── Path twine ────────────────────────────────────────────────────── */

    _drawPath(points, progress) {
        if (!points || points.length < 2) return;
        const ctx = this.ctx;

        const pts = points.map(point => this.pathPoint(point.row, point.col));
        const segments = [];
        let total = 0;

        for (let i = 1; i < pts.length; i++) {
            const length = Math.hypot(
                pts[i].x - pts[i - 1].x,
                pts[i].y - pts[i - 1].y
            );
            if (!length) continue;
            segments.push({ x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y, length });
            total += length;
        }
        if (!segments.length) return;

        let remaining = progress * total;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(segments[0].x1, segments[0].y1);
        for (const segment of segments) {
            if (remaining <= 0) break;
            const part = Math.min(1, remaining / segment.length);
            ctx.lineTo(
                segment.x1 + (segment.x2 - segment.x1) * part,
                segment.y1 + (segment.y2 - segment.y1) * part
            );
            remaining -= segment.length;
        }

        ctx.strokeStyle = 'rgba(43, 26, 18, 0.28)';
        ctx.lineWidth = Math.max(5, this.geo.tile * 0.13);
        ctx.stroke();

        ctx.strokeStyle = '#2b1a12';
        ctx.lineWidth = Math.max(4, this.geo.tile * 0.10);
        ctx.stroke();

        ctx.strokeStyle = '#f2b233';
        ctx.lineWidth = Math.max(2, this.geo.tile * 0.055);
        ctx.stroke();

        ctx.setLineDash([1, 8]);
        ctx.lineDashOffset = -this.time * 45;
        ctx.strokeStyle = '#fff3d0';
        ctx.lineWidth = Math.max(1.5, this.geo.tile * 0.035);
        ctx.stroke();
        ctx.setLineDash([]);

        // Endpoint buttons.
        const pulse = 0.75 + 0.25 * Math.sin(this.time * 8);
        for (const point of [pts[0], pts[pts.length - 1]]) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, Math.max(4.5, this.geo.tile * 0.10), 0, Math.PI * 2);
            ctx.fillStyle = '#2b1a12';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(point.x, point.y, Math.max(2.4, this.geo.tile * 0.055) * pulse, 0, Math.PI * 2);
            ctx.fillStyle = '#f2b233';
            ctx.fill();
        }

        ctx.restore();
    }

    /* ── Helpers ───────────────────────────────────────────────────────── */

    _roundPath(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.arcTo(x + width, y, x + width, y + r, r);
        ctx.lineTo(x + width, y + height - r);
        ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
        ctx.lineTo(x + r, y + height);
        ctx.arcTo(x, y + height, x, y + height - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }
}
