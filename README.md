# Quiz Night

A locally hosted, sequential multiplayer buzzer quiz. The gamemaster runs the
show on a laptop, a separate TV displays clues, and players buzz from their
phones. Answers are spoken aloud and scored only by the gamemaster.

The new app lives entirely under [src/](./src/). It is separate from the archived
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

## Implemented core flow

- Authenticated host commands; server-filtered public snapshots never contain the
  private answer until the host explicitly reveals it.
- Server-arbitrated first buzz, a frozen points-at-buzz value, and no answer
  countdown. Correct awards the frozen value; wrong deducts it, locks that player
  out, and resumes the clue for everyone else.
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
- Stable leaderboard ordering during active clues, reranking between questions;
  up to eight TV cards by default, all players in a sortable/searchable host table.
- Text and image clues, deterministic random tile reveals, and TV-only native
  audio/video rendering with an audio frequency-spectrum visualizer.

**Undo semantics:** Undo restores the latest score operation and its saved
question state, elapsed time, scores, and eligibility. Undoing a ruling restores
the answering player so the host can judge again. It never restores stale
connection status. Undo history is cleared on next/reset or player removal.
Reset reopens the current question at full value and clears lockouts, but does
not erase previously awarded/deducted scores. Media restart restarts playback /
image reveal without resetting the point clock.

## Questions and media

Edit [src/data/questions.json](./src/data/questions.json), then restart the server.
The starter quiz has two text clues and an original tiled-image clue. Questions
are validated on startup; invalid data fails explicitly. The raw JSON is
**server-only** and is not exposed as a public HTTP resource.

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

```sh
npm test
npm run typecheck
npm run build
```

Tests cover exact scoring boundaries, first-buzz arbitration, frozen clocks,
wrong-answer lockouts, undo, duplicate/stale commands, private-answer filtering,
12-player ordering, reconnects, host authorization, and deterministic reveals.

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
