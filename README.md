# Kaboot

A locally hosted, sequential multiplayer buzzer quiz. The gamemaster runs the
show on a laptop, a separate TV displays clues, and players buzz from their
phones. Answers are spoken aloud and scored only by the gamemaster.

The application source lives under [src/](./src/), with standalone development
helpers in [script/](./script/). It is separate from the archived
Jeopardy project; there is no category/tile board.

## Run locally

Requires **Node.js 22+** and npm. Run these commands from the repository root:

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. The terminal prints a randomly generated **host
passcode** for the private console. Do not share it with players.

| Route | Purpose |
| --- | --- |
| `/` | Screen chooser and LAN join link / QR code |
| `/admin` | Authenticated host console, setup, rulings, scores, and full player list |
| `/display` | TV clue, buzzer sidebar, and a single-row top-player leaderboard |
| `/play` | Phone nickname/avatar selection, personal score/rank, and buzzer |

For a production build (recommended for quiz night):

```sh
npm run build
npm start
```

Both modes serve the app and Socket.IO from **one port**, default `3000`, on all
network interfaces. Set `PORT` to change it. Optionally set `HOST_PASSCODE` to a
private value of at least eight characters; otherwise one is generated at launch.
For example, in PowerShell:

```powershell
$env:PORT = "3000"
npm start
```

### Settings files

[settings.json](./settings.json) is the global configuration, with three sections:

```json
{
  "branding": {
    "name": "Kaboot",
    "logoText": "K",
    "tagline": "Buzz in. Get booted."
  },
  "server": {
    "port": 3000,
    "joinOrigin": "http://192.168.1.42:3000",
    "maxPlayerNameLength": 24,
    "requireAdminPasscode": true,
    "maxPlayers": 12
  },
  "gameSetup": {
    "leaderboardCount": 8,
    "startPoints": 500,
    "minimumPoints": 100,
    "dropPoints": 100,
    "dropEverySeconds": 5,
    "lockoutSeconds": 0,
    "maxAnswerLength": 100
  }
}
```

- **branding**: global, file-only presentation settings. `name` (1-100 characters)
  appears in headers, browser titles, loading/error messages, player join buttons,
  and server logs. `logoText` (1-4 characters) replaces the logo letter, and
  `tagline` (up to 160 characters, or empty) appears on the home page.
  Branding is separate from the quiz's editable title and cannot be overridden
  per quiz. Restart the server and reload browser pages after editing it.
  No rebuild is needed for branding-only changes to an existing production build.
  Browser storage keys remain unchanged so rebranding does not itself discard
  saved player identities or host passcodes.
- **server**: file-only options; never editable through Game setup.
  `joinOrigin` is optional; omit it for automatic LAN address detection.
  `PORT` and `JOIN_ORIGIN` environment variables override the file.
  Keep the host passcode out of configuration files; use `HOST_PASSCODE` or
  the automatically generated passcode.
  - `maxPlayerNameLength`: maximum nickname length, **24** by default
    (whole number, 1-100). Names must contain at least one non-whitespace character.
    Both the phone input and the server enforce the configured limit.
  - `requireAdminPasscode`: **true** by default. Set to **false** to open the
    admin console without a login. This disables server-side host passcode
    verification, not just the login screen: anyone who can reach the server
    can control the quiz and see host-only answers. Use only on a trusted LAN.
    With protection disabled, `HOST_PASSCODE` is ignored.
  - `maxPlayers`: **12** by default (whole number, 1-1000). Counts all joined
    players, including disconnected players, until the host removes them.
    Reconnecting an existing player does not use another slot. New players
    cannot join a full game; phones show the limit and the server also enforces it.
- **gameSetup**: defaults for the host's editable settings. An optional `title`
  overrides the title from the question file; omit it to use the quiz's own title.
  `maxAnswerLength` (1-500; default 100) limits typed answers for this quiz.
- **settings/quizzes/\<quiz-id\>.json**: per-quiz overrides, identified by the
  numeric quiz ID in the question file. This file has a `gameSetup` section only.
  A missing per-quiz file means the quiz uses global defaults. You can create a
  partial override, for example `{"gameSetup":{"lockoutSeconds":10}}`.

On startup, values are merged in this order: quiz title, global game defaults,
then per-quiz overrides. **Save setup** writes all current game settings to that
quiz's file, creating it if needed. This includes the title but never server
options. Saved values take precedence over later global-default changes; remove
an override from the quiz file to inherit the global value again.

Both development and production read these files from the repository root at
startup. Restart the server after editing them manually. Missing/invalid global
configuration or invalid per-quiz settings stop startup with an error.
Save failures are reported to the host without changing the running setup.
Settings persist across restarts; players, scores and active game state do not.
Setup remains locked once the quiz starts.
None of the server-only options can be saved in a per-quiz override file.

### Laptop, TV, and phones

1. On Windows, use **Win+P -> Extend**. Move `/display` to the TV and press F11.
   Keep `/admin` on the laptop.
2. Connect phones to the same Wi-Fi. Allow the server port through the laptop's
   firewall; disable wireless client isolation if devices cannot reach each other.
3. Share the **LAN** `/play` address or QR code shown in the lobby. `localhost`
   on a phone refers to the phone, not the laptop. If the laptop has multiple
   network interfaces, select the Wi-Fi/LAN address rather than a VPN or virtual
   adapter. For remote VS Code environments, use an address reachable by players.
4. Only the TV renders audio/video. If autoplay is blocked, use its
   **Enable TV playback/audio** button; the host can pause the clue while doing so.
   Use one active TV playback tab to avoid duplicate audio.

Use a trusted private LAN, not an exposed public internet deployment: this POC
uses HTTP without TLS. The host passcode and player reconnect tokens are bearer
credentials. A player's token is stored in that browser's local storage; host
credentials are scoped to the admin browser tab's session storage.

### iPhone/Safari troubleshooting

For WSL or multiple network adapters, set `JOIN_ORIGIN` to the Windows PC's
Wi-Fi/LAN origin before starting the server, for example in the WSL terminal:

```sh
JOIN_ORIGIN=http://192.168.1.42:3000 npm run dev
```

Replace the example IP with the Windows Wi-Fi IPv4 address shown by `ipconfig`.
For production, use the same environment variable with `npm start`. Lobby/TV
QR codes will prefer this address instead of WSL's internal IP. Include the
phone-facing port; do not include `/play`. This only changes the advertised
address: it does not configure forwarding or open firewall ports.

With WSL2 NAT networking, Windows must forward the chosen TCP port to WSL's
server port, and Windows Firewall must allow incoming traffic from the private
LAN. Alternatively, use WSL mirrored networking with appropriate firewall
rules, or run the Node server directly on Windows. VPN LAN access must also be
allowed. Test the Windows LAN `/api/health` address from the phone before
sharing the QR code.

- Open `/api/health` on the **same origin as the phone's join URL**. If it does
  not load, check the address, firewall, and Wi-Fi client isolation. Chrome on
  the host using `localhost` does not verify that phones can reach the server.
- With WSL, use the Windows PC's Wi-Fi IPv4 address, not the WSL or container
  address. WSL networking/port forwarding and the Windows firewall must allow
  incoming connections to the server port.
- If the health check works but the join page stays on **Loading Kaboot** (or
  your configured brand name),
  the JavaScript has not started. Update iOS and try a production build
  (`npm run build`, then stop the development server and run `npm start`).
  A React crash instead shows an error message to share with the host.
- Blocked browser storage no longer prevents joining. Keep the player tab open:
  without storage, refreshing or closing it may lose your reconnect identity.

## Implemented core flow

- Authenticated host commands; server-filtered public snapshots never contain the
  official answer until the host explicitly reveals it. Typed submissions are
  private to the host until each submission is displayed during review.
- Server-arbitrated first buzz, a frozen points-at-buzz value, and no answer
  countdown. Correct awards the frozen value; wrong deducts it, locks that player
  out, and resumes the clue for everyone else.
- In **Game setup**, set **Wrong-answer lockout seconds** to 1-300 to allow
  retries on the same question. The player's phone shows a countdown, and the
  host's player table shows the remaining seconds. The timer starts when the
  host rules an answer wrong and continues during pauses, other players' answers,
  and disconnections. Once it expires, the player can buzz when buzzers are open.
  The default, **0**, preserves one attempt per question. Setup is locked after
  starting; resetting or advancing a question clears all lockouts.
- Configurable starting/minimum points and decay steps. Defaults are
  **500 -> 400 -> 300 -> 200 -> 100**, every five seconds. Minimum value and media
  ending never auto-close a question.
- Pause/resume, close/skip, reveal, next, question reset, media restart, manual
  positive/negative adjustments, and undo. Commands have idempotency IDs and stale
  revision checks.
- Six original inline SVG avatars; token-based reconnect preserves score,
  identity, and lockout. Reopening multiple tabs with the same token still counts
  as one player. An offline answering player remains active until the host rules
  or closes the clue.
- Leaderboard sorted immediately after every score change, including wrong-answer
  penalties, manual adjustments and undo during active clues. Highest scores come
  first; tied scores use join order. New players are inserted at their score rank;
  up to eight TV cards by default, all players in a sortable/searchable host table.
- Text and image clues, deterministic random tile reveals, and TV-only native
  audio/video rendering with an audio frequency-spectrum visualizer.
- **Game-start countdown:** clicking **Start quiz** starts a synchronized
  four-second `STARTING` phase. The TV darkens the board and shows giant
  **3 -> 2 -> 1 -> LET'S GO!** graphics, one second per step. Only then does
  the first question open and its clue clock, points, reveal and media begin.
  Buzzing, submissions and host game controls are disabled during the countdown.
  Reconnecting displays resume the current step rather than replaying it;
  later questions and question resets do not repeat it. The animation is silent
  and respects the browser's reduced-motion preference.
- **Everyone answers** questions accept one final typed submission per player.
  A guide timer counts down on the TV, host and phones, but submissions remain
  open until the host closes the clue. Pausing pauses the timer and submissions.
  The TV clue also shows a shrinking countdown bar using the question's
  `timerSeconds`. It freezes when paused or closed and stays empty at zero;
  it does not affect the fixed points or automatically close submissions.
  The host can see all submissions privately; other players see only the count.
  Use **Close submissions & start review** to close the clue and show the first
  answer on the TV in one step. Alternatively, use **Close submissions**, then
  **Start answer review**. Mark each answer correct or
  wrong, then advance manually. Correct earns the question's fixed points;
  wrong or missing answers earn zero. The leaderboard updates immediately.
  Review order is submission order, followed by non-submitters in join order.
  Players present when submissions close are included, even if disconnected;
  later joiners are not included in that review. The host can reveal the official
  answer or move to the next question after review finishes.

### Optional fast approval for typed answers

Enable **Fast approval** in the host's **Typed answers** pane to judge answers privately
without showing each one on the TV. This is manual judging, not automatic
answer matching. The checkbox defaults to off and affects only the host controls.

1. Enable **Fast approval** and mark submitted answers **Correct** or **Wrong**
  immediately, even while others are still answering or the question is paused.
  Correct earns the fixed points immediately; wrong earns zero.
2. **Close submissions** freezes the roster and adds missing answers, which can
  be marked **No answer** for zero points. Private judging remains available.
3. Use **Start answer review** (or **Close submissions & start review**) to display only the remaining unjudged entries,
   in the original order. Already-judged answers never appear in that TV review.
   If every entry was judged privately, starting review completes it immediately.

Quick rulings are available before TV review starts, both while submissions are
open and after they close. Normal review remains available whether the checkbox is on or off.
Undo applies to private rulings too, including zero-point rulings; it restores
the previous score and judgment state and can return the question to open or closed.
Answers received after a ruling are retained when that ruling is undone.
The host list retains all entries and their outcomes. TV review numbering still
refers to positions in the full roster, so skipping judged entries can skip numbers.

**Undo semantics:** Undo restores the latest score operation and its saved
question state, elapsed time, scores, and eligibility. Undoing a ruling restores
the answering player so the host can judge again. It never restores stale
connection status. Undo history is cleared on next/reset or player removal.
Reset reopens the current question at full value and clears lockouts and typed
submissions, but does
not erase previously awarded/deducted scores. Media restart restarts playback /
image reveal without resetting the point clock.

During typed-answer review, undo restores the last ruling and its score so it can
be judged again, including wrong and missing answers. Reset after scoring retains
awarded points, so use undo first if the scores should be reversed.

## Questions and media

Edit [src/data/questions.json](./src/data/questions.json), then restart the server.
The starter quiz has ten questions covering both modes and all four media types. Questions
are validated on startup; invalid data fails explicitly. The raw JSON is
**server-only** and is not exposed as a public HTTP resource.

Each quiz must have a permanent numeric `id` at the top level, alongside `title`
and `questions`. The starter quiz uses:

```json
{
  "id": 100001,
  "title": "Friday Night Quiz",
  "coverImage": "/media/covers/100001.svg",
  "questions": []
}
```

The empty array above illustrates the structure only; a playable quiz requires
at least one question. Existing quiz files must add the `id` field.
Use a unique positive safe integer for each quiz (1 to 9007199254740991).
Keep the ID when renaming or editing that quiz; assign a different ID when
creating a separate quiz. Future library entries should use this ID as their
identifier rather than the title. There is no multi-quiz library or automatic
cross-file uniqueness check yet.

The ID is shown as **Quiz #100001** beside the quiz name on TV, phone, and admin
live/setup screens. It survives server restarts because it is stored in the quiz
file, and it cannot be changed through session setup. This is a quiz/library ID,
not a temporary join PIN or the private host passcode.

### Question modes

The bundled quiz is also a playable examples catalog:

| # | Question ID | Type / mode | Features to try |
| --- | --- | --- | --- |
| 1 | `warm-up` | Text / buzzer | Omitted `mode` defaults to buzzer; separate headline and clue text |
| 2 | `mystery-image` | Image / buzzer | Deterministic 8 x 6 tile reveal over 20 seconds; buzz freezes it |
| 3 | `everyone-answers-text` | Text / typed | Everyone submits privately; 250 fixed points and a 30-second guide timer |
| 4 | `static-image` | Image / buzzer | Explicit `mode` and `static` reveal; count the five gold stars |
| 5 | `everyone-answers-image` | Image / typed | 6 x 4 tiles with a different seed; 15-second reveal independent of the 25-second guide timer |
| 6 | `audio-buzzer` | Audio / buzzer | Full eight-second original chime clip with live spectrum visualization |
| 7 | `everyone-answers-audio` | Audio / typed | Only seconds 4.5-8 of the same clip; visualization disabled; 300 fixed points |
| 8 | `video-buzzer` | Video / buzzer | Full original silent moving-shapes clip; aspect-preserving playback |
| 9 | `everyone-answers-video` | Video / typed | Seconds 2-6 of the clip; 150 fixed points and a 20-second guide timer |
| 10 | `last-call` | Text / buzzer | Return to buzzer mode after typed review, then finish the quiz |

For typed questions, join from a real phone/browser, submit, then use
**Close submissions & start review**, the correct/wrong ruling, and **Next review**
for every player. The combined button works before or after the guide timer
expires, including while paused. It immediately freezes submissions and the
review queue; there is no need to wait for zero or close the question separately.
You can still use **Close submissions** followed by **Start answer review**.
Reveal or advance once review is complete. A wrong or missing typed answer earns
zero, unlike the symmetric negative penalty for a wrong buzzer answer.
Neither guide timers nor clip endings automatically close a question.
The `players` helper only joins players; it does not submit typed answers.

All referenced media is bundled and works offline: the original rocket image,
an original ringed-planet illustration, a synthesized WAV (three ascending notes,
then three descending notes), and a silent 1280 x 720 MP4 of moving coloured
shapes. The latter three live in [src/public/media/examples/](./src/public/media/examples/).
The MP4 uses H.264 for broad browser compatibility.
Audio/video plays on the TV only and may need its playback-unlock button.
No commercial music, movie clips, remote URLs, or missing placeholder files are
needed for the bundled quiz.

Each question may use `"mode": "buzzer"` for the original first-buzz flow, or
`"mode": "typed"` for everyone to answer privately. Omitted `mode` defaults to
the original buzzer behaviour, so existing quiz files continue to work. A typed
question requires its own fixed point value and guide timer in seconds:

```json
{
  "id": "movie-1",
  "type": "text",
  "mode": "typed",
  "question": "Name the movie.",
  "answer": "The Matrix",
  "fixedPoints": 250,
  "timerSeconds": 30
}
```

`fixedPoints` is an integer from 1 to 10000; `timerSeconds` is an integer from
1 to 3600. The mode applies to text, image, audio and video clues. A player
cannot edit an answer after submitting; the same player reconnecting or opening
another tab cannot submit again. The host sets the per-quiz answer length in
**Game setup** and saves it with the other quiz settings.

### Lobby cover

Each quiz can optionally set `coverImage` to its own local image path. The
starter quiz includes an original **3840 x 2160 SVG illustration** in
[src/public/media/covers/100001.svg](./src/public/media/covers/100001.svg).
It is resolution-independent and remains sharp on 4K displays.
Use the Quiz ID in the filename to keep covers organized; other local SVG,
PNG, JPEG, or WebP covers can be referenced in the same way.

On the TV lobby, the cover fills the large left panel without cropping, with
the quiz name and ID on a dark overlay. The QR code and join instructions appear
in the right panel below **WAITING TO START**, and disappear when the host starts
the game. They do not reappear between questions or on the final screen.
The fixed single-row leaderboard remains below both panels.

Without `coverImage`, the title is shown on a built-in gradient background.
A configured image that fails to load shows an explicit warning while keeping
the title and QR available. Rebuild after replacing public assets in production.
Hiding the TV's join information does not disable joining via an existing link.

Place local media in [src/public/media/](./src/public/media/) and reference it as
`/media/your-file.ext`. Rebuild after changing public assets for production.
Use the fields described in the [project specification](./QUIZ_NIGHT_PROJECT_SPEC.md);
the first image effects supported are `static` and `tiles`.

An audio clue can use:

```json
{
  "id": "audio-1",
  "type": "audio",
  "question": "Name this sound",
  "media": "/media/your-audio.mp3",
  "answer": "Your private answer",
  "visualizer": { "enabled": true, "style": "spectrum" },
  "playback": { "startSeconds": 0, "endSeconds": 20 }
}
```

For a video, set `type` to `video` and use a browser-compatible local video file.
Only use media you have permission to use. The sample illustration and avatar
vectors are original to this implementation; no external avatar library is used.

## Source structure

```text
src/
  client/       React pages, shared UI, media rendering, and styles
  server/       HTTP/Socket.IO server, authoritative engine, storage, and tests
  shared/       Runtime validation, typed protocol, scoring/reveal helpers and tests
  data/         Private question JSON
  public/media/ Locally served clue assets
```

The server loads quizzes through a `QuizStorage` interface so a future storage
implementation can replace JSON without changing the game engine.

## Validation

### Populate the screens with test players

The helper and its tests live in [script/](./script/), separate from the
application source and production build.

Start the app normally (`npm run dev` or `npm start`), then open a **second
terminal** in the repository root:

```sh
npm run players
```

This joins **12 randomly named players with random avatars** and keeps them
online while you inspect `/display` and `/admin`. Names have a unique batch
suffix so repeated runs can coexist. The TV shows the top eight by default;
admin lists every player.

To change the count or target server:

```sh
npm run players -- --count 24
npm run players -- --count 8 --url http://localhost:3001
npm run players -- --help
```

The count must be between 1 and 100 per run. Use the server origin for `--url`,
not the `/play` page. These are simulated socket clients, not browser windows.
They do **not** buzz, answer, or change scores automatically. Use the host's
manual score adjustments to test different rankings and negative scores.

Keep the helper running while testing. **Ctrl+C disconnects its players but
does not delete them or their scores.** Remove them in admin between questions,
or restart the server to clear the entire session. A lost connection or removed
test player stops the batch with an explicit message; rerun to create a new batch.

### Automated checks

```sh
npm test
npm run typecheck
npm run build
```

Tests cover exact scoring boundaries, first-buzz arbitration, frozen clocks,
wrong-answer lockouts, undo, duplicate/stale commands, private-answer filtering,
12-player ordering, reconnects, host authorization, and deterministic reveals.
The layout-player helper is also tested for argument validation, joining 12
distinct online players, and clean disconnection on Ctrl+C.

## POC limits / next steps

- Session state is in memory. **Stopping/restarting the server loses all players,
  scores, and active progress.** Restart to begin a fresh session.
- No editor, uploads, database, archive, additional reveal modes, or alternate
  themes yet.
- Audio/video positions are synchronized to the server clue clock with periodic
  browser seeking. Actual TV playback-position reporting, buffering feedback, and
  frame-accurate recovery are follow-up work; validate supplied media codecs and
  autoplay behavior on the target TV browser before hosting.
- The automated tests and browser smoke checks cover the core text/image flow;
  real phones, Windows firewall configuration, audio hardware, and loaded-network
  behavior still need a LAN playtest.

## Reference project

The original Surge Jeopardy project is archived in [surge-jeopardy/](./surge-jeopardy/)
for reference. Its source code, documentation, license, and build and deployment
configuration are preserved there.

See the [original README](./surge-jeopardy/README.md) and
[setup guide](./surge-jeopardy/SETUP.md) for details. Run any commands from those
guides inside `surge-jeopardy/`, not the repository root.

See [QUIZ_NIGHT_PROJECT_SPEC.md](./QUIZ_NIGHT_PROJECT_SPEC.md) for the full product
baseline and future acceptance criteria.
