# Fruit Link — retention pass v1

Status: **decisions locked 2026-11-02, not implemented yet.** Numbers below are the build target.

## Locked decisions

| # | Decision | Value |
| --- | --- | --- |
| 1 | Combo cap | **×8** at chain 5 (aggressive ladder) |
| 2 | Score record | **Re-baseline** to `fruit-link-best-v2` = `{ score, clearedPct, chain }` |
| 3 | Daily seed | **Device-local date** `YYYY-MM-DD` + mode id |
| 4 | Last 30 s | **Busier, same volume** — shaker at 30 s, 120 BPM at 15 s, root drone at 10 s |
| 5 | Pause and the chain | **Frozen, not reset** (default; the combo clock stops with the timer) |
| 6 | End-screen stats | Crate cleared %, longest chain, gap to best |
| 7 | Daily score | Stored **separately** from the endless best |

Unchanged answers stay parked: no unlockable tiers, no server, no accounts.

---

## Baseline (what the game does today)

| Fact | Value | Source |
| --- | --- | --- |
| Run length | 180 s | `js/config.js:34` |
| Pair score | `100 + 10 × secondsLeft` | `js/config.js:35-36`, `js/game.js:193` |
| Full-clear bonus | `20 × secondsLeft` | `js/config.js:37`, `js/game.js:225` |
| Hint cost | −10 s | `js/config.js:38` |
| Shuffle cost | −30 s | `js/config.js:39` |
| Modes | Static / Gravity ↓ / Gravity ← | `js/config.js:67-71` |
| Board size | 54–132 cells, chosen by viewport | `js/config.js:48-50`, `chooseGrid()` |
| Persistence | best score + mute only | `fruit-link-best-v1`, `fruit-link-muted-v1` |
| Music | procedural calypso, 108 BPM, 32-step loop | `js/audio.js:23-38` |

The problem: every pair is worth the same, the run never accelerates, and the only thing that
survives a session is one number. The four features below fix that in order of cheapest impact.

---

## F1 — Combo ladder (makes a single run accelerate)

**Rule.** A match that completes within **3 s** of the previous match's completion raises the
chain by 1. The chain is the multiplier applied to that pair's score.

| Chain | Multiplier | Match SFX pitch |
| --- | --- | --- |
| 1st pair | ×1 | base |
| 2nd | ×2 | +2 semitones |
| 3rd | ×3 | +4 |
| 4th | ×5 | +7 |
| 5th+ | ×8 (cap) | +9 |

**New formula:** `pair = (baseScore + timeBonus × floor(secondsLeft)) × multiplier`.

**Reset conditions.**

| Event | Chain |
| --- | --- |
| Timeout (> 3 s between matches) | reset to 0 |
| `invalid` tap (unconnectable pair) | reset to 0 |
| Shuffle (paid or deadlock) | reset to 0 |
| Pause | **frozen**, not reset (locked) |
| Hint used | kept — hint costs time, not rhythm |

**Why 3 s.** A path animation is 0.30 s and a remove is 0.24 s (`js/config.js`), so a confident
player clears a pair in roughly 1.2–2.0 s including the search. The window shipped at 2.6 s and the
user asked for more room on 2026-11-02, so it is 3 s: still a flow reward, but a slightly harder
search no longer costs the ladder.

**Feedback.** `×2!` text at the pair midpoint via the existing `ui.popScore` lane, a chain pip
next to the score tag, a rising match pitch from `js/audio.js` (`play('match', { semitones })`), and
a **fuse meter** in the HUD band below the timer — a thin rail that burns down from the right, its
glowing tip travelling back toward the left as the window empties, flickering and glowing hotter as
the ladder climbs. The fuse is lit from chain 1, so
the player sees the window open before the first multiplier lands.

**Locked.** Cap ×8. Pause freezes the chain (the combo clock is game time, so it stops with the
timer). Records re-baseline: new bests live in `fruit-link-best-v2` as
`{ score, clearedPct, chain }`, and the menu shows the chain trophy rather than trying to reconcile
it with pre-combo scores.

---

## F2 — End-of-run feedback (near-miss framing)

"Time's up! Score 1350" says nothing about how close the run was. Add three stats to both end
screens (`index.html:176-215`), passed from `_finishGame` (`js/game.js:215-246`):

- **Crate cleared** — `1 − remaining/total` as a percentage.
- **Longest chain** — from F1.
- **Gap to best** — `+X` / `−X` against the stored best.

**Conditional copy** on the game-over card:

| Cleared | Headline |
| --- | --- |
| ≥ 80 % | "So close — N tiles left." |
| 40–79 % | "Good crate. Your best was X %." |
| < 40 % | "The crate wins this round." (current copy) |

**Why it works.** Loss aversion is the cheapest retry hook available; it costs one line of copy
and three DOM nodes, and it makes the Retry button mean something.

**Locked.** Three stats: crate cleared %, longest chain, gap to best. No "time used".
The `fruit-link-best-v2` record stores `{ score, clearedPct, chain }` so both the "gap to best"
line and the 40–79 % copy ("your best was X %") read from one place.

---

## F3 — Daily crate (seeded board) + day streak

**Deterministic board.** Replace `Math.random` in `Util.shuffle` (`js/config.js:82-88`) with an
injected RNG (mulberry32, ~10 lines). Seed = the player's local date `YYYY-MM-DD` plus mode id.
`Board.reset` (`js/board.js:20`) and the deadlock auto-shuffle both draw from the same stream, so
the whole run is reproducible: everyone gets the same crate that day, and every replay of that day
replays identically.

**Streak.** Local record `fruit-link-daily-v1`: `{ lastDay, streak, bestStreak, scores: {} }`.
Playing a daily increments the streak when `lastDay` is yesterday; a missed day resets it to 1.
Same-day replays never change the streak and keep the best of the attempts.

**Reward.** A "Daily" stamp plus the streak number on the menu card. No unlocks, no gates, no
server — this stays inside the "polish, not accounts" scope.

**Cost.** This is the only feature here that touches deal logic, so it carries real regression risk
for the endless mode. It goes last.

**Locked.** Device-local date drives the seed. Daily scores live in their own record, never mixed
with the endless best. The streak is a number and a stamp — no reward tier in v1.

---

## F4 — Last-30-seconds tension

The HUD already flips `is-low` at ≤ 30 s and `is-critical` at ≤ 10 s (`js/ui.js:104-105`) but the
audio does not react at all. Two hooks, both cheap:

**Music (busier, not louder).** The scheduler reads `this.stepDur` every step
(`js/audio.js:23`, `js/audio.js:176-187`), so tempo and layer changes take effect mid-loop without
a restart.
- ≤ 30 s: add a shaker/tambourine noise hit on the off-beats (reuses the existing noise buffer).
- ≤ 15 s: tempo lift 108 → 120 BPM (`stepDur = 60 / 120 / 2`).
- ≤ 10 s: one warning sting, then the melody drops to the root drone so the board reads louder than the music.

**Visual.** Timer bar gets a slow heartbeat scale, crate border warms toward red, and the score tag
stops bumping (removes a competing animation at exactly the moment the player needs to read the clock).

**Locked.** Busier, same volume. `master.gain` stays at 1 — the only level change is the existing
`musicBus` fade used for pause/finish, so a muted-or-not player never gets a surprise volume jump.

---

## Out of scope for this pass

Accounts, server leaderboards, share cards, analytics, ads, and the unlockable fruit/mode tiers
(parked — they only pay off once F1/F2 show that players finish runs).

---

## Build order and verification

1. **F1 combos** — changes the core loop; everything else reads the chain stat.
2. **F2 end screens** — small, immediate, and it is where players look for a reason to retry.
3. **F4 tension** — pure feel, no logic risk.
4. **F3 daily + streak** — new deal path, needs its own test pass.

Per feature, the same QA loop we already use: real clicks in Chromium at 390×844, 320×568 and
844×390, screenshot evidence, zero console errors, and an explicit `localStorage` migration check
(old key present → new fields written without losing the old best).
