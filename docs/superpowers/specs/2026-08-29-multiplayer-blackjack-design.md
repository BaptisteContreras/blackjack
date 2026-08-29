# Multiplayer Blackjack — Design Spec

Date: 2026-08-29

## Purpose

A browser-based blackjack game for two friends to play together online: one
creates a room, the other joins with a room code, and they play a few rounds
of blackjack against an automated dealer. No accounts, no real money, no
complicated infrastructure — a static frontend plus one small relay server.

## Architecture

```
GitHub Pages (static)              Render/Fly.io free tier (Node.js)
┌─────────────────────┐            ┌──────────────────────────┐
│ index.html/css/js    │  WSS      │ server.js (ws library)    │
│ - lobby (create/join)│◄─────────►│ - holds all room state    │
│ - game board UI      │            │ - deck, hands, turn order  │
│ - renders server state│           │ - enforces all game rules  │
└─────────────────────┘            └──────────────────────────┘
```

The server is the sole source of truth: it owns the deck, both hands, the
dealer's hand, and turn order. Clients only send intents (`hit`, `stand`,
`ready`) and render whatever state the server broadcasts. Hidden information
(dealer's hole card, until revealed) never reaches a client early, so there's
no DevTools-inspection cheat path.

Opponent hands are visible to both players (standard blackjack, not
poker-style hidden hands) — confirmed with user.

## Tech stack

- Server: Node.js + the `ws` library (raw WebSockets, no framework).
- Client: vanilla HTML/CSS/JS, no build step, no bundler, no UI framework.
- Cards rendered as styled `<div>`s (rank + suit text, red/black by suit) —
  no image assets for v1.
- Local dev: Dockerfile + docker-compose.yml, so running the server locally
  is `docker compose up` — no Node install on the host machine. This is a
  standing preference for this user, not specific to this project.
- Deployment: GitHub Pages for the static client; Render or Fly.io free tier
  for the Node server (their own build containers — no local install
  needed either).

## Components

- **`server.js`** — WebSocket server. In-memory `Map` of roomCode → room
  state. Handles connect/join/reconnect/disconnect, validates and applies
  game actions, broadcasts state to both clients in a room.
- **`game.js`** (shared logic, required by server only) — pure functions:
  build/shuffle a 52-card deck, deal, compute hand value (Ace as 1 or 11),
  dealer-play algorithm, resolve round outcomes. No I/O — easy to unit test.
- **Client `app.js`** — WebSocket client wrapper, lobby screen logic
  (create/join room), game screen rendering, sends action messages on
  button clicks, handles reconnect UI state.
- **Client `index.html` + `style.css`** — single page, two screens (lobby,
  table) toggled by JS.

## Protocol (WebSocket JSON messages)

**Client → Server:**
- `create_room` → server generates a 4-char room code, creates the room,
  replies `{roomCode, playerToken}`.
- `join_room {roomCode}` → validates room exists and has a free seat,
  replies `{playerToken}`.
- `rejoin_room {roomCode, playerToken}` → reclaims a seat after a
  disconnect.
- `ready` → signals ready for the next round to be dealt.
- `hit` / `stand` → only valid on that player's turn; server rejects
  otherwise.

**Server → Client (broadcast to both, scoped per recipient):**
- `state` → full room snapshot: your own hand, opponent's hand (visible),
  dealer's hand with the hole card marked `"hidden"` until the dealer's
  turn resolves (so the UI can render a card-back placeholder).
- `error {message}` → e.g. `"not your turn"`, `"room full"`,
  `"room not found"`.

## Game rules (v1 scope)

- Actions: **Hit and Stand only** — no double down, split, or insurance in
  v1.
- No betting/chips — each round just resolves to win / lose / push per
  player, plus a running session tally (e.g. "3 wins – 1 loss").
- One shared 52-card deck, **freshly shuffled every round** (no persistent
  shoe, no reshuffle-mid-round logic needed).
- Turn order: host acts first, then the joining player, then the dealer
  plays automatically.
- Dealer plays after both players finish: hits until 17+, **stands on soft
  17**.
- Natural blackjack (21 on the first two cards) resolves immediately for
  that player, no hit/stand turn. If the dealer also has a natural, it's a
  push against any player who also has one.
- Bust is an immediate loss for that player; a busted player is skipped
  when comparing against the dealer's final hand. If every player has
  busted, the dealer's hand is still dealt out and shown, but the outcome
  is already decided.
- Ace counts as 11 unless that would bust the hand, then counts as 1
  (standard soft/hard hand value logic).
- New round starts only once **both** players click "Ready" after seeing
  results — keeps both players in sync.

## Room lifecycle & reconnection

- A room with only the host waits in a "waiting for opponent" state.
- A third connection attempt to an already-full room gets
  `error: "room full"`.
- `playerToken` (returned on create/join) is stored in the client's
  `localStorage` and replayed via `rejoin_room` to reclaim a seat after a
  disconnect — there are no accounts, so this token is the only identity
  mechanism.
- If a player disconnects mid-game, the game pauses (no forced auto-loss);
  the other client sees "waiting for opponent to reconnect". There is
  **no auto-forfeit timer** — the room waits indefinitely as long as at
  least one player is connected.
- An abandoned room (both players gone) is garbage-collected after a
  10-minute timeout, so the server doesn't leak memory over time.

## Error handling

- Invalid actions (wrong turn, joining a full/nonexistent room) get an
  `error` message back to just that client; the server never applies an
  invalid action to room state.
- A WebSocket close is detected server-side; the room is marked "player
  disconnected" and the seat is reserved for `rejoin_room`.
- Client-side: a "reconnecting..." UI state appears on unexpected
  disconnect, with automatic reconnect attempts using the stored token.

## Testing approach

- `game.js` is pure functions — unit tested with Node's built-in
  `node:test`, no extra test framework dependency.
- Server protocol/room logic covered by integration tests that spin up the
  server and drive it with real `ws` client connections (create room,
  join, play a full round, disconnect/reconnect).
- Manual end-to-end check: two browser windows against a locally
  `docker compose up` server.

## Explicitly out of scope for v1

- Double down, split, insurance.
- Betting/chip bankroll.
- More than 2 players per room.
- Persistent accounts, stats across sessions, or a database.
- Card image assets (styled text divs only).
- TURN/relay fallback concerns — not applicable, this is a WebSocket relay
  design, not P2P.
