'use strict';

/* ---------------------------------------------------------------------------
 * UI — DOM chrome only: HUD, overlays, toasts, score tags. No game rules.
 * ------------------------------------------------------------------------- */
class UI {
    constructor() {
        this.overlay = document.getElementById('overlay');
        this.screens = {
            menu: document.getElementById('screen-menu'),
            pause: document.getElementById('screen-pause'),
            over: document.getElementById('screen-over'),
            win: document.getElementById('screen-win'),
        };

        this.scoreTag = document.querySelector('.score-tag');
        this.scoreValue = document.getElementById('score-value');
        this.timer = document.getElementById('timer');
        this.timerFill = document.getElementById('timer-fill');
        this.timerText = document.getElementById('timer-text');
        this.modeChip = document.getElementById('mode-chip');
        this.toasts = document.getElementById('toasts');
        this.hintButton = document.getElementById('btn-hint');
        this.shuffleButton = document.getElementById('btn-shuffle');
        this.confettiBox = document.getElementById('confetti');

        this.lastScore = 0;
        this.lastTimeLabel = '';
        this.reduced = window.matchMedia
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false;
    }

    /* ── Screens ───────────────────────────────────────────────────────── */

    show(name, data = {}) {
        Object.values(this.screens).forEach(screen => {
            screen.classList.add('is-hidden');
            screen.scrollTop = 0;
        });

        if (!name) {
            this.overlay.classList.add('is-hidden');
            return;
        }

        const screen = this.screens[name];
        if (!screen) return;

        this.overlay.classList.remove('is-hidden');
        screen.classList.remove('is-hidden');

        if (name === 'menu') {
            document.getElementById('best-menu').textContent = data.best ?? 0;
            this._focusPrimary(screen, 'btn-play');
        } else if (name === 'over') {
            document.getElementById('over-score').textContent = data.score ?? 0;
            document.getElementById('over-best').textContent = `Best ${data.best ?? 0}`;
            this._focusPrimary(screen, 'btn-retry');
        } else if (name === 'win') {
            document.getElementById('win-score').textContent = data.score ?? 0;
            document.getElementById('win-bonus').textContent =
                data.bonus ? `+${data.bonus} time bonus` : 'Perfect clear';
            document.getElementById('win-best').textContent = `Best ${data.best ?? 0}`;
            this._focusPrimary(screen, 'btn-win-again');
            this._confetti();
        } else if (name === 'pause') {
            this._focusPrimary(screen, 'btn-resume');
        }
    }

    _focusPrimary(screen, id) {
        if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
        const button = screen.querySelector(`#${id}`);
        if (button) {
            requestAnimationFrame(() => button.focus({ preventScroll: true }));
        }
    }

    /* ── HUD ───────────────────────────────────────────────────────────── */

    setScore(score) {
        if (score === this.lastScore) return;
        this.lastScore = score;
        this.scoreValue.textContent = score;

        this.scoreTag.classList.remove('is-bumped');
        void this.scoreTag.offsetWidth;
        this.scoreTag.classList.add('is-bumped');
    }

    setTimer(seconds, duration) {
        const ratio = Util.clamp(seconds / duration, 0, 1);
        this.timerFill.style.width = `${(ratio * 100).toFixed(2)}%`;
        this.timerFill.dataset.tone = ratio > 0.5 ? 'high' : ratio > 0.25 ? 'mid' : 'low';

        const label = Util.formatTime(seconds);
        if (label !== this.lastTimeLabel) {
            this.lastTimeLabel = label;
            this.timerText.textContent = label;
        }

        this.timer.classList.toggle('is-low', seconds <= 30);
        this.timer.classList.toggle('is-critical', seconds <= 10);
    }

    setMode(label) {
        this.modeChip.textContent = label;
    }

    setActionsEnabled(enabled) {
        for (const button of [this.hintButton, this.shuffleButton]) {
            if (!button) continue;
            button.disabled = !enabled;
            button.setAttribute('aria-disabled', String(!enabled));
        }
    }

    setBest(best) {
        const menu = document.getElementById('best-menu');
        if (menu) menu.textContent = best;
    }

    /* ── Feedback ──────────────────────────────────────────────────────── */

    popScore(x, y, points) {
        const popup = document.createElement('div');
        popup.className = 'score-pop';
        popup.textContent = `+${points}`;
        popup.style.left = `${x}px`;
        popup.style.top = `${y}px`;
        document.body.appendChild(popup);

        const remove = () => popup.remove();
        popup.addEventListener('animationend', remove);
        setTimeout(remove, 1600);
    }

    toast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        this.toasts.appendChild(toast);

        while (this.toasts.children.length > 2) {
            this.toasts.firstElementChild.remove();
        }

        setTimeout(() => {
            toast.classList.add('is-out');
            setTimeout(() => toast.remove(), 260);
        }, 2100);
    }

    _confetti() {
        if (this.reduced || !this.confettiBox) return;

        const colors = ['#e8503a', '#f2b233', '#3f9b55', '#3e8fb0', '#8b3e6e', '#f49a86'];
        this.confettiBox.textContent = '';

        for (let i = 0; i < 26; i++) {
            const piece = document.createElement('i');
            piece.style.setProperty('--x', `${Math.random() * 100}%`);
            piece.style.setProperty('--delay', `${Math.random() * 0.35}s`);
            piece.style.setProperty('--spin', `${180 + Math.random() * 540}deg`);
            piece.style.setProperty('--drift', `${-30 + Math.random() * 60}px`);
            piece.style.background = colors[i % colors.length];
            this.confettiBox.appendChild(piece);
        }

        setTimeout(() => {
            if (this.confettiBox) this.confettiBox.textContent = '';
        }, 2800);
    }
}
