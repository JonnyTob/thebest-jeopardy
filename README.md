# Kaboot

A locally hosted, sequential multiplayer buzzer quiz. The gamemaster runs the
show on a laptop, a separate TV displays clues, and players buzz from their
phones. Answers are spoken aloud and scored only by the gamemaster.

Promotional website: [kaboot-quiz.pages.dev](https://kaboot-quiz.pages.dev/).

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
In development mode, the admin console has a **Restart Quiz** danger button. After
confirmation it returns to the lobby and clears players, scores, answers and quiz
progress; players must join again. The saved quiz and its setup are loaded again from disk. This control and
its server command are unavailable in production.
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
    "startupQuizId": 100001,
    "joinOrigin": "http://192.168.1.42:3000",
    "maxPlayerNameLength": 24,
    "requireAdminPasscode": true,
    "maxPlayers": 12,
    "typeBuzzAnnouncementSeconds": 3,
    "countdownSound": "/media/sounds/countdown-beep.wav",
    "reviewCorrectSound": "/media/sounds/countdown-beep.wav",
    "reviewWrongSound": "/media/sounds/countdown-beep.wav",
    "endMusic": null
  },
  "gameSetup": {
    "leaderboardCount": 8,
    "startPoints": 500,
    "minimumPoints": 100,
    "dropPoints": 100,
    "dropEverySeconds": 5,
    "pointDecayDelaySeconds": 5,
    "questionTimerSeconds": 30,
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
  `PORT`, `JOIN_ORIGIN`, and `QUIZ_ID` environment variables override the corresponding file settings.
  `startupQuizId` selects the quiz folder to load (a positive safe integer; default 100001).
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
  - `typeBuzzAnnouncementSeconds`: duration of the Type + buzz rules announcement
    before the countdown, in seconds. Defaults to **3**; use a whole number from
    1 to 60. This is a global setting; restart the server after changing it.
  - `countdownSound`: local WAV path for the TV countdown beep, default
    `/media/sounds/countdown-beep.wav`. Set to `null` to disable it, or use a
    different local path such as `/media/sounds/my-beep.wav`. Place a short single beep under
    [src/public/media/](./src/public/media/); it is played once for each of
    **3, 2, 1**, not as a full countdown recording. This is a global server
    setting, not a per-quiz option. Restart after changing the setting; rebuild
    production after adding or replacing the WAV asset.
  - `reviewCorrectSound` and `reviewWrongSound`: independent local WAV paths for
    correct and wrong answers during TV review and buzzer rulings (including missing typed answers). Each defaults
    to `/media/sounds/countdown-beep.wav` as a placeholder and can independently be
    set to `null` to disable it. For custom sounds, place WAV files under
    [src/public/media/](./src/public/media/) and use their `/media/...wav` paths.
    They are global server settings; restart after changing them and rebuild
    production after adding or replacing assets. They remain enabled by default
    even if `countdownSound` is `null`.
  - `endMusic`: optional local WAV, MP3, OGG or M4A path for the final results,
    such as `/media/sounds/finale.mp3`. Defaults to `null` (disabled). Place the
    file under [src/public/media/](./src/public/media/), restart the server, and
    rebuild production after adding the file. Enable TV sounds in the display
    browser; playback depends on browser audio permission and format support.
- **gameSetup**: defaults for game settings and question point settings.
  Point defaults are configured in this file and used by the quiz editor; they
  are not editable or saved from Game setup. Existing per-quiz point overrides
  are preserved for compatibility.
  `maxAnswerLength` (1-500; default 100) limits typed answers for this quiz.
  `questionTimerSeconds` (1-3600; default 30) is the countdown for questions
  without their own `timerSeconds` override. It can also be changed in Game setup.
  `pointDecayDelaySeconds` (0-300; default 5) holds the starting point value
  before reductions begin. It applies to buzzer questions using the quiz's
  default decaying points. Individual questions can set their own scoring. The first reduction happens after this
  delay plus one `dropEverySeconds` interval.
- **quizzes/\<quiz-id\>/quiz.json**: per-quiz overrides, identified by the
  numeric quiz ID in the question file. The quiz file can contain a partial `gameSetup` section; omitted values use global defaults. You can create a
  partial override, for example `{"gameSetup":{"lockoutSeconds":10}}`.

On startup, global game defaults are merged with per-quiz overrides. The title
comes from `quiz.title`. **Save setup** writes the title to `quiz.title` and the
editable game settings to `gameSetup` in that quiz's `quiz.json`. It preserves
existing point overrides without adding or changing them, and never writes server
options. Saved values take precedence over later global-default changes; remove
an override from the quiz file to inherit the global value again.

Both development and production read global settings from the repository root and quiz files from the configured data directory at startup. Restart the server after editing them manually. Missing/invalid global
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
   Changing the address in the host lobby updates the TV and home-page QR codes
   for all connected browsers. The selection lasts until the server restarts;
   `joinOrigin` or `JOIN_ORIGIN` can set the preferred address at startup.
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

- Authenticated host commands; server-filtered public snapshots reveal the official
  answer when typed submissions close or a buzzer answer is judged correct. Typed submissions are
  private to the host until each submission is displayed during review.
- Server-arbitrated first buzz, a frozen points-at-buzz value, and no answer
  countdown. Correct awards the frozen value; wrong deducts half (rounded up to a whole point) and locks that
  player out. A correct ruling immediately shows the official answer and awarded
  points for three seconds, then resumes any remaining audio, video or tile reveal
  with buzzing closed. The quiz advances automatically when that finishes. A wrong ruling shows its
  result for two seconds and reopens the clue to eligible players. Clue time and
  media remain frozen during either result. Undo cancels the result or media finish
  and restores the ruling.
- The server uses clip start/end settings and probes local WAV, MP3 and MP4
  durations at startup. If the endpoint is unknown, the host uses **Skip finishing media**
  after playback ends. Browser autoplay restrictions, buffering, missing files or
  a disconnected TV can interrupt playback. Enable TV media and check the display;
  use **Restart media only** while the question is open or finishing when necessary.
- In **Game setup**, set **Wrong-answer lockout seconds** to 1-300 to allow
  retries on the same question. The player's phone shows a countdown, and the
  host's player table shows the remaining seconds. The timer starts when the
  two-second wrong-answer result ends and continues during pauses,
  other players' answers, and disconnections. Once it expires, the player can buzz when buzzers are open.
  The default, **0**, preserves one attempt per question. Setup is locked after
  starting; resetting or advancing a question clears all lockouts.
- Configurable starting/minimum points and decay steps. Defaults are
  **500 -> 400 -> 300 -> 200 -> 100**, with a five-second delay followed by
  five-second reduction intervals.
  Minimum value and media ending do not close a question; its countdown does.
  Buzzer questions close at
  zero, while typed questions close submissions and begin review as appropriate.
  The TV's clue panel shows the remaining countdown and a decreasing time bar
  for both modes; the right-hand panel labels the current question points
  **Fixed points** for fixed scoring or **Timed points** for decaying buzzer scoring.
  Video continues to its clip end even if buzzing closes first.
  Points may reach their minimum before the question closes, or remain above it
  when time runs out.
- Pause/resume, close/skip, reveal, next, question reset, media restart, manual
  positive/negative adjustments, and undo. Commands have idempotency IDs and stale
  revision checks.
- Six original inline SVG avatars; token-based reconnect preserves score,
  identity, and lockout. Reopening multiple tabs with the same token still counts
  as one player. An offline answering player remains active until the host rules
  or closes the clue.
- The phone's **BUZZ** button appears for buzzer and Type + buzz questions.
  It is hidden in the lobby, countdowns, typed
  questions and final standings. An enabled buzzer is green; paused, locked-out,
  disconnected and pending states remain disabled, with gold for the first buzzer.
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
  later questions and question resets do not repeat it. The animation respects
  the browser's reduced-motion preference.
- **Everyone answers** questions accept one final typed submission per player.
  The server automatically closes submissions at the question's `timerSeconds`
  (or `gameSetup.questionTimerSeconds` when omitted). The visible countdown and
  submission deadline reach zero together. The countdown displays whole seconds
  through zero. Pausing pauses the timer and submissions.
  The TV bar freezes when paused or closed; decaying points freeze with it. The official
  answer appears on the TV while submissions are closed, then hides when the host
  starts review. Review never starts automatically just because all answers are judged.
  On typed video clues, the video continues playing on the TV after submissions
  close, up to its clip end or until the quiz advances. The submission clock
  remains stopped.
  The host can see all submissions privately; other players see only the count.
  Use **Close submissions** to end answering early, or wait for the timer to close it.
  Then use **Start answer review** when fast review is complete. Mark each answer
  correct or wrong. Correct earns the points available when the answer was submitted;
  wrong or missing answers earn zero. The leaderboard updates immediately.
  Review order is submission order, followed by non-submitters in join order.
  Players present when submissions close are included, even if disconnected;
  later joiners are not included in that review. Each ruling remains visible for
  two seconds while gold bars fall for a correct answer or money flies away for a
  wrong or missing answer. The next review starts automatically; the final ruling
  advances to the next-round countdown or final standings. Undo cancels the hold.
  Fast approvals score immediately without an individual animation; their grouped
  results are shown at the start of TV review as described below.
- **Next-round transition:** moving to another question shows a synchronized
  three-second **NEXT ROUND / 3 -> 2 -> 1** countdown on TV, host and phones.
  The next clue and its full timer/media start only when this ends. Correct buzzer
  rulings advance after their three-second answer display and any remaining media;
  completed
  typed reviews advance after their hold. The host can still manually advance a
  skipped/closed buzzer question. If no question remains, final standings appear
  after the hold and any remaining media. Other game controls are blocked during
  transition, but **Undo last score change** cancels it and restores that ruling.
  Undo history clears when the next question opens, not when the countdown starts.
  Typed review no longer pauses for a separate official-answer reveal step.
- **TV sounds:** on the TV display, click **Enable TV sounds** once
  before playing. The configured WAV plays for 3, 2 and 1 on the game-start and
  next-round countdowns; phones and the host console remain silent. The enable
  click may play a short preview. Browsers can require this gesture and may block
  or fail to load the sound; use **Retry TV sounds** if prompted. Reconnects
  and late enabling skip missed beeps. Timing is approximate on the network. Use
  only one active TV display to avoid duplicate audio. Media clues may still
  require their own playback/audio unlock button. Review sounds use the same TV
  enable button, even if countdown sound is disabled. The bundled beep placeholder
  is pitched differently for correct and wrong results; custom WAVs play at their
  original speed. A late or reconnected display skips stale effects.

### Optional fast approval for typed answers

The host's **Typed answers** pane always offers **Correct** and **Wrong** buttons
to judge answers privately without showing each one on the TV. There is no switch
to enable: use these optional quick rulings or leave answers for normal TV review.
This is manual judging, not automatic answer matching.

1. **Close submissions** freezes the roster and adds missing answers. This also
  happens automatically when the question timer reaches zero. The TV displays the
  official answer while the host prepares review.
2. Optionally mark closed submissions **Correct**, **Wrong**, or **No answer**
  privately. Correct earns the points captured at submission immediately; wrong or missing earns zero.
3. Use **Start answer review** when ready. The TV
  first shows fast-approved correct players together with their points, then wrong
  or missing players together with +0. Each nonempty group appears for four
  seconds with its configured result sound. Answers themselves stay private.
  Remaining unjudged entries then appear individually in their original order.
  Review does not start automatically, even when every roster entry is judged.

Quick rulings are available after submissions close and before TV review starts.
Normal review remains available for any unjudged answers. Undo applies to private
rulings too, including zero-point rulings; it restores the previous score and
judgment state in the closed question. Undo during a group cancels the grouped sequence.
The host list retains all entries and their outcomes. TV review numbering still
refers to positions in the full roster, so skipping judged entries can skip numbers.

**Undo semantics:** Undo restores the latest score operation and its saved
question state, elapsed time, scores, and eligibility. Undoing a ruling restores
the answering player so the host can judge again. It never restores stale
connection status. Undo history is cleared when the next question opens, on reset,
or on player removal. Undo during the next-round countdown cancels advancement.
Reset reopens the current question at full value and clears lockouts and typed
submissions, but does
not erase previously awarded/deducted scores. Media restart restarts playback /
image reveal without resetting the point clock.

During typed-answer review, undo restores the last ruling and its score so it can
be judged again, including wrong and missing answers. Reset after scoring retains
awarded points, so use undo first if the scores should be reversed.

## Questions and media

Use **Quiz library** in the host console to create, edit, load or reload quizzes. New quizzes receive an ID and an empty archive; add and save at least one enabled question before loading them. Editing a quiz does not change the running game. In the lobby, loading or reloading a quiz applies its saved questions and settings, keeps players connected, and resets scores. The selection lasts for the current server session; `server.startupQuizId` (or `QUIZ_ID`) still chooses the quiz at server startup. Set `QUIZ_DATA_DIR` to the archive directory (default `quizzes`). Each quiz lives in `<data directory>/<id>/quiz.json`, with its own files in `<id>/media/`. The ID in the JSON must match the folder name.

The library can permanently delete a quiz and all files in its folder, including
media. The currently loaded quiz cannot be deleted. The startup quiz is also
protected so the next server restart can succeed; choose a different
`server.startupQuizId` (or `QUIZ_ID`) and restart before deleting it. A deletion
is rejected if the saved quiz changed after the library was loaded; reopen the
library to review its latest state. Another host's unsaved edits cannot be detected.

The editor adds, duplicates, removes and reorders questions and manages quiz-local
media. The question list labels each question as **Buzzer**, **Typed**, or **Type + buzz**. Clear
**Include question in quiz** to opt a question out without deleting it; opted-out
questions are marked in the list and remain editable and previewable. Questions
are included by default. As with other edits, the saved selection takes effect
after the quiz is reloaded. You can save with every question opted out, but
loading the quiz requires at least one enabled question. It saves
only valid questions; unfinished question edits remain in the
browser and are lost if discarded. Save writes to disk, but the running game
continues using its currently loaded copy until the quiz is reloaded from the
library in the lobby. Game setup changes still apply in the lobby; if the quiz
file changes separately, reload it before saving setup.
The editor detects conflicting changes to the archive; reload only after
preserving any unsaved edits you need. Avoid simultaneous external writes during
an editor or setup save. Changing a clue's type immediately removes incompatible
clue text or settings without prompting. Uploaded media files remain in the
library; select a compatible file if the existing selection has a different type.

Use **Choose media** for a cover or media clue to search and preview compatible
files before selecting one. Open **Media library** to search and filter all
files, inspect usage and delete files. Results are paged and only the selected
file is previewed. **Refresh media** reloads the file list without discarding
quiz edits. Usage shows this browser's current edits, the archive last
loaded or saved in this editor, and the running quiz; another host's unsaved
edits are not visible. The server checks the current saved archive and running
quiz again before deleting, and this browser also blocks deletion of files in
its own edits.

Uploads from either view are limited to 50 MB per file and accept PNG, JPEG,
GIF, WebP, MP3, WAV, OGG, MP4 and WebM. Files are stored immediately with unique
names, even if quiz edits are later discarded. Files belong to the current quiz,
not a shared library. Search and paging operate on a list retrieved for the
whole quiz; the server still scans the media directory. Browser codec and
autoplay support vary; test playback on the actual TV. File extensions are
checked, but uploads are not transcoded or verified for playability.
Editor APIs require the host passcode when enabled; as with the rest of the app,
plain HTTP on the LAN does not encrypt credentials or media.

**Preview question** opens a TV-style overlay over the question editor,
including unsaved edits, the countdown bar and question points, image reveal and media
playback. It does not send anything to the TV or affect the game. It uses the
running game's settings with saved quiz overrides and contains no simulated
players. It is a snapshot: select **Refresh preview** to restart it, or
**Close preview** (or Escape) to return to the editor. Audio or video may require
the browser's playback permission; test the actual TV separately.
The starter quiz has ten questions covering both modes and all four media types. Questions
are validated on startup; invalid data fails explicitly. The raw archive and
official answers are exposed to authorized hosts through the editor API, not as
a public HTTP resource or in player/display snapshots.

Each file has a required `schemaVersion`, `quiz` metadata, optional `gameSetup` overrides, and an ordered
`questions` array. The starter quiz uses:

```json
{
  "schemaVersion": 1,
  "quiz": {
    "id": 100001,
    "title": "Friday Night Quiz",
    "coverImage": "media/covers/100001.svg"
  },
  "gameSetup": {},
  "questions": []
}
```

An empty array is valid for a new quiz; loading it for play requires at least one
enabled question.
`schemaVersion` must be the number **1**. Missing or unsupported versions are
rejected, never guessed or silently upgraded. To migrate an existing unversioned
quiz, add `"schemaVersion": 1` at the root, ensure every question has an explicit
`mode`, and remove any fields that do not apply to its mode or media type.

The shared saved-document schema is
[quizArchiveSchema](./src/shared/quizArchive.ts). The archive loader and quiz
settings reader/writer use it, including validation before a settings save.
It preserves relative media paths and omitted defaults. Runtime conversion is
separate: it builds served media URLs, normalizes UUID casing and supplies
playback/reveal defaults without changing the saved document. Do not save
runtime snapshots as quiz files.

Use a unique positive safe integer for each quiz (1 to 9007199254740991).
Keep the ID when renaming or editing that quiz; assign a different ID when
creating a separate quiz. The library uses this ID rather than the title as its
identifier. Select the startup quiz using `server.startupQuizId` or `QUIZ_ID`.

The ID is shown as **Quiz #100001** beside the quiz name on TV, phone, and admin
live/setup screens. It survives server restarts because it is stored in the quiz
file, and it cannot be changed through session setup. This is a quiz/library ID,
not a temporary join PIN or the private host passcode.

Each question has a globally unique UUID `id` and an optional human-readable
`keyword` (1–80 characters; duplicates are allowed). Generate a new UUID for a
new question, including an independently editable copy. Preserve the ID when
editing, moving or reordering the same question. The question array determines
play order. IDs are checked for duplicates within the loaded quiz; cross-archive
collision checks are not yet implemented. Generate UUIDs independently rather
than reusing IDs across quizzes.

### Question modes

The editor offers **Buzzer**, **Typed**, and **Type + buzz**. For Type + buzz,
set the smaller typed-answer points, the buzzer points, the initial typing
window, and optionally the buzzer countdown. A configurable rules screen appears
before the game-start or next-round countdown. Players can buzz as soon as they submit a typed answer; players
who have not submitted can buzz after the initial window. Typing stays open until
the first buzz or the buzzer countdown expires. The first buzz freezes the typed
roster; after a wrong ruling all other eligible players can buzz, even if the
initial window has not ended. A correct buzz wins the current buzzer points and a wrong buzz loses half,
rounded up to a whole point. After the buzzer round and any finishing media, the host reviews the
typed answers using the usual fast approval or TV review. A player judged correct
on the buzzer receives only the buzzer award and is excluded from typed review,
whether or not they submitted an answer. Other players' typed answers are reviewed
normally, including those of players who buzzed incorrectly. Buzzer points can be fixed or decay over time. In Type + buzz, decay
starts when the initial typing window ends, or at the first buzz if it happens
earlier; the clock pauses while a player answers and during the result.

In quiz JSON, use `"mode": "type-and-buzz"`, `"fixedPoints"` for the typed
reward, `"buzzPoints"` for a fixed buzzer reward, and `"typingSeconds"` for
the initial typing window. The optional `"timerSeconds"` controls the remaining
countdown after that window; otherwise it inherits the game setup countdown.
The editor supplies defaults of 100 points, 500 points, and 10 seconds.

For Buzzer and Type + buzz questions, the editor offers **Fixed points** or
**Decaying points**. Fixed points do not decay, but the question still has its
answer countdown. Decaying points have starting points, minimum points, a drop
amount, a drop interval, and an initial delay. Buzzer questions can inherit the
quiz settings or specify all five values; Type + buzz questions with decay use
their own values. Existing buzzer questions without point settings continue to
inherit quiz defaults; existing Type + buzz questions retain their fixed points.
In JSON, `pointMode` is `"fixed"` or `"decay"`; `buzzPoints` supplies fixed
points, and `pointDecay` contains the five decay settings named `startPoints`,
`minimumPoints`, `dropPoints`, `dropEverySeconds`, and `pointDecayDelaySeconds`.

The bundled quiz is also a playable examples catalog:

| # | Keyword | Type / mode | Features to try |
| --- | --- | --- | --- |
| 1 | `warm-up` | Text / typed | Separate headline and clue text; 250 fixed points and a 30-second timer |
| 2 | `mystery-image` | Image / buzzer | Deterministic 8 x 6 tile reveal over 20 seconds; buzz freezes it |
| 3 | `everyone-answers-text` | Text / typed | Everyone submits privately; 250 fixed points and a 30-second timer |
| 4 | `static-image` | Image / buzzer | Explicit `mode` and `static` reveal; count the five gold stars |
| 5 | `everyone-answers-image` | Image / typed | 6 x 4 tiles with a different seed; 15-second reveal independent of the 25-second timer |
| 6 | `audio-buzzer` | Audio / buzzer | Full eight-second original chime clip with live spectrum visualization |
| 7 | `everyone-answers-audio` | Audio / typed | Only seconds 4.5-8 of the same clip; visualization disabled; 300 fixed points |
| 8 | `video-buzzer` | Video / buzzer | Full original silent moving-shapes clip; aspect-preserving playback |
| 9 | `everyone-answers-video` | Video / typed | Seconds 2-6 of the clip; 150 fixed points and a 20-second timer |
| 10 | `last-call` | Text / buzzer | Return to buzzer mode after typed review, then finish the quiz |

For typed questions, join from a real phone/browser, submit, then wait for the
timer or use **Close submissions**. Make any private fast judgments, then click
**Start answer review**. Each individual result advances automatically after two
seconds. After its result hold, the final ruling advances via the
three-second next-round countdown (or finishes the quiz). A wrong or missing
typed answer earns zero, unlike the negative penalty for a wrong buzzer answer.
Clip endings do not close questions; typed submission deadlines do.
The `players` helper only joins players; it does not submit typed answers.

All referenced media is bundled and works offline: the original rocket image,
an original ringed-planet illustration, a synthesized WAV (three ascending notes,
then three descending notes), and a silent 1280 x 720 MP4 of moving coloured
shapes. The latter three live in [quizzes/100001/media/examples/](./quizzes/100001/media/examples/).
The MP4 uses H.264 for broad browser compatibility.
Audio/video plays on the TV only and may need its playback-unlock button.
The bundled countdown beep is [Beep Tone Sound SFX by qubodup](https://opengameart.org/content/beep-tone-sound-sfx),
made available under [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
No commercial music, movie clips, remote URLs, or missing placeholder files are
needed for the bundled quiz.

Every question must explicitly set `"mode": "buzzer"` for the first-buzz flow,
`"mode": "typed"` for everyone to answer privately, or `"mode": "type-and-buzz"`
for the combined flow. There is no default mode:
missing or invalid values stop quiz loading with a validation error. Existing
quiz files with omitted modes must add `"mode": "buzzer"` to those questions.

The optional `"enabled": false` excludes a question from play while retaining it
in the archive; omit it or set it to `true` to include the question. Disabled
questions must still satisfy the normal validation and media requirements.

A typed question can use fixed points or decaying points. For decaying points, the
value is captured when each player submits. It may override the inherited countdown
in seconds. For example, a fixed-point question:

```json
{
  "id": "a5e29af7-9704-4f8e-a981-64628ef6c69a",
  "keyword": "movie-1",
  "type": "text",
  "mode": "typed",
  "question": "Name the movie.",
  "answer": "The Matrix",
  "fixedPoints": 250,
  "timerSeconds": 30
}
```

`fixedPoints` is an integer from 1 to 10000; `timerSeconds` is an optional
integer from 1 to 3600 on every question type and mode. If omitted, the question
inherits `gameSetup.questionTimerSeconds`. The mode applies to text, image, audio and video clues. A player
cannot edit an answer after submitting; the same player reconnecting or opening
another tab cannot submit again. The host sets the per-quiz answer length in
**Game setup** and saves it with the other quiz settings.

Question fields are validated according to mode and media type:

| Field | Allowed on |
| --- | --- |
| `fixedPoints` | Required for fixed `typed` questions and `type-and-buzz`; forbidden on `buzzer` and decaying `typed` questions |
| `pointMode` | Optional on all modes; selects `fixed` or `decay` (on Type + buzz, controls buzzer points) |
| `buzzPoints` | Required for fixed buzzer scoring; must exceed `fixedPoints` on Type + buzz |
| `pointDecay` | Optional on decaying buzzer questions; required for decaying typed and Type + buzz questions |
| `typingSeconds` | Required on `type-and-buzz`; initial window before everyone can buzz |
| `timerSeconds` | Optional countdown override on every question |
| `text` | Text clues only; optional body below the question headline |
| `media` | Required on image, audio and video; forbidden on text |
| `reveal` | Image clues only |
| `playback` | Audio and video only |
| `visualizer` | Audio only, including when disabled |

Unknown fields are rejected, including typos inside `reveal`, `playback` and
`visualizer`. Validation errors identify the affected question/field. When
changing a question's type or mode, remove incompatible fields rather than
retaining ignored settings. `answer` remains the only answer field; all typed
answers are judged manually by the host.

### Lobby cover

Each quiz can optionally set `coverImage` to its own local image path. The
starter quiz includes an original **3840 x 2160 SVG illustration** in
[quizzes/100001/media/covers/100001.svg](./quizzes/100001/media/covers/100001.svg).
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

Place quiz media in its `media/` folder and reference it as `media/your-file.ext`. Quiz files and media are read from the configured data directory at runtime; restart after changing quiz JSON. Shared TV sounds remain in `src/public/media/sounds/`.
Use the fields described in the [project specification](./QUIZ_NIGHT_PROJECT_SPEC.md);
the first image effects supported are `static` and `tiles`.

An audio clue can use:

```json
{
  "id": "1a3000f3-d438-4de1-9a89-756d4bf1423f",
  "keyword": "audio-1",
  "type": "audio",
  "mode": "buzzer",
  "question": "Name this sound",
  "media": "media/your-audio.mp3",
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
  server/       HTTP/Socket.IO server, authoritative engine, and storage
  shared/       Runtime validation, typed protocol, scoring and reveal helpers
  public/media/ Locally served clue assets
```

The server loads quizzes through a `QuizStorage` interface so a future storage
implementation can replace JSON without changing the game engine.

## Validation

### Populate the screens with test players

The helper lives in [script/](./script/). Tests are grouped under
[tests/](./tests/) by server, shared code, and scripts; they are separate from
the application source and production build.

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

### Player snapshot load probe

Run `node --import tsx script/benchmarkPlayerSnapshots.ts` to simulate 50, 100,
and 300 phones over local WebSocket connections. It reports JSON snapshot payload
bytes, buzz acknowledgement latency and combined server/client CPU usage. This
single-process loopback probe is not a substitute for testing the intended host
and phones over Wi-Fi; the configured player limit is unchanged.

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
- No persistent unfinished-question drafts, database, additional reveal modes, or
  alternate themes yet.
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
