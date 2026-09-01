# Blackjack with a Friend

A two-player blackjack game you play in the browser with a friend, each
against an automated dealer that plays by standard rules (hits below 17,
stands on soft 17). No accounts — just Hit, Stand, chip betting with a
configurable starting bankroll, and a running win/lose/push tally for the
session.

## Local development

Requires Docker (no local Node.js install needed):

```bash
docker compose up --build
```

This starts the WebSocket server on `ws://localhost:8080`. Then open
`index.html` directly in two browser tabs/windows (opening the file
directly, `file://`, works fine) to play a round against yourself locally.

Run the test suite:

```bash
docker compose run --rm blackjack-server npm test
```

## Deploying

1. **Server** (Render free tier, or any host that runs a Node.js web
   service):
   - Push this repo to GitHub.
   - On Render, create a new Web Service from the repo.
   - Set Root Directory to `server`.
   - Build command: `npm install`. Start command: `node server.js`.
   - Deploy, then copy the public URL Render gives you (e.g.
     `https://blackjack-server-xxxx.onrender.com`). Render's free tier
     spins down when idle, so the first connection after a while may take
     a few seconds to wake it up — that's expected.

2. **Client** (GitHub Pages):
   - Edit `app.js` and replace `REPLACE_WITH_YOUR_SERVER_URL.onrender.com`
     in the `SERVER_URL` constant with your Render URL from step 1,
     keeping the `wss://` scheme.
   - Commit and push.
   - In the GitHub repo's Settings → Pages, set source to the `main`
     branch, `/ (root)` folder.
   - Your game will be live at `https://<your-username>.github.io/<repo>/`.

3. **Play**: share the GitHub Pages URL with your friend. One of you
   clicks "Create Room" and shares the 4-character code; the other clicks
   "Join Room" and enters it.

## Rules (v1)

- Hit and Stand only — no double down, split, or insurance.
- Each room starts with a configurable chip bankroll (default 1000). Both
  players bet before every round; wins pay 1:1 (3:2 for a natural
  blackjack), losses forfeit the bet, and pushes return it.
- The game ends for a room when either player's bankroll hits exactly 0;
  either player can reset both bankrolls at any time to start fresh.
- A running win/lose/push session tally is kept separately and is never
  reset by betting or a bankroll reset.
- One shared 52-card deck, freshly shuffled every round.
- Dealer stands on soft 17.
- New rounds start once both players have placed a bet.
- If a player disconnects, the game pauses and waits for them to
  reconnect (using the same browser, since the reconnect token is stored
  in that browser's local storage) — there's no time limit.

## Design & implementation docs

- `docs/superpowers/specs/2026-08-29-multiplayer-blackjack-design.md`
- `docs/superpowers/plans/2026-08-29-multiplayer-blackjack.md`
- `docs/superpowers/specs/2026-08-30-betting-bankroll-design.md`
- `docs/superpowers/plans/2026-08-30-betting-bankroll.md`
