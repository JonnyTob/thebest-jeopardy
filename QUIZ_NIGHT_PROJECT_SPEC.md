# Quiz Night — Product and Technical Specification

**Version:** 2.0 — updated 2026-10-25  
**Status:** Working design baseline; implementation details and optional settings may evolve.  
**Reference:** [Surge-Tech Jeopardy](surge-jeopardy/) for architectural inspiration only; Quiz Night is a new app without a Jeopardy board.

## 1. Product vision and scope

Quiz Night is a locally hosted, multimedia, multiplayer buzzer quiz. One Windows laptop runs the Node.js server and a private gamemaster browser; an HDMI-connected TV in **Extend** mode shows the separate public display; players join from phones on the same Wi-Fi using a URL/QR code, nickname and avatar. Questions are advanced sequentially by the gamemaster, with image, video, audio or text clues. Answers are **spoken aloud** and judged exclusively by the gamemaster. No categories, selectable tiles, typed answers, automated speech recognition or automatic scoring.

**POC first:** Static `data/questions.json`, local assets under `public/media`, in-memory session/players/scores, no database, no question editor and no permanent history. Restart loses the active session. **Later:** SQLite, quiz authoring, uploads, template library, persistent sessions and archives. Keep a storage abstraction so the POC can evolve without rewriting the game engine.

## 2. Roles, routes and security

| Route | Screen | Responsibilities |
|---|---|---|
| `/display` | Public 16:9 TV | Headline, clue/media, shrinking point/timer bar, buzzer status, current answering player, top-player scoreboard, host-triggered answer reveal |
| `/admin` | Private laptop browser | Start/advance/close questions, media controls, private answer, correct/wrong rulings, manual score changes/undo, complete sortable player list, game setup |
| `/play` | Player phone | Join, choose nickname/avatar, BUZZ, own score/rank, eligibility and connection status |
| Node.js server | Same laptop | Authoritative clock/point value, first-buzz arbitration, player eligibility, scoring decisions, synchronized state |

**Setup:** Win+P → Extend; place `/display` on TV in fullscreen (F11); keep `/admin` on laptop. Server listens on LAN interface, firewall allows its port, and Wi-Fi client isolation is disabled. Only TV should produce clue audio. Admin commands require authenticated host privileges; the correct answer is never transmitted to public/phone clients before reveal. Server must reject unauthorized score changes, not merely hide UI buttons.

## 3. Public TV design — BASELINE

**The latest public TV mockup is the layout baseline**, including its alternate **purple / gold / magenta game-show color scheme**. The earlier navy/blue/gold palette remains an optional theme. The structure, not any particular illustrative image or score, is canonical.

### 3.1 Fixed three-region layout (16:9)

1. **Upper-left clue panel (~70–75% of upper width):** (a) persistent question **headline** at top; (b) largest practical **media area** for image, uncropped aspect-preserving video, audio visualization or text; (c) a **horizontal decreasing timer/points bar** beneath media, with prominently displayed current point value and elapsed clue time. The bar freezes when a buzz is accepted. Media must not be cropped merely to accommodate more player cards.
2. **Upper-right buzzer panel (~25–30% of upper width):** Green **BUZZ NOW**, amber **LOCKED / PLAYER ANSWERING**, muted/red **QUESTION CLOSED**; large avatar/name of first buzzer, even when that player is outside the TV leaderboard. No answer countdown: the gamemaster listens and judges at their own pace.
3. **Bottom fixed-height, SINGLE-ROW leaderboard:** Avatars, nicknames, scores, optional rank/status. **Do not add a second row** as the player count increases; preserve media height. Default **top 8 players**, configurable. Label e.g. `TOP 8 OF 12 PLAYERS` / `12 CONNECTED`. With fewer players show all, in larger cards. Rank by score descending; ties use deterministic stable ordering. **Freeze leaderboard ordering during an active clue** and re-rank between questions; scores may update immediately without shuffling cards. If a non-top-8 player buzzes, always show them prominently in the right-side buzzer panel. Their own phone always shows personal score/rank.

The TV does not need to display all connected players. The admin dashboard always shows everyone, in a **compact, sortable table** with rank, avatar/name, score, connectivity, buzzer eligibility, locked-out/answering state and gamemaster-only adjustment controls. This removes the TV layout as the main player-count constraint; practical capacity still depends on network/server performance and game dynamics.

**Lobby/welcome layout:** Before the host starts, the large left clue panel
shows the quiz's optional `coverImage`, with aspect ratio preserved and the quiz
name/ID on a dark overlay. Each Quiz ID can reference a separate local cover,
for example `/media/covers/100001.svg`. Without a cover, use the default gradient
background; a configured cover that fails to load must display an explicit warning.
The right panel shows the QR code and join instructions below **WAITING TO START**.
These TV join elements are lobby-only and disappear when the host starts the
game; active/closed questions and final standings use the normal buzzer panel.
The bottom single-row leaderboard remains fixed throughout. This is a display
rule, not a restriction on players joining via an existing link.

### 3.2 Baseline wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ♛ QUIZ NIGHT                                            QUESTION 08 / 25      │
├─────────────────────────────────────────────────────────┬────────────────────┤
│ QUESTION                                                │ BUZZER STATUS      │
│ Which famous landmark is this?                          │ ● BUZZ NOW         │
│                                                         │                    │
│         [LARGE 16:9 IMAGE / VIDEO / AUDIO VISUALIZER]   │ [AVATAR OF BUZZER] │
│                                                         │ [NAME / ANSWERING] │
│ TIME / POINT VALUE                            300 pts   │                    │
│ [██████████████░░░░░░░░░░░]                   6s / 20s  │ [MEDIA STATUS]     │
├─────────────────────────────────────────────────────────┴────────────────────┤
│ TOP 8 OF 12 PLAYERS — ONE ROW, FIXED HEIGHT                                 │
│ 🐱 Emma 1200 | 🐧 Ella 1000 | 🐯 Oliver 900 | 🐰 Sofie 800 | ...             │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Responsive priority:** preserve question readability and uncropped video first; compact player cards as necessary. A 55–75-inch TV can show approximately 8 comfortable leaderboard cards. Other players are not hidden from the game, only omitted from the public leaderboard row.

## 4. Clue timer and dynamic risk/reward scoring

**New gameplay baseline replacing the earlier fixed ±100 and 10-second post-buzz answer timer.** The clock runs **while buzzing is open**, not while someone answers verbally.

- **Illustrative default:** 20-second decreasing-value window, starting at **500 points**, dropping by **100 every 5 seconds** to a **100-point minimum**. The exact schedule should be configurable later. At or beyond 20 seconds, value remains 100; **the question does not auto-close**, and media can continue until the host closes it.
- The **bar** communicates remaining high-value window; it can reach its end while the clue stays playable and buzzable at the minimum value. The bar is not a deadline for answering.
- The first valid buzz **atomically freezes** clue elapsed time, the points-at-buzz, video/audio playback and progressive image reveal. Other buzzers lock.
- The player answers **verbally with no fixed answer deadline**. The gamemaster can take as long as needed to judge.
- **Correct:** Gamemaster clicks Correct; server awards **+frozen point value** and closes question.
- **Wrong:** Gamemaster clicks Wrong; server deducts **−frozen point value** (symmetric risk), locks that player out for the rest of the question, resumes the clue clock/media/reveal from frozen position and reopens buzzing for eligible others.
- **No score change happens automatically**, including on buzz, media ending, time reaching minimum or host pauses. Negative total scores are allowed. Host can manually adjust or undo a ruling.
- The host may pause/resume the clue and point clock, close/skip/reveal questions and reset a question as an explicit override.

**Example value function (illustrative, elapsed seconds `t`):** `max(100, 500 - 100 * floor(t / 5))`. On a buzz, the server stores `pointsAtBuzz` and uses it for either ruling. A client-side display must not independently decide the awarded amount.

## 5. Media and reveal effects

### 5.1 Images — reveal INSIDE the game

The React/TypeScript TV renderer implements configurable reveal effects; the Node.js server owns clue timing and synchronization. The gamemaster need not pre-render reveal videos. Suggested modes:

- Static image (no reveal).
- **Random tile reveal** (first POC effect): covered grid tiles disappear over the configured duration, with a deterministic seed/order so reconnects reproduce the same image.
- Wipes from left/right/top/bottom, and center outward (`clip-path` / SVG masks).
- Blur-to-sharp (`filter: blur(...)`).
- Zoom-out from a **configurable start position** (percentage `x/y`) and zoom factor; eventual editor lets host click the image to choose the focus.
- Multiple reveal points / complex masks later, if useful.

Every effect consumes the same normalized server-authoritative `revealProgress` (or derives it from authoritative elapsed clue time). Buzz/pause freezes it; wrong ruling resumes it. Media dimensions and video aspect ratio remain intact.

Example question fields:

```json
{
  "id": "q8",
  "type": "image",
  "question": "Which famous landmark is this?",
  "media": "/media/eiffel.jpg",
  "answer": "Eiffel Tower",
  "reveal": {
    "effect": "tiles",
    "durationSeconds": 20,
    "columns": 8,
    "rows": 6,
    "seed": 814
  }
}
```

For zoom, replace `reveal` with e.g. `{ "effect": "zoom", "durationSeconds": 20, "startPosition": { "x": 65, "y": 35 }, "startZoom": 5 }`.

### 5.2 Audio-only questions — built-in music visualizer

Play audio **only in the TV browser**. Use the browser **Web Audio API** (`AnalyserNode`) to render a real-time Canvas/SVG visualizer; Node.js need not analyze the audio. Visual styles: **spectrum bars** (POC), waveform, pulsing rings (later). Visualizer is decorative, not a clue spoiler. Freeze or clearly pause visualization on buzz; resume on wrong. Allow optional playback segment (`startSeconds`, `endSeconds`) without modifying the source file. Handle browser autoplay restrictions with a host-initiated playback/unlock step.

```json
{
  "id": "q12",
  "type": "audio",
  "question": "Name the artist and song",
  "media": "/media/music12.mp3",
  "answer": "A-ha — Take On Me",
  "visualizer": { "enabled": true, "style": "spectrum" },
  "playback": { "startSeconds": 15, "endSeconds": 45 }
}
```

### 5.3 Video and text

Video uses native aspect-preserving playback with pause/resume at the current time; subtitles/details should remain legible. Text-only questions use the same headline/media/points layout with appropriately large typography. All clue types share the same authoritative buzzer and point-clock rules.

## 6. Player avatars and phones

Players choose a nickname and avatar on joining. POC: a curated collection of ~30–50 locally bundled **SVG animal/character avatars**, with a small starter subset acceptable. Candidates: **OpenMoji** (check CC BY-SA 4.0 attribution/share-alike obligations) and **DiceBear** styles (check individual style licenses). Store a stable `avatarId`, not just a platform-dependent emoji; use it consistently on phone, TV and admin. Later optionally add avatar generation/customization.

Phone UI: large BUZZ button, own avatar, name, current score and rank, states **Waiting / Buzz open / You buzzed first / Someone answering / Locked out / Closed / Reconnecting**. Phones do not play clue audio or display the private answer. Players can attempt only once per question after a wrong ruling.

## 7. Gamemaster/admin interface

**Quiz identity:** Every quiz template has a permanent positive integer `id`,
stored beside `title` and `questions` in the quiz JSON. Use this ID, not the
editable title, to identify quizzes in the future library. Keep it unchanged
across edits and played sessions; a separate quiz must receive a different ID.
Display it as `Quiz #100001` beside the quiz name on TV, phone join/play, and
admin live/setup screens. It is a library identifier, not a temporary join PIN
or host credential.

**Live Game** includes: current question and private answer; media preview and play/pause/restart; current point value and elapsed clue time; active buzzing player and **frozen points-at-buzz**; prominent `CORRECT +N` / `WRONG −N` buttons; host-controlled reveal/close/next; undo/manual score adjustment; complete compact sortable player table. The admin sees every player even if the TV shows only top 8. Include connection and lockout indicators and player-management controls.

**Game Setup (POC):** quiz title, JSON source, default point schedule, leaderboard visible count (default 8), avatar choices and optional theme. **Future Quiz Library/Editor:** create/edit/duplicate/reorder questions, upload media, configure reveal effect/start position, choose audio visualizer, preview, save reusable quiz templates. **Future History:** separate played-session archives with question outcomes, players, rankings, scores and event audit log. Keep templates distinct from historical playthroughs.

## 8. Gameplay state machine

```text
LOBBY
  └─ host opens question → QUESTION_OPEN
       (media/reveal running, clue clock running, buzzers enabled)
          ├─ first valid buzz → ANSWERING
          │    (freeze media/reveal/clock and pointsAtBuzz; lock buzzers)
          │      ├─ host CORRECT → QUESTION_CLOSED (+pointsAtBuzz)
          │      └─ host WRONG → QUESTION_OPEN (-pointsAtBuzz;
          │           lock out that player; resume media/reveal/clock)
          └─ host CLOSE → QUESTION_CLOSED
                  ├─ host REVEAL → ANSWER_REVEALED
                  └─ host NEXT → next QUESTION_OPEN

After final question → GAME_FINISHED
Future persistence: GAME_FINISHED → ARCHIVED
```

The gamemaster may pause/reopen/override. No answering countdown and no automatic score changes. If all players fail, the host reveals/closes/advances. A media clip ending does not automatically close the question. Protect against duplicate buzzes and double-processed rulings; undo must restore scores and eligibility consistently.

## 9. Architecture and synchronization

- **Frontend:** React + TypeScript + Vite; CSS/Tailwind for layouts. Separate `/display`, `/admin`, `/play` views.
- **Backend:** Node.js + TypeScript + Socket.IO (plus HTTP server for assets/quiz JSON).
- **POC state:** in-memory session with players, scores, question index, `phase`, eligible/locked-out player IDs, `activePlayerId`, `pointsAtBuzz`, `clueElapsedMs`, playback position, media state, reveal seed/config, score events and monotonic `revision`.
- **Clock:** server owns accumulated elapsed time and running/paused state, broadcasts snapshots/timestamps. TV animates locally between resyncs; never awards points itself. Ensure timer freezes atomically with accepted buzz, using server receipt/ordering as the authoritative rule.
- **Media:** TV is sole playback/visualization renderer; reports playback position on pause. Server tracks canonical position and issues pause/resume; recover from refresh/reconnect without changing reveal tile order or silently resetting the clock.
- **Host authorization:** only authenticated gamemaster can judge/adjust scores or control game. Use idempotency IDs on rulings.
- **Future persistence:** SQLite tables for QuizTemplate, Question, MediaAsset, GameSession, SessionPlayer, QuestionAttempt and SessionEvent; local media filesystem; migration and backup strategy later.

Suggested events: `player:join`, `player:buzz`, `host:questionStart`, `host:cluePause`, `host:clueResume`, `host:judgeCorrect`, `host:judgeWrong`, `host:revealAnswer`, `host:closeQuestion`, `host:nextQuestion`, `host:scoreAdjust`, `host:undo`; server emits `session:snapshot`, `buzz:accepted`, `buzz:rejected`, `clue:stateChanged`, `score:updated`, `player:lockedOut`, `question:closed`, `answer:revealed`.

## 10. POC build order

1. Local Node/React app, LAN join URL/QR, host + TV + phone views; in-memory state and JSON questions.
2. Nickname/avatar selection, lobby and authoritative first-buzz arbitration.
3. **Baseline TV layout** (headline + media + point bar, buzzer sidebar, one-row top-8 leaderboard); compact complete admin player list.
4. Server-controlled decreasing points and clue timer; freeze on buzz, host-only symmetric scoring, wrong-answer lockout/resume, manual adjustments and undo.
5. Image/video/audio media playback; pause/resume; **random tile reveal**; **spectrum-bar audio visualizer**.
6. Reconnection, TV readability, browser audio permissions, error handling and testing.
7. **Later:** other reveal modes/positions, alternate visualizer styles, full editor, SQLite persistence, template library and game history.

## 11. Acceptance tests

- [ ] Laptop admin and HDMI-extended TV show different synchronized views; phones join on LAN.
- [ ] TV uses fixed **headline / aspect-preserving media / decreasing point bar** in left panel and buzzer status on right.
- [ ] TV shows **one leaderboard row** with top 8 by default, no second row even with 12+ players; ordering stays stable during a clue.
- [ ] Admin sees **all** connected players in a compact sortable list; every phone sees its own score and rank.
- [ ] Player outside the TV top 8 who buzzes appears in the right buzzer panel.
- [ ] Two nearly simultaneous buzzes produce exactly one winner, with frozen points-at-buzz.
- [ ] During verbal answering, there is **no answer countdown** and no point decay; clue media/reveal freezes.
- [ ] Correct awards +frozen points only after gamemaster click; Wrong deducts the same frozen points only after gamemaster click.
- [ ] Wrong player cannot rebuzz this question; others can; media/reveal/clock resume where stopped.
- [ ] At the minimum value, the clue remains open and buzzable until host closes it.
- [ ] Random tile reveal is deterministic and pause/resume/reconnect safe.
- [ ] Audio spectrum responds to actual sound and pauses with playback; TV is the only audio source.
- [ ] No private answer is leaked before reveal; unauthorized clients cannot alter scores.
- [ ] Negative scores, host adjustments, undo, and reconnections work.
- [ ] POC works without database or internet; active state is knowingly ephemeral.

## 12. Decisions, defaults and open choices

**Design baseline agreed:** New sequential quiz, three separate views, verbal gamemaster-judged answers, no automatic scoring, server-arbitrated buzzes, media/reveal pause on buzz, wrong-player lockout, **dynamic clue-time point value rather than an answer timer**, integrated image reveals and audio visualizer, headline/media/point bar inside clue panel, **one-row top-player TV leaderboard**, complete admin player list, consistent avatar selection.

**Proposed defaults to validate in playtests:** 500→400→300→200→100 over 20 seconds; symmetric ±frozen value; minimum 100 thereafter; top 8 visible on TV; tile reveal and spectrum visualizer for POC; purple/gold/magenta as alternate theme alongside navy/gold.

**Open choices:** Exact point curve/duration; whether wrong penalties should always be symmetric or optionally reduced; how often to update leaderboard ordering between questions; maximum recommended total players; whether to add an explicit host-controlled `Pass` with no penalty; reveal defaults per question type; avatar asset licensing.

---

**Developer priority:** Reliable authoritative buzz/clock/score state, clear private/public boundaries, aspect-preserving media and robust pause/resume first. Add polish without compromising readability or deterministic gameplay.

## 13. Mockup examples

See [mockup](./mockup/) for different scrren examples. Can be used as baseline, but is not necessary decided graphical outline.