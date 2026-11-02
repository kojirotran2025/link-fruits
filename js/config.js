'use strict';

/* ---------------------------------------------------------------------------
 * Fruit registry. Order defines nothing but presentation; ids are what the
 * board and the renderer exchange.
 * ------------------------------------------------------------------------- */
const FRUITS = [
    { id: 'apple',      name: 'Apple',      src: 'assets/fruits/apple.webp?v=2',      tint: '#e8503a' },
    { id: 'orange',     name: 'Orange',     src: 'assets/fruits/orange.webp',     tint: '#f0902c' },
    { id: 'lemon',      name: 'Lemon',      src: 'assets/fruits/lemon.webp',      tint: '#f2c33b' },
    { id: 'grapes',     name: 'Grapes',     src: 'assets/fruits/grapes.webp',     tint: '#7c4d9e' },
    { id: 'strawberry', name: 'Strawberry', src: 'assets/fruits/strawberry.webp?v=2', tint: '#e24b5c' },
    { id: 'banana',     name: 'Banana',     src: 'assets/fruits/banana.webp',     tint: '#f2c230' },
    { id: 'watermelon', name: 'Watermelon', src: 'assets/fruits/watermelon.webp', tint: '#3f9b55' },
    { id: 'peach',      name: 'Peach',      src: 'assets/fruits/peach.webp',      tint: '#f49a86' },
    { id: 'pineapple',  name: 'Pineapple',  src: 'assets/fruits/pineapple.webp',  tint: '#d9a53b' },
    { id: 'kiwi',       name: 'Kiwi',       src: 'assets/fruits/kiwi.webp',       tint: '#7fa83c' },
    { id: 'cherry',     name: 'Cherry',     src: 'assets/fruits/cherry.webp?v=2',     tint: '#d6323c' },
    { id: 'blueberry',  name: 'Blueberry',  src: 'assets/fruits/blueberry.webp',  tint: '#3b4ba0' },
    { id: 'pear',       name: 'Pear',       src: 'assets/fruits/pear.webp',       tint: '#9bbf3b' },
    { id: 'avocado',    name: 'Avocado',    src: 'assets/fruits/avocado.webp',    tint: '#6e9a3b' },
    { id: 'mango',      name: 'Mango',      src: 'assets/fruits/mango.webp',      tint: '#f08a3c' },
    { id: 'coconut',    name: 'Coconut',    src: 'assets/fruits/coconut.webp',    tint: '#9a6b42' },
];

const FRUIT_BY_ID = Object.freeze(
    Object.fromEntries(FRUITS.map(fruit => [fruit.id, fruit]))
);

/* ---------------------------------------------------------------------------
 * Single source of truth for tuning, layout and copy-free constants.
 * ------------------------------------------------------------------------- */
const CONFIG = Object.freeze({
    GAME_DURATION: 180,          // seconds
    baseScore: 100,
    timeBonus: 10,               // points per second left when a pair clears
    clearBonus: 20,              // extra points per second left on a full clear
    hintCost: 10,
    shuffleCost: 30,
    hintDuration: 4,             // seconds a hint stays lit

    // Combo ladder: a link made within comboWindow of the previous one climbs
    // the multiplier table, and the match chime climbs with it.
    comboWindow: 2.6,
    comboMultipliers: [1, 2, 3, 5, 8],
    comboDetune: [0, 2, 4, 7, 9],  // semitones added to the match chime per step

    animPath: 0.30,
    animRemove: 0.24,
    animShuffle: 0.50,
    animFall: 0.18,

    emptyRatio: 0.06,            // share of the crate that starts empty
    targetCells: 88,
    minCells: 54,
    maxCells: 132,
    tileMin: 34,
    tileMax: 96,
    gapRatio: 0.10,
    padRatio: 0.42,

    storageKey: 'fruit-link-best-v2',   // { score, clearedPct, chain }

    STATE: Object.freeze({
        MENU: 'menu',
        PLAYING: 'playing',
        PAUSED: 'paused',
        SHUFFLE: 'shuffle',
        GAME_OVER: 'gameover',
        WIN: 'win',
    }),

    MODES: Object.freeze({
        1: { id: 1, label: 'Static',    short: 'Static', hint: 'Fruit stays put' },
        2: { id: 2, label: 'Gravity ↓', short: 'Down',   hint: 'Fruit falls down' },
        3: { id: 3, label: 'Gravity ←', short: 'Left',   hint: 'Fruit slides left' },
    }),
});

/* ---------------------------------------------------------------------------
 * Small shared helpers.
 * ------------------------------------------------------------------------- */
const Util = {
    clamp(value, min, max) {
        return value < min ? min : value > max ? max : value;
    },

    shuffle(list) {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    },

    formatTime(seconds) {
        const whole = Math.max(0, Math.ceil(seconds));
        const minutes = Math.floor(whole / 60);
        const rest = whole % 60;
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    },

    /** 0 → 1 with a small overshoot, used for sticker drop-ins. */
    easeOutBack(x) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        const t = x - 1;
        return 1 + c3 * t * t * t + c1 * t * t;
    },

    easeOutCubic(x) {
        return 1 - Math.pow(1 - x, 3);
    },
};

/* ---------------------------------------------------------------------------
 * Layout. A tile is a square; the crate adds a routing ring around the grid so
 * paths can travel "outside" the fruit, exactly like classic link games.
 * ------------------------------------------------------------------------- */
function tileSizeFor(cols, rows, width, height) {
    const widthUnits = cols + (cols - 1) * CONFIG.gapRatio + 2 * CONFIG.padRatio;
    const heightUnits = rows + (rows - 1) * CONFIG.gapRatio + 2 * CONFIG.padRatio;
    if (widthUnits <= 0 || heightUnits <= 0) return CONFIG.tileMin;
    return Math.floor(Math.min(width / widthUnits, height / heightUnits));
}

/**
 * Pick the grid that turns the available stage into the biggest comfortable
 * tiles. Bigger boards are preferred up to ~88 cells, then variety tapers off.
 */
function chooseGrid(width, height) {
    let best = null;

    for (let cols = 5; cols <= 16; cols++) {
        for (let rows = 5; rows <= 14; rows++) {
            const cells = cols * rows;
            if (cells < CONFIG.minCells || cells > CONFIG.maxCells) continue;

            const tile = tileSizeFor(cols, rows, width, height);
            if (tile < CONFIG.tileMin || tile > CONFIG.tileMax) continue;

            const score = tile - Math.abs(cells - CONFIG.targetCells) * 0.07;
            if (!best || score > best.score) {
                best = { cols, rows, tile, score };
            }
        }
    }

    if (best) return best;

    // Extremely small viewport: fall back to the smallest sensible crate.
    return { cols: 6, rows: 8, tile: CONFIG.tileMin, score: 0 };
}
