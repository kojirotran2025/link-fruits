'use strict';

/* ---------------------------------------------------------------------------
 * AudioManager — procedural music and sound effects via Web Audio.
 *
 * There are no audio files: a short calypso loop and every effect are
 * synthesised on the fly, so the game stays a tiny static download. The
 * context is created on the first gesture to satisfy mobile autoplay rules.
 * ------------------------------------------------------------------------- */
class AudioManager {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.musicBus = null;
        this.sfxBus = null;
        this.noiseBuffer = null;

        this.muted = this._readMuted();
        this.musicState = 'off';
        this.musicTimer = 0;
        this.nextStepTime = 0;
        this.step = 0;
        this.stepDur = 60 / 108 / 2;
        this.musicLevel = 0.65;

        this.melody = [
            72, 0, 76, 79, 0, 76, 72, 0,
            69, 0, 72, 76, 0, 74, 72, 0,
            77, 0, 81, 84, 0, 81, 77, 0,
            79, 0, 76, 74, 72, 0, 67, 0,
        ];
        this.roots = [48, 45, 41, 43];
        this.chords = [
            [60, 64, 67],
            [57, 60, 64],
            [53, 57, 60],
            [55, 59, 62],
        ];
    }

    /* ── Setup ─────────────────────────────────────────────────────────── */

    _readMuted() {
        try {
            return localStorage.getItem('fruit-link-muted-v1') === '1';
        } catch (error) {
            return false;
        }
    }

    _writeMuted() {
        try {
            localStorage.setItem('fruit-link-muted-v1', this.muted ? '1' : '0');
        } catch (error) {
            /* Private mode: the toggle still works for this session. */
        }
    }

    _ensure() {
        if (this.ctx) {
            if (this.ctx.state !== 'running') this.ctx.resume();
            return true;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;

        const ctx = new AudioCtx();
        this.ctx = ctx;

        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(ctx.destination);

        this.musicBus = ctx.createGain();
        this.musicBus.gain.value = 0.0001;
        this.musicBus.connect(this.master);

        this.sfxBus = ctx.createGain();
        this.sfxBus.gain.value = 0.5;
        this.sfxBus.connect(this.master);

        this.noiseBuffer = this._makeNoise(ctx);

        if (ctx.state !== 'running') ctx.resume();
        return true;
    }

    _makeNoise(ctx) {
        const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    unlock() {
        return this._ensure();
    }

    /* ── Mute ──────────────────────────────────────────────────────────── */

    setMuted(muted) {
        this.muted = Boolean(muted);
        this._writeMuted();

        if (this.ctx && this.master) {
            const now = this.ctx.currentTime;
            this.master.gain.cancelScheduledValues(now);
            this.master.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.02);
        }
    }

    toggle() {
        this.setMuted(!this.muted);
        if (!this.muted) {
            this._ensure();
            this.play('click');
        }
        return this.muted;
    }

    /* ── Music ─────────────────────────────────────────────────────────── */

    startMusic() {
        this.musicState = 'playing';
        if (!this._ensure()) return;

        const now = this.ctx.currentTime;
        this.musicBus.gain.cancelScheduledValues(now);
        this.musicBus.gain.setTargetAtTime(this.musicLevel, now, 0.3);
        this._startScheduler();
    }

    pauseMusic() {
        if (this.musicState !== 'playing') return;
        this.musicState = 'paused';
        this._fadeMusic(0.0001, 0.1);
        this._stopScheduler();
    }

    resumeMusic() {
        if (this.musicState !== 'paused') return;
        this.musicState = 'playing';
        if (!this._ensure()) return;
        this._fadeMusic(this.musicLevel, 0.16);
        this._startScheduler();
    }

    stopMusic() {
        this.musicState = 'off';
        this._fadeMusic(0.0001, 0.2);
        this._stopScheduler();
    }

    _fadeMusic(level, time) {
        if (!this.ctx || !this.musicBus) return;
        const now = this.ctx.currentTime;
        this.musicBus.gain.cancelScheduledValues(now);
        this.musicBus.gain.setTargetAtTime(level, now, time);
    }

    _startScheduler() {
        if (this.musicTimer || !this.ctx) return;
        this.nextStepTime = this.ctx.currentTime + 0.06;
        this.step = 0;
        this._schedule();
        this.musicTimer = window.setInterval(() => this._schedule(), 90);
    }

    _stopScheduler() {
        if (!this.musicTimer) return;
        window.clearInterval(this.musicTimer);
        this.musicTimer = 0;
    }

    _schedule() {
        if (!this.ctx || this.musicState !== 'playing') return;

        const now = this.ctx.currentTime;
        if (this.nextStepTime < now - 0.25) this.nextStepTime = now + 0.05;

        while (this.nextStepTime < now + 0.22) {
            this._scheduleStep(this.step, this.nextStepTime);
            this.nextStepTime += this.stepDur;
            this.step = (this.step + 1) % 32;
        }
    }

    _scheduleStep(step, time) {
        const bar = Math.floor(step / 8);
        const beat = step % 8;
        const root = this.roots[bar];

        if (beat === 0 || beat === 4) {
            this._musicNote(this._midi(root), time, 0.32, 'sine', 0.085);
        }
        if (beat === 6) {
            this._musicNote(this._midi(root + 7), time, 0.2, 'sine', 0.045);
        }
        if (beat === 2 || beat === 5) {
            this.chords[bar].forEach((note, index) => {
                this._musicNote(this._midi(note), time + index * 0.014, 0.16, 'triangle', 0.022);
            });
        }

        const melody = this.melody[step];
        if (melody) {
            this._musicNote(this._midi(melody), time, 0.24, 'triangle', 0.048);
        }

        if (step % 2 === 1) this._shaker(time, 0.013);
        if (beat === 0) this._shaker(time, 0.02, true);
    }

    _musicNote(freq, time, dur, type, gain) {
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);
        osc.detune.setValueAtTime((Math.random() - 0.5) * 6, time);

        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(gain, time + 0.014);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);

        osc.connect(amp).connect(this.musicBus);
        osc.start(time);
        osc.stop(time + dur + 0.03);
    }

    _shaker(time, gain, accented = false) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const amp = ctx.createGain();
        const dur = accented ? 0.07 : 0.035;

        src.buffer = this.noiseBuffer;
        filter.type = 'highpass';
        filter.frequency.value = accented ? 4800 : 6400;

        amp.gain.setValueAtTime(gain, time);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);

        src.connect(filter).connect(amp).connect(this.musicBus);
        src.start(time);
        src.stop(time + dur + 0.02);
    }

    _midi(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    }

    /* ── Sound effects ─────────────────────────────────────────────────── */

    play(name) {
        if (!this._ensure()) return;
        const time = this.ctx.currentTime + 0.005;

        switch (name) {
            case 'select':
                this._tone(620, 880, 0.07, 'sine', 0.045, time);
                break;
            case 'link':
                this._tone(330, 990, 0.16, 'triangle', 0.045, time);
                break;
            case 'match': {
                const notes = [659.25, 830.61, 987.77, 1318.51];
                notes.forEach((freq, index) => {
                    this._tone(freq, freq, 0.22, 'triangle', 0.075 - index * 0.008, time + index * 0.055);
                });
                this._noiseBurst(time, 0.05, 0.035, 3200);
                break;
            }
            case 'invalid':
                this._tone(190, 120, 0.18, 'square', 0.055, time);
                this._tone(150, 110, 0.2, 'square', 0.04, time + 0.09);
                break;
            case 'hint':
                [880, 1108.73, 1318.51, 1760].forEach((freq, index) => {
                    this._tone(freq, freq, 0.3, 'sine', 0.05, time + index * 0.07);
                });
                break;
            case 'shuffle':
                this._whoosh(time);
                break;
            case 'pause':
                this._tone(520, 330, 0.12, 'sine', 0.05, time);
                break;
            case 'resume':
                this._tone(330, 520, 0.12, 'sine', 0.05, time);
                break;
            case 'win':
                [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
                    this._tone(freq, freq, 0.34, 'triangle', 0.075, time + index * 0.11);
                });
                this._tone(1567.98, 1567.98, 0.5, 'sine', 0.04, time + 0.44);
                break;
            case 'lose':
                [392, 329.63, 261.63].forEach((freq, index) => {
                    this._tone(freq, freq * 0.97, 0.32, 'sawtooth', 0.045, time + index * 0.14);
                });
                break;
            case 'click':
            default:
                this._tone(520, 620, 0.05, 'sine', 0.035, time);
                break;
        }
    }

    _tone(freq, endFreq, dur, type, gain, time) {
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);
        if (endFreq !== freq) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), time + dur);
        }

        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);

        osc.connect(amp).connect(this.sfxBus);
        osc.start(time);
        osc.stop(time + dur + 0.03);
    }

    _noiseBurst(time, dur, gain, cutoff) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const amp = ctx.createGain();

        src.buffer = this.noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.value = cutoff;
        filter.Q.value = 0.9;

        amp.gain.setValueAtTime(gain, time);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);

        src.connect(filter).connect(amp).connect(this.sfxBus);
        src.start(time);
        src.stop(time + dur + 0.02);
    }

    _whoosh(time) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const amp = ctx.createGain();

        src.buffer = this.noiseBuffer;
        src.loop = true;
        filter.type = 'bandpass';
        filter.Q.value = 0.8;
        filter.frequency.setValueAtTime(360, time);
        filter.frequency.exponentialRampToValueAtTime(2600, time + 0.3);

        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(0.09, time + 0.05);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);

        src.connect(filter).connect(amp).connect(this.sfxBus);
        src.start(time);
        src.stop(time + 0.36);
    }
}
