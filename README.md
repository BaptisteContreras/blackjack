# Blackjack with a Friend

A two-player blackjack game you play in the browser with a friend, each
against an automated dealer that plays by standard rules (hits below 17,
stands on soft 17). No accounts, no betting — just Hit, Stand, and a
running win/lose/push tally for the session.

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
- No betting — each round resolves to win / lose / push, with a running
  session tally.
- One shared 52-card deck, freshly shuffled every round.
- Dealer stands on soft 17.
- New rounds start once both players click "Play Again".
- If a player disconnects, the game pauses and waits for them to
  reconnect (using the same browser, since the reconnect token is stored
  in that browser's local storage) — there's no time limit.

## Design & implementation docs

- `docs/superpowers/specs/2026-08-29-multiplayer-blackjack-design.md`
- `docs/superpowers/plans/2026-08-29-multiplayer-blackjack.md`
