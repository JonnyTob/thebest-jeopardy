# Setup Guide

Everything you need to run your own Jeopardy game night — local, LAN, or fully online.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development](#local-development)
3. [Case 1: In-Person Game Night (LAN)](#case-1-in-person-game-night-lan)
4. [Case 2: Online / Remote Game Night (Fly.io)](#case-2-online--remote-game-night-flyio)
5. [Creating Your First Board](#creating-your-first-board)
6. [Running a Game](#running-a-game)
7. [Daily Double Wagering](#daily-double-wagering)
8. [Final Jeopardy](#final-jeopardy)
9. [Player Instructions](#player-instructions)
10. [Environment Variables](#environment-variables)
11. [Docker (Self-Hosting)](#docker-self-hosting)

---

## Prerequisites

- **Node.js** 18 or higher — [nodejs.org](https://nodejs.org)
- **npm** (comes with Node.js)
- For deployment: **Fly.io CLI** — [fly.io/docs/hands-on/install-flyctl](https://fly.io/docs/hands-on/install-flyctl/)

---

## Local Development

This runs two development servers — one for the backend, one for the frontend.

```bash
# Clone the repo
git clone https://github.com/Surge-Tech/jeopardy.git
cd jeopardy

# Install dependencies for both frontend and backend
npm run install:all

# Start both dev servers
npm run dev
```

| Server | URL | What it is |
|---|---|---|
| Frontend | http://localhost:5173 | Dashboard, Editor, Host, Board, Buzzer |
| Backend | http://localhost:3001 | API + Socket.io |

The frontend automatically proxies API and socket requests to the backend in dev mode.

---

## Case 1: In-Person Game Night (LAN)

Everyone is on the same Wi-Fi. The host's laptop runs the server, the TV is plugged in, and players connect from their phones.

**Step 1:** Start the dev server on the host's laptop:
```bash
npm run dev
```

**Step 2:** Find the laptop's local IP address.
- **Mac:** `ipconfig getifaddr en0`
- **Windows:** `ipconfig` → look for `IPv4 Address`
- **Linux:** `ip addr show`

The backend also prints LAN URLs on startup:
```
Local:   http://localhost:3001
Network: http://192.168.1.42:3001
```

**Step 3:** Open the following on each device:

| Device | URL |
|---|---|
| Host laptop | http://localhost:5173/host/ROOM_CODE |
| TV / projector | http://localhost:5173/board/ROOM_CODE |
| Player phones | http://192.168.1.42:5173/buzzer/ROOM_CODE |

> Replace `192.168.1.42` with your actual LAN IP and `ROOM_CODE` with the code shown on the Dashboard when you start a game.

---

## Case 2: Online / Remote Game Night (Fly.io)

Players are remote. You deploy the app once and share a public URL.

### First-Time Setup

**Step 1:** Install the Fly.io CLI and log in:
```bash
# macOS / Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex

fly auth login
```

**Step 2:** Create a persistent volume for your boards (only needed once):
```bash
fly volumes create jeopardy_data --region iad --size 1
```

**Step 3:** Launch the app (first time only — edits `fly.toml`):
```bash
fly launch
```
When prompted, choose:
- **App name:** pick a unique name (e.g. `your-name-jeopardy`)
- **Region:** choose the one closest to you
- **Postgres / Redis:** No
- **Deploy now:** Yes

> **Important:** After `fly launch` generates a new `fly.toml`, open it and add these lines under `[env]` if they're missing:
> ```toml
> [env]
>   DATA_DIR = '/app/data'
>   NODE_ENV = 'production'
>   PORT = '3001'
> ```
> And ensure the mounts section exists:
> ```toml
> [[mounts]]
>   source = 'jeopardy_data'
>   destination = '/app/data'
> ```

### Deploying Updates

```bash
fly deploy
```

That's it. Your app is now live at `https://your-app-name.fly.dev`.

### Sharing With Players

| Device | URL |
|---|---|
| Host | https://your-app.fly.dev/host/ROOM_CODE |
| Board (screen share) | https://your-app.fly.dev/board/ROOM_CODE |
| Players | https://your-app.fly.dev/buzzer/ROOM_CODE |

Share the buzzer URL in your video call chat. Players tap it on their phone or laptop — no install required.

### Fly.io Free Tier

Fly.io's free tier includes:
- 3 shared-CPU VMs (you only need 1)
- 3 GB persistent storage
- The app auto-sleeps when idle and wakes instantly on request

No credit card required for the free tier.

---

## Creating Your First Board

1. Go to the Dashboard (`/`)
2. Click **New Board**
3. Enter a name and click **Create**
4. Click **Edit** on your new board
5. In the editor:
   - Click a category header to rename it
   - Click any point cell to add a clue
   - Each clue has a **Question**, **Answer**, and optional **image/video**
   - Toggle **Daily Double** on any clue
   - Click **⚡ Final Jeopardy** in the top bar to set up the closing round (category, clue, response, optional media, and an answer timer — defaults to 30s). This is optional; boards without it simply skip Final Jeopardy.
6. Click **Save Board** when done

Boards are saved as JSON files in `backend/data/boards/`. You can back them up or share them by copying those files.

### Adding Rounds (Double Jeopardy, etc.)

A board isn't limited to one grid — the round tab bar above the point-values row lets you build out a full game:

| Control | What it does |
|---|---|
| **+ Add round** | Adds a blank round with the same category count as the last one and point values doubled (named "Double Jeopardy!" automatically for round 2). |
| **Duplicate / Duplicate ×2** | Copies the current round's categories and clues into a new round, optionally doubling point values — handy for reusing a template or building Double Jeopardy from Jeopardy. |
| **← / →** | Reorders rounds. |
| **Remove round** | Deletes the current round (asks for confirmation; disabled when only one round remains). |
| Round name field | Renames the currently-selected round (shown in the tab and to the host during the game). |

Every round is independent — its own categories, clues, and point values. Players, scores, and stats carry over automatically when the host advances between rounds during a game.

> Boards saved before multi-round support was added are migrated automatically the first time they're loaded (their single grid becomes round 1, "Jeopardy!") and rewritten in the new format on their next save.

---

## Running a Game

1. From the Dashboard, click **Start Game** on the board you want to play
2. A **Room Code** is generated (e.g. `ABC123`)
3. Open three things:
   - **Host Panel** — your laptop/tablet: `/host/ABC123`
   - **Board View** — the TV/shared screen: `/board/ABC123`
   - **Buzzer** — share this URL with players: `/buzzer/ABC123`

### Host Panel Controls

| Control | What it does |
|---|---|
| Click a tile | Opens the clue on the board view |
| **Show Answer** | Reveals the answer on the board view |
| **✓ Correct / ✗ Wrong** | Awards or deducts points, closes the clue |
| **Lock Buzzers** | Closes buzzers if open without selecting a winner |
| **Adjust Score** | Manual ±point correction on any player |
| **Lockout** dropdown | Sets how long an early buzz locks a player out (Off / 250 / 500 / 1000ms) — changeable mid-game |
| **Next Round →** | Advances to the next round once the current one is done (or earlier, if you want to skip ahead); carries players, scores, and stats forward. Disabled while a clue is open. |
| **⚡ Start Final Jeopardy** | Appears once the board's Final Jeopardy is configured; begins the closing round |
| **End Game** | Ends the game and shows the leaderboard on every screen — available at any point, including mid-Final-Jeopardy. Asks for confirmation. |
| **Resume** | Un-ends a game that was ended by mistake, returning to where it left off. |
| **Close Room** | Tears down the session entirely for everyone (was "← Exit"). Asks for confirmation — this can't be undone. |
| **Log tab** | Full history of the current game |
| **Stats tab** | Per-player leaderboard and correct/wrong/early-buzz breakdown |

### Buzzer Fairness

Players can press the buzzer as soon as a clue is open, even before the host opens buzzing — but pressing early doesn't help them. An early press locks that player out for the configured duration (250ms by default), and mashing the button keeps re-arming the lockout rather than clearing it. This means reacting to the buzzer being opened beats mashing it early.

### Ending a Game

If the last round finishes and the board has Final Jeopardy configured, the host panel prompts you to either start Final Jeopardy or end the game there. If the board has no Final Jeopardy, the game ends automatically once the last clue of the last round is closed — the leaderboard appears immediately on the host panel, the board view, and every player's phone.

---
## Daily Double Wagering

Picking a Daily Double tile no longer just shows the clue — the host panel walks through a wager step first, all sound effects and the "DAILY DOUBLE!" splash play on the board/TV, not the host's own device:

1. **Host clicks a Daily Double tile.** The board shows the "DAILY DOUBLE!" splash and holds there through the wager step.
2. **The game picks who's wagering** — whoever most recently answered a *regular* clue correctly. That player's phone shows a wager screen (numeric entry plus $0 / Half / All-in quick buttons and a confirm step, since a locked wager can't be changed). Their max wager is `max(their current score, the board's highest point value)`, per standard Jeopardy rules, with a $0 floor.
   - **No player has answered correctly yet** (e.g. this is the very first clue of the game)? The host panel shows a picker so you can choose the contestant manually.
   - **The assigned player has no phone** (added directly from the host panel)? The host's override field is usable immediately, since no phone submission will ever arrive.
   - **The assigned player does have a phone?** The host's override field stays disabled until they submit — it's there to fix a mistake, not to skip their turn.
3. Once the wager is locked, click **Reveal Question** to show the clue on the board, exactly as before.
4. Mark **✓ Correct / ✗ Wrong** — the score changes by the locked wager, not the clue's face value.

---

## Final Jeopardy

If a board has Final Jeopardy configured (see [Creating Your First Board](#creating-your-first-board)), a **⚡ Start Final Jeopardy** button appears under the board grid once every regular clue is played (it'll ask you to confirm if any are still unplayed).

The round runs as a fixed sequence, driven entirely by the host panel — the board and player phones just follow along:

1. **Intro** — a gold "FINAL JEOPARDY!" splash plays on the board with a low ambient swell.
2. **Reveal Category** — the category card flips in on the board.
3. **Wagering** — every player's phone shows a wager screen (same numeric-entry-plus-quick-buttons UI as Daily Double). Players at $0 or below are automatically locked at a $0 wager so nobody gets stuck waiting on them. The host can force a reveal once wagers are in (missing wagers default to $0), or enter a wager on behalf of a player with no phone.
4. **Reveal Clue → Start Timer** — the clue appears with an on-screen countdown ring, synced across the board, phones, and host panel. A soft ambient pulse fills the silence while players think, with ticks in the final 5 seconds.
5. **Answering** — players type their answer on their phone; drafts sync live to the host panel as they type, and a Submit button locks it in early. Whatever's typed when time runs out counts — a blank answer means that player is out.
6. **Reveal** — the host steps through each contestant, lowest score first: name → wager → answer → judge (✓/✗), with an Undo available before moving on. The board updates live at each step.
7. **Correct Response → Final Scoreboard** — the host reveals the correct answer, then a podium-and-stats scoreboard with a winner's fanfare closes out the game.

---

## Player Instructions

Share this with your players:

> **How to buzz in:**
> 1. Open the link your host shared (works on any phone or laptop browser)
> 2. Enter your name and click **Join**
> 3. When the host opens a question, a big button appears — tap it to buzz in
> 4. First tap wins — keep your phone awake and ready!
>
> **If you land a Daily Double or reach Final Jeopardy:**
> Your phone will show a wager screen instead of the buzzer — type an amount (or use the $0 / Half / All-in buttons), then confirm. Once locked, it can't be changed, so double-check before confirming. During Final Jeopardy, you'll then get a text box to type your answer — you can keep editing it until you hit Submit or time runs out, whichever comes first.

---

## Environment Variables

These can be set in a `.env` file in the `backend/` folder (for local dev) or in `fly.toml` under `[env]` (for deployment).

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `NODE_ENV` | `development` | Set to `production` for deployment |
| `DATA_DIR` | `./data` | Path where boards and uploads are stored |
| `HOST_PASSCODE` | *(unset)* | Shared passcode required to create/edit/delete boards and upload/delete media. **Required in production** — the server refuses to start without it when `NODE_ENV=production`. Left unset in dev for convenience. |

### Setting `HOST_PASSCODE`

Board and media writes (`POST`/`PUT`/`DELETE`) are gated behind this passcode so a stranger who finds your app's URL can't edit or wipe out a game in progress. Reads (viewing boards, the TV board view, the buzzer) stay open — anyone with a room code can still watch or play, which is the intended trade-off for a home-party tool; room/board IDs are unlisted but not secret.

The first time the frontend needs to make a write, it'll prompt for the passcode and remember it in the browser's `localStorage`.

**Local dev:** add it to `backend/.env`:
```
HOST_PASSCODE=choose-a-passcode
```

**Fly.io:** set it as a secret (not in `fly.toml`, so it isn't committed):
```bash
fly secrets set HOST_PASSCODE=choose-a-passcode
```
To rotate it later, just run `fly secrets set HOST_PASSCODE=new-passcode` again — the app restarts and any browser with the old passcode gets a 401 and is re-prompted.

**Docker:** pass it as an env var:
```bash
HOST_PASSCODE=choose-a-passcode docker compose up -d
```

> There's no per-user accounts or rate-limiting on the passcode itself — it's a shared secret for a private/LAN game night, not a substitute for real auth on a public deployment.

---

## Docker (Self-Hosting)

If you want to run this on your own server (a VPS, Raspberry Pi, etc.) without Fly.io:

```bash
# Build and run with Docker Compose
docker compose up -d
```

The app runs on port `3001`. Put Nginx or Caddy in front of it for HTTPS.

To run on a different port:
```bash
PORT=8080 docker compose up -d
```

Data (boards + uploaded media) is stored in a named Docker volume `jeopardy_data` and persists across container restarts and updates.

To back up your boards:
```bash
docker compose cp app:/app/data ./backup
```
