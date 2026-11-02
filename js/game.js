'use strict';

/* ---------------------------------------------------------------------------
 * Game — state machine, timer, input and the scoring rules. Rendering is
 * delegated to Renderer, DOM chrome to UI, tile rules to Board/Pathfinder.
 * ------------------------------------------------------------------------- */
class Game {
    constructor() {
        this.canvas = document.getElementById('board');
        this.stageEl = document.getElementById('stage');
        this.crateEl = document.getElementById('crate');

        this.board = new Board();
        this.pathfinder = new Pathfinder();
        this.renderer = new Renderer(this.canvas);
        this.ui = new UI();
        this.audio = new AudioManager();

        this.state = CONFIG.STATE.MENU;
        this.mode = 1;

        this.score = 0;
        this.timeLeft = CONFIG.GAME_DURATION;
        this.clock = 0;

        this.chain = 0;
        this.lastLinkAt = 0;
        this.longestChain = 0;
        this.startTiles = 0;

        this.selected = null;
        this.hint = null;
        this.hintExpiry = 0;

        this.animPhase = 'idle';
        this.pending = null;
        this.shuffleTime = 0;
        this.introUntil = 0;
        this.lastTs = 0;

        this.best = this._readBest();

        this.renderer.loadImages(FRUITS);
        this._bind();
        this.ui.setBest(this.best);
        this.ui.setSoundMuted(this.audio.muted);
        this.ui.setActionsEnabled(false);

        this._deal();
        this.ui.show('menu', { best: this.best });

        requestAnimationFrame(ts => this._loop(ts));
    }

    /* ── Setup ─────────────────────────────────────────────────────────── */

    _space() {
        const stageStyle = getComputedStyle(this.stageEl);
        const crateStyle = getComputedStyle(this.crateEl);

        const stagePadX = parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight);
        const stagePadY = parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom);
        const crateBoxX = parseFloat(crateStyle.paddingLeft) + parseFloat(crateStyle.paddingRight)
            + parseFloat(crateStyle.borderLeftWidth) + parseFloat(crateStyle.borderRightWidth);
        const crateBoxY = parseFloat(crateStyle.paddingTop) + parseFloat(crateStyle.paddingBottom)
            + parseFloat(crateStyle.borderTopWidth) + parseFloat(crateStyle.borderBottomWidth);

        return {
            w: Math.max(150, this.stageEl.clientWidth - stagePadX - crateBoxX - 2),
            h: Math.max(150, this.stageEl.clientHeight - stagePadY - crateBoxY - 2),
        };
    }

    /** Build a fresh crate and size the canvas to the current stage. */
    _deal() {
        const space = this._space();
        const grid = chooseGrid(space.w, space.h);
        const ids = FRUITS.map(fruit => fruit.id);

        this.board.reset(grid.cols, grid.rows, ids, this.mode);

        // A dealt board should never greet the player with zero moves.
        if (!this.pathfinder.findAnyMatch(this.board.grid, this.board.rows, this.board.cols)) {
            this.board.shuffle(this.pathfinder);
        }

        this.renderer.configure(grid.cols, grid.rows, space.w, space.h);
        this.renderer.reset();
        this.renderer.startIntro();

        this.selected = null;
        this.hint = null;
        this.animPhase = 'idle';
        this.pending = null;
        this.introUntil = performance.now() + 500;

        this.startTiles = this.board.remaining();
        this._resetChain();

        this.ui.setMode(CONFIG.MODES[this.mode].label);
    }

    startGame() {
        this.score = 0;
        this.timeLeft = CONFIG.GAME_DURATION;
        this.clock = 0;

        this._deal();

        this.state = CONFIG.STATE.PLAYING;
        this.ui.show(null);
        this.ui.setActionsEnabled(true);
        this.ui.setScore(0);
        this.ui.setTimer(this.timeLeft, CONFIG.GAME_DURATION);
        this.audio.startMusic();
    }

    /* ── Loop ──────────────────────────────────────────────────────────── */

    _loop(ts) {
        const raw = this.lastTs ? (ts - this.lastTs) / 1000 : 0;
        this.lastTs = ts;
        const dt = Util.clamp(raw, 0, 0.05);
        const live = this.state !== CONFIG.STATE.PAUSED;

        if (live) this.renderer.update(dt);

        if (this.state === CONFIG.STATE.PLAYING) {
            this._advance(dt);
        } else if (this.state === CONFIG.STATE.SHUFFLE) {
            this._advanceShuffle(dt);
        }

        this.renderer.draw(this.board, {
            selected: this.selected,
            hint: this.hint,
        });

        requestAnimationFrame(next => this._loop(next));
    }

    _advance(dt) {
        this.clock += dt;
        this.timeLeft -= dt;

        if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            this.ui.setTimer(0, CONFIG.GAME_DURATION);
            this._finishGame(false);
            return;
        }

        this.ui.setTimer(this.timeLeft, CONFIG.GAME_DURATION);

        if (this.chain > 0 && this.clock - this.lastLinkAt > CONFIG.comboWindow) this._breakChain();

        if (this.hint && this.clock >= this.hintExpiry) this._clearHint();

        if (this.animPhase === 'path' && this.renderer.animDone()) {
            this._beginRemove();
        } else if (this.animPhase === 'remove' && this.renderer.animDone()) {
            this._completeRemove();
        }
    }

    _advanceShuffle(dt) {
        this.shuffleTime += dt;
        if (this.shuffleTime >= CONFIG.animShuffle) {
            this.state = CONFIG.STATE.PLAYING;
            this.ui.setActionsEnabled(true);
        }
    }

    /* ── Matching pipeline ─────────────────────────────────────────────── */

    _beginPath(a, b, points) {
        this.animPhase = 'path';
        this.pending = { a, b, ...this._climbChain() };
        this.audio.play('link');
        this.renderer.startPath(points);
    }

    /** A link inside the combo window climbs the ladder; the chime climbs with it. */
    _climbChain() {
        const within = this.chain > 0 && this.clock - this.lastLinkAt <= CONFIG.comboWindow;
        this.chain = within ? this.chain + 1 : 1;
        this.lastLinkAt = this.clock;
        this.longestChain = Math.max(this.longestChain, this.chain);

        const index = Math.min(this.chain, CONFIG.comboMultipliers.length) - 1;
        const step = {
            mult: CONFIG.comboMultipliers[index],
            semitones: CONFIG.comboDetune[index],
        };

        this.ui.setChain(this.chain, step.mult);
        return step;
    }

    /** Drop the ladder without touching the run's record chain length. */
    _breakChain() {
        this.chain = 0;
        this.lastLinkAt = 0;
        this.ui.setChain(0, 1);
    }

    _resetChain() {
        this._breakChain();
        this.longestChain = 0;
    }

    _beginRemove() {
        const { a, b } = this.pending;
        const id = this.board.get(a.row, a.col);
        const pairs = [{ ...a, id }, { ...b, id }];

        this.animPhase = 'remove';
        this.audio.play('match', { semitones: this.pending.semitones });
        this.renderer.startRemove(pairs);
        this.renderer.burst(pairs);
    }

    _completeRemove() {
        const { a, b, mult } = this.pending;
        const moves = this.board.removePair(a, b);

        this.renderer.cancelAnim();
        this.renderer.startFalls(moves);
        this.animPhase = 'idle';
        this.pending = null;

        const bonus = Math.floor(this.timeLeft) * CONFIG.timeBonus;
        const earned = Math.round((CONFIG.baseScore + bonus) * mult);
        this.score += earned;
        this.ui.setScore(this.score);

        const mid = this.renderer.midpoint(a, b);
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width / this.renderer.geo.width;
        const scaleY = rect.height / this.renderer.geo.height;
        this.ui.popScore(rect.left + mid.x * scaleX, rect.top + mid.y * scaleY, earned, mult);

        if (this.board.remaining() === 0) {
            this._finishGame(true);
            return;
        }

        // Deadlocks can only appear after a removal, so check right now.
        if (!this.pathfinder.findAnyMatch(this.board.grid, this.board.rows, this.board.cols)) {
            this._startShuffle(false);
        }
    }

    _finishGame(won) {
        this.animPhase = 'idle';
        this.pending = null;
        this.selected = null;
        this._clearHint();
        this._breakChain();
        this.renderer.cancelAnim();
        this.renderer.startFalls([]);

        let bonus = 0;
        if (won) {
            bonus = Math.floor(this.timeLeft) * CONFIG.clearBonus;
            this.score += bonus;
            this.ui.setScore(this.score);
        }

        const clearedPct = this.startTiles
            ? Math.round(100 * (this.startTiles - this.board.remaining()) / this.startTiles)
            : 0;
        const previousBest = this.best.score;
        const previousClearedPct = this.best.clearedPct;

        if (this.score > previousBest || this.longestChain > this.best.chain) {
            this.best = {
                score: Math.max(this.score, previousBest),
                clearedPct: this.score > previousBest ? clearedPct : this.best.clearedPct,
                chain: Math.max(this.longestChain, this.best.chain),
            };
            this._writeBest();
        }

        this.state = won ? CONFIG.STATE.WIN : CONFIG.STATE.GAME_OVER;
        this.audio.stopMusic();
        this.audio.play(won ? 'win' : 'lose');
        this.ui.setActionsEnabled(false);
        this.ui.setTimer(this.timeLeft, CONFIG.GAME_DURATION);

        const stats = {
            score: this.score,
            bonus,
            best: this.best.score,
            previousBest,
            clearedPct,
            left: this.board.remaining(),
            chain: this.longestChain,
            bestClearedPct: previousClearedPct,
        };

        this.ui.show(won ? 'win' : 'over', stats);
    }

    /* ── Player actions ────────────────────────────────────────────────── */

    _onPointerDown(event) {
        if (this.state !== CONFIG.STATE.PLAYING) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (this.animPhase !== 'idle' || this.renderer.isBusy()) return;
        if (performance.now() < this.introUntil) return;

        const cell = this.renderer.pxToCell(event.clientX, event.clientY);
        if (!cell) return;

        const id = this.board.get(cell.row, cell.col);
        if (!id) {
            this._deselect();
            return;
        }

        if (this.hint) this._clearHint();

        if (!this.selected) {
            this.selected = cell;
            this.audio.play('select');
            return;
        }

        if (this.selected.row === cell.row && this.selected.col === cell.col) {
            this.selected = null;
            return;
        }

        const firstId = this.board.get(this.selected.row, this.selected.col);
        if (firstId !== id) {
            this.selected = cell;
            this.audio.play('select');
            return;
        }

        const path = this.pathfinder.canConnect(this.board.grid, this.selected, cell);
        if (path) {
            const first = this.selected;
            this.selected = null;
            this._beginPath(first, cell, path);
        } else {
            // Keep the first tile selected; a shake says "not this one".
            this._breakChain();
            this.audio.play('invalid');
            this.renderer.shake([this.selected, cell]);
        }
    }

    _useHint() {
        if (this.state !== CONFIG.STATE.PLAYING) return;
        if (this.animPhase !== 'idle' || this.renderer.isBusy()) return;
        if (performance.now() < this.introUntil) return;

        if (this.timeLeft <= CONFIG.hintCost + 0.5) {
            this.audio.play('invalid');
            this.ui.toast('Not enough time for a hint');
            return;
        }

        const pair = this.pathfinder.findAnyMatch(
            this.board.grid, this.board.rows, this.board.cols
        );
        if (!pair) {
            this._startShuffle(false);
            return;
        }

        this.selected = null;
        this.hint = pair;
        this.hintExpiry = this.clock + CONFIG.hintDuration;
        this.timeLeft = Math.max(0, this.timeLeft - CONFIG.hintCost);
        this.audio.play('hint');
        this.ui.setTimer(this.timeLeft, CONFIG.GAME_DURATION);
    }

    _startShuffle(paid) {
        if (this.state !== CONFIG.STATE.PLAYING) return;
        if (paid && (this.animPhase !== 'idle' || this.renderer.isBusy())) return;

        if (paid) {
            if (this.timeLeft <= CONFIG.shuffleCost + 0.5) {
                this.ui.toast('Not enough time to shuffle');
                return;
            }
            this.timeLeft -= CONFIG.shuffleCost;
        }

        this.selected = null;
        this._clearHint();
        this._breakChain();
        this.animPhase = 'idle';
        this.pending = null;
        this.renderer.cancelAnim();
        this.renderer.startFalls([]);

        const solved = this.board.shuffle(this.pathfinder);
        this.audio.play('shuffle');
        this.renderer.startShuffle(CONFIG.animShuffle);

        this.state = CONFIG.STATE.SHUFFLE;
        this.shuffleTime = 0;
        this.ui.setActionsEnabled(false);
        this.ui.setTimer(this.timeLeft, CONFIG.GAME_DURATION);

        if (!paid) {
            this.ui.toast('No moves left — reshuffling the crate');
        }
        if (!solved) {
            // Belt and braces; Board normally guarantees a legal layout.
            this.board.shuffle(this.pathfinder);
        }
    }

    /* ── Selection helpers ─────────────────────────────────────────────── */

    _deselect() {
        this.selected = null;
    }

    _clearHint() {
        this.hint = null;
    }

    /* ── App state ─────────────────────────────────────────────────────── */

    _togglePause() {
        if (this.state === CONFIG.STATE.PLAYING) {
            this.state = CONFIG.STATE.PAUSED;
            this.audio.pauseMusic();
            this.audio.play('pause');
            this.ui.setActionsEnabled(false);
            this.ui.show('pause');
        } else if (this.state === CONFIG.STATE.PAUSED) {
            this.state = CONFIG.STATE.PLAYING;
            this.audio.resumeMusic();
            this.audio.play('resume');
            this.ui.show(null);
            this.ui.setActionsEnabled(true);
        }
    }

    _toggleSound() {
        const muted = this.audio.toggle();
        this.ui.setSoundMuted(muted);
    }

    _showMenu() {
        this.state = CONFIG.STATE.MENU;
        this.audio.stopMusic();
        this.score = 0;
        this.timeLeft = CONFIG.GAME_DURATION;
        this.clock = 0;

        this._deal();
        this.ui.setScore(0);
        this.ui.setTimer(this.timeLeft, CONFIG.GAME_DURATION);
        this.ui.setActionsEnabled(false);
        this.ui.setBest(this.best);
        this.ui.show('menu', { best: this.best });
    }

    _resize() {
        if (!this.board.rows) return;

        if (this.state === CONFIG.STATE.MENU) {
            this._deal();
            return;
        }

        const space = this._space();
        this.renderer.configure(this.board.cols, this.board.rows, space.w, space.h);
    }

    _readBest() {
        try {
            const raw = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}');
            return {
                score: Number(raw.score) || 0,
                clearedPct: Number(raw.clearedPct) || 0,
                chain: Number(raw.chain) || 0,
            };
        } catch (error) {
            /* Storage may be unavailable (private mode / file://). */
            return { score: 0, clearedPct: 0, chain: 0 };
        }
    }

    _writeBest() {
        try {
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(this.best));
        } catch (error) {
            /* Storage may be unavailable (private mode / file://); scores still work. */
        }
    }

    /* ── Events ────────────────────────────────────────────────────────── */

    _bind() {
        this.canvas.addEventListener('pointerdown', event => this._onPointerDown(event));

        document.getElementById('btn-play').addEventListener('click', () => this.startGame());
        document.getElementById('btn-retry').addEventListener('click', () => this.startGame());
        document.getElementById('btn-win-again').addEventListener('click', () => this.startGame());
        document.getElementById('btn-pause').addEventListener('click', () => this._togglePause());
        document.getElementById('btn-resume').addEventListener('click', () => this._togglePause());
        document.getElementById('btn-hint').addEventListener('click', () => this._useHint());
        document.getElementById('btn-shuffle').addEventListener('click', () => this._startShuffle(true));
        document.getElementById('btn-sound').addEventListener('click', () => this._toggleSound());

        document.querySelectorAll('[data-action="menu"]').forEach(button => {
            button.addEventListener('click', () => this._showMenu());
        });

        document.querySelectorAll('.seg').forEach(button => {
            button.addEventListener('click', () => {
                this.mode = Number(button.dataset.mode);
                document.querySelectorAll('.seg').forEach(other => {
                    const active = other === button;
                    other.classList.toggle('is-active', active);
                    other.setAttribute('aria-pressed', String(active));
                });
                this.audio.play('click');
                this.ui.setMode(CONFIG.MODES[this.mode].label);
                if (this.state === CONFIG.STATE.MENU) this._deal();
            });
        });

        window.addEventListener('keydown', event => {
            const key = event.key.toLowerCase();
            if (key === 'm') {
                if (!event.repeat) {
                    event.preventDefault();
                    this._toggleSound();
                }
                return;
            }
            if (key === 'escape' || key === 'p') {
                if (this.state === CONFIG.STATE.PLAYING || this.state === CONFIG.STATE.PAUSED) {
                    event.preventDefault();
                    this._togglePause();
                }
                return;
            }
            if (this.state !== CONFIG.STATE.PLAYING) return;
            if (key === 'h') this._useHint();
            if (key === 's') this._startShuffle(true);
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === CONFIG.STATE.PLAYING) {
                this._togglePause();
            }
        });

        let resizeTimer = 0;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this._resize(), 140);
        });
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this._resize(), 240);
        });

        // Web fonts change the HUD height; re-fit once they are ready.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => this._resize());
        }
    }
}
