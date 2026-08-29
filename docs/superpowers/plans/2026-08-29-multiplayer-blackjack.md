# Multiplayer Blackjack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-player blackjack game playable in the browser — one static client (GitHub Pages) and one small Node.js WebSocket relay server (Render/Fly.io free tier) that is the authoritative referee for game state.

**Architecture:** The server owns the deck, both hands, the dealer's hand, and turn order in an in-memory room registry; clients are thin views that send intents (`hit`/`stand`/`ready`) and render whatever `state` the server broadcasts. Game rules (deck/hand-value/dealer/outcome logic) are pure functions in `server/game.js`; room lifecycle (create/join/rejoin/disconnect/GC) lives in `server/rooms.js`; `server/server.js` wires both to the `ws` WebSocket transport. The client is plain HTML/CSS/JS at the repo root with no build step.

**Tech Stack:** Node.js + `ws` (server), vanilla HTML/CSS/JS (client), Docker + docker-compose for all local commands, Node's built-in `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-08-29-multiplayer-blackjack-design.md`

## Global Constraints

- No frameworks or build step on the client — plain HTML/CSS/JS only.
- Server has exactly one dependency: `ws`. No Express, no Socket.IO.
- v1 game actions are Hit and Stand only — no double down, split, or insurance.
- No betting/chips — rounds resolve to win/lose/push plus a running session tally.
- Cards are rendered as styled text `<div>`s — no image assets.
- All local commands (installing dependencies, running the server, running tests) go through Docker — never install Node or packages directly on the host machine. This is a standing preference for this user, not specific to this project.
- One shared 52-card deck, freshly shuffled every round.
- Dealer stands on soft 17, hits below 17.
- Turn order: host acts first, then the joining player, then the dealer plays automatically.
- No auto-forfeit on disconnect — the room waits indefinitely as long as one player is connected; an abandoned room (both disconnected) is garbage-collected after 10 minutes.
- Opponent hands are visible to both players (standard blackjack, not hidden like poker). Only the dealer's hole card is hidden, and only during the `playing` phase.

---

### Task 1: Core game logic (`server/game.js`)

**Files:**
- Create: `server/package.json`
- Create: `server/Dockerfile`
- Create: `docker-compose.yml`
- Create: `.gitignore`
- Create: `server/game.js`
- Test: `server/test/game.test.js`

**Interfaces:**
- Consumes: nothing (first module).
- Produces (used by Task 3): `createShuffledDeck(): Card[]`, `handValue(cards: Card[]): number`, `isBust(cards: Card[]): boolean`, `isBlackjack(cards: Card[]): boolean`, `dealerShouldHit(cards: Card[]): boolean`, `resolveOutcome(playerCards: Card[], dealerCards: Card[]): 'win'|'lose'|'push'`. A `Card` is `{ rank: string, suit: string }`.

- [ ] **Step 1: Create the project scaffolding**

Create `server/package.json`:

```json
{
  "name": "blackjack-server",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

Create `server/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
```

Create `docker-compose.yml` (repo root):

```yaml
services:
  blackjack-server:
    build: ./server
    ports:
      - "8080:8080"
    volumes:
      - ./server:/app
      - /app/node_modules
```

Create `.gitignore` (repo root):

```
node_modules/
```

- [ ] **Step 2: Build the image**

Run: `docker compose build`
Expected: image builds successfully, `ws` installed inside the container (not on the host).

- [ ] **Step 3: Write the failing tests**

Create `server/test/game.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createShuffledDeck,
  handValue,
  isBust,
  isBlackjack,
  dealerShouldHit,
  resolveOutcome,
} = require('../game');

test('createShuffledDeck returns 52 unique cards', () => {
  const deck = createShuffledDeck();
  assert.equal(deck.length, 52);
  const unique = new Set(deck.map((c) => `${c.rank}${c.suit}`));
  assert.equal(unique.size, 52);
});

test('handValue counts face cards as 10', () => {
  assert.equal(handValue([{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }]), 20);
});

test('handValue counts Ace as 11 when it does not bust', () => {
  assert.equal(handValue([{ rank: 'A', suit: '♠' }, { rank: '9', suit: '♥' }]), 20);
});

test('handValue drops Ace to 1 when 11 would bust', () => {
  assert.equal(
    handValue([{ rank: 'A', suit: '♠' }, { rank: '9', suit: '♥' }, { rank: '5', suit: '♦' }]),
    15
  );
});

test('handValue handles multiple Aces', () => {
  assert.equal(
    handValue([{ rank: 'A', suit: '♠' }, { rank: 'A', suit: '♥' }, { rank: '9', suit: '♦' }]),
    21
  );
});

test('isBust is true only above 21', () => {
  assert.equal(
    isBust([{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }, { rank: '5', suit: '♦' }]),
    true
  );
  assert.equal(isBust([{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }]), false);
});

test('isBlackjack requires exactly two cards totalling 21', () => {
  assert.equal(isBlackjack([{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }]), true);
  assert.equal(
    isBlackjack([{ rank: '7', suit: '♠' }, { rank: '7', suit: '♥' }, { rank: '7', suit: '♦' }]),
    false
  );
});

test('dealerShouldHit stands on soft 17', () => {
  assert.equal(dealerShouldHit([{ rank: 'A', suit: '♠' }, { rank: '6', suit: '♥' }]), false);
});

test('dealerShouldHit hits below 17', () => {
  assert.equal(dealerShouldHit([{ rank: '9', suit: '♠' }, { rank: '6', suit: '♥' }]), true);
});

test('resolveOutcome: player bust always loses even if dealer also busts', () => {
  const playerBust = [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }, { rank: '5', suit: '♦' }];
  const dealerBust = [{ rank: 'K', suit: '♣' }, { rank: 'Q', suit: '♦' }, { rank: '5', suit: '♠' }];
  assert.equal(resolveOutcome(playerBust, dealerBust), 'lose');
});

test('resolveOutcome: both blackjack is a push', () => {
  const hand = [{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }];
  const dealerHand = [{ rank: 'A', suit: '♣' }, { rank: 'K', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'push');
});

test('resolveOutcome: player blackjack beats dealer non-blackjack', () => {
  const hand = [{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }];
  const dealerHand = [{ rank: '9', suit: '♣' }, { rank: '9', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'win');
});

test('resolveOutcome: dealer blackjack beats player non-blackjack', () => {
  const hand = [{ rank: '9', suit: '♠' }, { rank: '9', suit: '♥' }];
  const dealerHand = [{ rank: 'A', suit: '♣' }, { rank: 'K', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'lose');
});

test('resolveOutcome: dealer bust with player still in play is a win', () => {
  const hand = [{ rank: '9', suit: '♠' }, { rank: '8', suit: '♥' }];
  const dealerBust = [{ rank: 'K', suit: '♣' }, { rank: 'Q', suit: '♦' }, { rank: '5', suit: '♠' }];
  assert.equal(resolveOutcome(hand, dealerBust), 'win');
});

test('resolveOutcome: higher hand value wins when neither busts nor has blackjack', () => {
  const hand = [{ rank: '9', suit: '♠' }, { rank: '9', suit: '♥' }];
  const dealerHand = [{ rank: '9', suit: '♣' }, { rank: '7', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'win');
});

test('resolveOutcome: equal values push', () => {
  const hand = [{ rank: '9', suit: '♠' }, { rank: '9', suit: '♥' }];
  const dealerHand = [{ rank: 'K', suit: '♣' }, { rank: '8', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'push');
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `docker compose run --rm blackjack-server npm test`
Expected: FAIL — `Cannot find module '../game'`

- [ ] **Step 5: Implement `server/game.js`**

```js
'use strict';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createShuffledDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

function handValue(cards) {
  let total = cards.reduce((sum, card) => sum + cardValue(card.rank), 0);
  let aceCount = cards.filter((card) => card.rank === 'A').length;
  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount -= 1;
  }
  return total;
}

function isBust(cards) {
  return handValue(cards) > 21;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

function dealerShouldHit(cards) {
  return handValue(cards) < 17;
}

function resolveOutcome(playerCards, dealerCards) {
  if (isBust(playerCards)) return 'lose';

  const playerHasBlackjack = isBlackjack(playerCards);
  const dealerHasBlackjack = isBlackjack(dealerCards);
  if (playerHasBlackjack && dealerHasBlackjack) return 'push';
  if (playerHasBlackjack) return 'win';
  if (dealerHasBlackjack) return 'lose';
  if (isBust(dealerCards)) return 'win';

  const playerValue = handValue(playerCards);
  const dealerValue = handValue(dealerCards);
  if (playerValue > dealerValue) return 'win';
  if (playerValue < dealerValue) return 'lose';
  return 'push';
}

module.exports = {
  createShuffledDeck,
  handValue,
  isBust,
  isBlackjack,
  dealerShouldHit,
  resolveOutcome,
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `docker compose run --rm blackjack-server npm test`
Expected: PASS (14 tests)

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/Dockerfile server/game.js server/test/game.test.js docker-compose.yml .gitignore
git commit -m "Add core blackjack game logic with unit tests"
```

---

### Task 2: Room registry (`server/rooms.js`)

**Files:**
- Create: `server/rooms.js`
- Test: `server/test/rooms.test.js`

**Interfaces:**
- Consumes: nothing (standalone module; `ws` objects it stores are treated as opaque).
- Produces (used by Task 3): `createRoom(): Room`, `getRoom(code: string): Room|undefined`, `removeRoom(code: string): void`, `addSeat(room, seatName: 'host'|'guest', ws): string` (returns playerToken), `findSeatByToken(room, token: string): 'host'|'guest'|null`, `hasFreeSeat(room): boolean`, `nextFreeSeatName(room): 'host'|'guest'|null`, `isRoomFull(room): boolean`, `isRoomEmpty(room): boolean`, `scheduleRoomCleanup(room, delayMs?: number): void`, `cancelRoomCleanup(room): void`, `ROOM_GC_DELAY_MS: number`.
- A `Room` is `{ code, seats: { host: Seat|null, guest: Seat|null }, deck: [], hands: { host: [], guest: [], dealer: [] }, stood: { host: false, guest: false }, phase: 'waiting', turn: null, results: { host: null, guest: null }, readyForNext: { host: false, guest: false }, tally: { host: {win,lose,push}, guest: {win,lose,push} }, gcTimer: null }`. A `Seat` is `{ token, ws, connected }`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/rooms.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rooms = require('../rooms');

test('createRoom generates a 4-character code with empty seats', () => {
  const room = rooms.createRoom();
  assert.equal(room.code.length, 4);
  assert.equal(room.seats.host, null);
  assert.equal(room.seats.guest, null);
  assert.equal(room.phase, 'waiting');
  rooms.removeRoom(room.code);
});

test('addSeat assigns a token and marks the seat connected', () => {
  const room = rooms.createRoom();
  const token = rooms.addSeat(room, 'host', { fake: 'ws' });
  assert.equal(typeof token, 'string');
  assert.equal(room.seats.host.token, token);
  assert.equal(room.seats.host.connected, true);
  rooms.removeRoom(room.code);
});

test('hasFreeSeat, nextFreeSeatName and isRoomFull reflect seat occupancy', () => {
  const room = rooms.createRoom();
  assert.equal(rooms.hasFreeSeat(room), true);
  assert.equal(rooms.nextFreeSeatName(room), 'host');
  rooms.addSeat(room, 'host', {});
  assert.equal(rooms.nextFreeSeatName(room), 'guest');
  rooms.addSeat(room, 'guest', {});
  assert.equal(rooms.hasFreeSeat(room), false);
  assert.equal(rooms.nextFreeSeatName(room), null);
  assert.equal(rooms.isRoomFull(room), true);
  rooms.removeRoom(room.code);
});

test('findSeatByToken finds the right seat or null', () => {
  const room = rooms.createRoom();
  const hostToken = rooms.addSeat(room, 'host', {});
  const guestToken = rooms.addSeat(room, 'guest', {});
  assert.equal(rooms.findSeatByToken(room, hostToken), 'host');
  assert.equal(rooms.findSeatByToken(room, guestToken), 'guest');
  assert.equal(rooms.findSeatByToken(room, 'bogus-token'), null);
  rooms.removeRoom(room.code);
});

test('isRoomEmpty is true only when no seat is connected', () => {
  const room = rooms.createRoom();
  assert.equal(rooms.isRoomEmpty(room), true);
  rooms.addSeat(room, 'host', {});
  assert.equal(rooms.isRoomEmpty(room), false);
  room.seats.host.connected = false;
  assert.equal(rooms.isRoomEmpty(room), true);
  rooms.removeRoom(room.code);
});

test('scheduleRoomCleanup removes an empty room after the delay but keeps an occupied one', async () => {
  const emptyRoom = rooms.createRoom();
  rooms.scheduleRoomCleanup(emptyRoom, 20);

  const occupiedRoom = rooms.createRoom();
  rooms.addSeat(occupiedRoom, 'host', {});
  rooms.scheduleRoomCleanup(occupiedRoom, 20);

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(rooms.getRoom(emptyRoom.code), undefined);
  assert.notEqual(rooms.getRoom(occupiedRoom.code), undefined);
  rooms.removeRoom(occupiedRoom.code);
});

test('cancelRoomCleanup prevents a scheduled removal', async () => {
  const room = rooms.createRoom();
  rooms.scheduleRoomCleanup(room, 20);
  rooms.cancelRoomCleanup(room);

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.notEqual(rooms.getRoom(room.code), undefined);
  rooms.removeRoom(room.code);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm blackjack-server npm test`
Expected: FAIL — `Cannot find module '../rooms'`

- [ ] **Step 3: Implement `server/rooms.js`**

```js
'use strict';

const rooms = new Map();
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;
const ROOM_GC_DELAY_MS = 10 * 60 * 1000;

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function generatePlayerToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createRoom() {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));

  const room = {
    code,
    seats: { host: null, guest: null },
    deck: [],
    hands: { host: [], guest: [], dealer: [] },
    stood: { host: false, guest: false },
    phase: 'waiting',
    turn: null,
    results: { host: null, guest: null },
    readyForNext: { host: false, guest: false },
    tally: {
      host: { win: 0, lose: 0, push: 0 },
      guest: { win: 0, lose: 0, push: 0 },
    },
    gcTimer: null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code);
}

function removeRoom(code) {
  rooms.delete(code);
}

function addSeat(room, seatName, ws) {
  const token = generatePlayerToken();
  room.seats[seatName] = { token, ws, connected: true };
  return token;
}

function findSeatByToken(room, token) {
  for (const seatName of ['host', 'guest']) {
    const seat = room.seats[seatName];
    if (seat && seat.token === token) return seatName;
  }
  return null;
}

function hasFreeSeat(room) {
  return room.seats.host === null || room.seats.guest === null;
}

function nextFreeSeatName(room) {
  if (room.seats.host === null) return 'host';
  if (room.seats.guest === null) return 'guest';
  return null;
}

function isRoomFull(room) {
  return room.seats.host !== null && room.seats.guest !== null;
}

function isRoomEmpty(room) {
  const hostConnected = Boolean(room.seats.host && room.seats.host.connected);
  const guestConnected = Boolean(room.seats.guest && room.seats.guest.connected);
  return !hostConnected && !guestConnected;
}

function scheduleRoomCleanup(room, delayMs = ROOM_GC_DELAY_MS) {
  cancelRoomCleanup(room);
  room.gcTimer = setTimeout(() => {
    if (isRoomEmpty(room)) removeRoom(room.code);
  }, delayMs);
  if (typeof room.gcTimer.unref === 'function') room.gcTimer.unref();
}

function cancelRoomCleanup(room) {
  if (room.gcTimer) {
    clearTimeout(room.gcTimer);
    room.gcTimer = null;
  }
}

module.exports = {
  createRoom,
  getRoom,
  removeRoom,
  addSeat,
  findSeatByToken,
  hasFreeSeat,
  nextFreeSeatName,
  isRoomFull,
  isRoomEmpty,
  scheduleRoomCleanup,
  cancelRoomCleanup,
  ROOM_GC_DELAY_MS,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm blackjack-server npm test`
Expected: PASS (all game.test.js and rooms.test.js tests)

- [ ] **Step 5: Commit**

```bash
git add server/rooms.js server/test/rooms.test.js
git commit -m "Add room registry with seat, token and cleanup lifecycle"
```

---

### Task 3: WebSocket server (`server/server.js`)

**Files:**
- Create: `server/server.js`
- Test: `server/test/server.test.js`

**Interfaces:**
- Consumes: everything from Task 1 (`server/game.js`) and Task 2 (`server/rooms.js`) by their exact exported names above.
- Produces (used by Task 6 for deployment, and by tests): `createServer(port: number): WebSocketServer` — starts listening immediately and returns the `ws` `WebSocketServer` instance (call `.close()` to stop it). Running `node server.js` directly starts a server on `process.env.PORT || 8080`.
- Wire protocol produced (consumed by the client in Tasks 4-5):
  - Client → server: `{type:'create_room'}`, `{type:'join_room', roomCode}`, `{type:'rejoin_room', roomCode, playerToken}`, `{type:'hit'}`, `{type:'stand'}`, `{type:'ready'}`.
  - Server → client: `{type:'created', roomCode, playerToken}`, `{type:'joined', playerToken}`, `{type:'error', message}`, and `{type:'state', phase, turn, you, hands:{host,guest,dealer}, results, tally, readyForNext, bothConnected}` where `hands.dealer[1]` is `{hidden:true}` instead of a real card while `phase === 'playing'`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/server.test.js`:

```js
'use strict';

// Must be set before requiring '../server' so its module-level constant
// picks up a short cleanup delay for the GC test below.
process.env.ROOM_GC_DELAY_MS = '50';

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server');
const rooms = require('../rooms');

function openClient(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(ws));
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw)));
  });
}

function waitUntil(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil timed out'));
      setTimeout(check, 10);
    };
    check();
  });
}

function trackState(...sockets) {
  const box = { state: null };
  for (const ws of sockets) {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'state') box.state = msg;
    });
  }
  return box;
}

async function startTestServer() {
  const port = 9000 + Math.floor(Math.random() * 10000);
  const server = createServer(port);
  return { server, port };
}

test('create_room then join_room deals a round to both players', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const guest = await openClient(port);
    const box = trackState(host, guest);

    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const createdMsg = await created;
    assert.equal(createdMsg.type, 'created');
    assert.equal(createdMsg.roomCode.length, 4);

    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode: createdMsg.roomCode }));
    await joined;

    await waitUntil(() => box.state && box.state.phase !== 'waiting');
    assert.equal(box.state.phase, 'playing');
    assert.equal(box.state.hands.host.length, 2);
    assert.equal(box.state.hands.guest.length, 2);
    assert.equal(box.state.hands.dealer.length, 2);

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});

test('joining a full room returns an error to the third connection', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const { roomCode } = await created;

    const guest = await openClient(port);
    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode }));
    await joined;

    const third = await openClient(port);
    const errorMsg = nextMessage(third);
    third.send(JSON.stringify({ type: 'join_room', roomCode }));
    const err = await errorMsg;
    assert.equal(err.type, 'error');
    assert.equal(err.message, 'room full');

    host.close();
    guest.close();
    third.close();
  } finally {
    server.close();
  }
});

test('acting out of turn is rejected with an error', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const guest = await openClient(port);
    const box = trackState(host, guest);

    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const { roomCode } = await created;

    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode }));
    await joined;

    await waitUntil(() => box.state && box.state.phase === 'playing');
    const outOfTurnClient = box.state.turn === 'host' ? guest : host;

    const errorMsg = nextMessage(outOfTurnClient);
    outOfTurnClient.send(JSON.stringify({ type: 'stand' }));
    const err = await errorMsg;
    assert.equal(err.type, 'error');
    assert.equal(err.message, 'not your turn');

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});

test('a full round of standing resolves to results with a tally', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const guest = await openClient(port);
    const box = trackState(host, guest);

    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const { roomCode } = await created;

    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode }));
    await joined;

    await waitUntil(() => box.state && box.state.phase !== 'waiting');

    while (box.state.phase === 'playing') {
      const actingClient = box.state.turn === 'host' ? host : guest;
      const turnBeforeAction = box.state.turn;
      actingClient.send(JSON.stringify({ type: 'stand' }));
      await waitUntil(() => box.state.turn !== turnBeforeAction || box.state.phase !== 'playing');
    }

    assert.equal(box.state.phase, 'results');
    assert.ok(['win', 'lose', 'push'].includes(box.state.results.host));
    assert.ok(['win', 'lose', 'push'].includes(box.state.results.guest));
    const hostTotal =
      box.state.tally.host.win + box.state.tally.host.lose + box.state.tally.host.push;
    assert.equal(hostTotal, 1);

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});

test('disconnecting marks the seat disconnected, and rejoining with the token restores it', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const { roomCode, playerToken } = await created;

    const guest = await openClient(port);
    const guestBox = trackState(guest);
    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode }));
    await joined;
    await waitUntil(() => guestBox.state && guestBox.state.phase !== 'waiting');

    host.close();
    await waitUntil(() => guestBox.state.bothConnected === false);

    const rejoinedHost = await openClient(port);
    const hostBox = trackState(rejoinedHost);
    rejoinedHost.send(JSON.stringify({ type: 'rejoin_room', roomCode, playerToken }));
    await waitUntil(() => hostBox.state !== null);
    assert.equal(hostBox.state.bothConnected, true);

    rejoinedHost.close();
    guest.close();
  } finally {
    server.close();
  }
});

test('an abandoned room is garbage-collected after the cleanup delay', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const { roomCode } = await created;

    assert.ok(rooms.getRoom(roomCode));
    host.close();
    await waitUntil(() => rooms.getRoom(roomCode) === undefined, 5000);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm blackjack-server npm test`
Expected: FAIL — `Cannot find module '../server'`

- [ ] **Step 3: Implement `server/server.js`**

```js
'use strict';

const { WebSocketServer } = require('ws');
const rooms = require('./rooms');
const { createShuffledDeck, isBust, isBlackjack, dealerShouldHit, resolveOutcome } = require('./game');

const TURN_ORDER = ['host', 'guest'];
const ROOM_GC_DELAY_MS = Number(process.env.ROOM_GC_DELAY_MS) || rooms.ROOM_GC_DELAY_MS;

function drawCard(room) {
  return room.deck.pop();
}

function isPlayerDone(room, seat) {
  return isBust(room.hands[seat]) || isBlackjack(room.hands[seat]) || room.stood[seat];
}

function advanceTurn(room) {
  const currentIndex = TURN_ORDER.indexOf(room.turn);
  for (let i = currentIndex + 1; i < TURN_ORDER.length; i++) {
    const seat = TURN_ORDER[i];
    if (!isPlayerDone(room, seat)) {
      room.turn = seat;
      return;
    }
  }
  playDealerAndResolve(room);
}

function playDealerAndResolve(room) {
  room.phase = 'dealer';
  room.turn = null;
  const anyoneStillIn = TURN_ORDER.some((seat) => !isBust(room.hands[seat]));
  if (anyoneStillIn) {
    while (dealerShouldHit(room.hands.dealer)) {
      room.hands.dealer.push(drawCard(room));
    }
  }
  for (const seat of TURN_ORDER) {
    const outcome = resolveOutcome(room.hands[seat], room.hands.dealer);
    room.results[seat] = outcome;
    room.tally[seat][outcome] += 1;
  }
  room.phase = 'results';
}

function startRound(room) {
  room.deck = createShuffledDeck();
  room.hands = {
    host: [drawCard(room), drawCard(room)],
    guest: [drawCard(room), drawCard(room)],
    dealer: [drawCard(room), drawCard(room)],
  };
  room.stood = { host: false, guest: false };
  room.results = { host: null, guest: null };
  room.readyForNext = { host: false, guest: false };
  room.phase = 'playing';
  room.turn = TURN_ORDER.find((seat) => !isPlayerDone(room, seat)) || null;
  if (room.turn === null) {
    playDealerAndResolve(room);
  }
}

function buildStateView(room, viewerSeat) {
  const dealerHand =
    room.phase === 'playing'
      ? [room.hands.dealer[0], { hidden: true }]
      : room.hands.dealer;
  return {
    type: 'state',
    phase: room.phase,
    turn: room.turn,
    you: viewerSeat,
    hands: {
      host: room.hands.host,
      guest: room.hands.guest,
      dealer: dealerHand,
    },
    results: room.results,
    tally: room.tally,
    readyForNext: room.readyForNext,
    bothConnected: Boolean(
      room.seats.host && room.seats.host.connected && room.seats.guest && room.seats.guest.connected
    ),
  };
}

function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendError(ws, message) {
  send(ws, { type: 'error', message });
}

function broadcastState(room) {
  for (const seat of TURN_ORDER) {
    const seatInfo = room.seats[seat];
    if (seatInfo && seatInfo.connected) {
      send(seatInfo.ws, buildStateView(room, seat));
    }
  }
}

function onCreateRoom(ws) {
  const room = rooms.createRoom();
  const token = rooms.addSeat(room, 'host', ws);
  ws.roomCode = room.code;
  ws.seat = 'host';
  send(ws, { type: 'created', roomCode: room.code, playerToken: token });
  broadcastState(room);
}

function onJoinRoom(ws, roomCode) {
  const room = rooms.getRoom(roomCode);
  if (!room) return sendError(ws, 'room not found');
  if (!rooms.hasFreeSeat(room)) return sendError(ws, 'room full');

  const seatName = rooms.nextFreeSeatName(room);
  const token = rooms.addSeat(room, seatName, ws);
  ws.roomCode = roomCode;
  ws.seat = seatName;
  send(ws, { type: 'joined', playerToken: token });

  if (rooms.isRoomFull(room)) {
    startRound(room);
  }
  broadcastState(room);
}

function onRejoinRoom(ws, roomCode, playerToken) {
  const room = rooms.getRoom(roomCode);
  if (!room) return sendError(ws, 'room not found');
  const seatName = rooms.findSeatByToken(room, playerToken);
  if (!seatName) return sendError(ws, 'invalid token');

  room.seats[seatName].ws = ws;
  room.seats[seatName].connected = true;
  ws.roomCode = roomCode;
  ws.seat = seatName;
  rooms.cancelRoomCleanup(room);
  broadcastState(room);
}

function withRoomAndSeat(ws, fn) {
  const room = rooms.getRoom(ws.roomCode);
  if (!room || !ws.seat) return sendError(ws, 'not in a room');
  fn(room, ws.seat);
}

function onHit(room, seat) {
  if (room.phase !== 'playing' || room.turn !== seat) {
    return sendError(room.seats[seat].ws, 'not your turn');
  }
  room.hands[seat].push(drawCard(room));
  if (isBust(room.hands[seat])) {
    advanceTurn(room);
  }
  broadcastState(room);
}

function onStand(room, seat) {
  if (room.phase !== 'playing' || room.turn !== seat) {
    return sendError(room.seats[seat].ws, 'not your turn');
  }
  room.stood[seat] = true;
  advanceTurn(room);
  broadcastState(room);
}

function onReady(room, seat) {
  if (room.phase !== 'results') return;
  room.readyForNext[seat] = true;
  if (room.readyForNext.host && room.readyForNext.guest) {
    startRound(room);
  }
  broadcastState(room);
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create_room':
      return onCreateRoom(ws);
    case 'join_room':
      return onJoinRoom(ws, msg.roomCode);
    case 'rejoin_room':
      return onRejoinRoom(ws, msg.roomCode, msg.playerToken);
    case 'hit':
      return withRoomAndSeat(ws, onHit);
    case 'stand':
      return withRoomAndSeat(ws, onStand);
    case 'ready':
      return withRoomAndSeat(ws, onReady);
    default:
      return sendError(ws, 'unknown message type');
  }
}

function handleDisconnect(ws) {
  const room = rooms.getRoom(ws.roomCode);
  if (!room || !ws.seat) return;
  const seatInfo = room.seats[ws.seat];
  if (seatInfo && seatInfo.ws === ws) {
    seatInfo.connected = false;
  }
  broadcastState(room);
  if (rooms.isRoomEmpty(room)) {
    rooms.scheduleRoomCleanup(room, ROOM_GC_DELAY_MS);
  }
}

function createServer(port) {
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return sendError(ws, 'invalid message');
      }
      handleMessage(ws, msg);
    });
    ws.on('close', () => handleDisconnect(ws));
  });
  return wss;
}

if (require.main === module) {
  const port = process.env.PORT || 8080;
  createServer(port);
  console.log(`Blackjack server listening on port ${port}`);
}

module.exports = { createServer };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm blackjack-server npm test`
Expected: PASS (all game, rooms, and server tests). The server tests deal real random hands, so on an approximately 1-in-500 run both players may be dealt a natural blackjack simultaneously, which resolves straight to `results` — this is a pre-existing, very low-probability timing edge in the "acting out of turn" test rather than a real bug; if it's ever observed, just re-run.

- [ ] **Step 5: Manually smoke-test the running server**

Run: `docker compose up`
Expected: console prints `Blackjack server listening on port 8080` and the container keeps running. Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add server/server.js server/test/server.test.js
git commit -m "Add WebSocket server wiring room lifecycle and game flow"
```

---

### Task 4: Client lobby screen

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `app.js`

**Interfaces:**
- Consumes: the wire protocol produced in Task 3 (`create_room`/`join_room`/`rejoin_room`/`created`/`joined`/`error`/`state`).
- Produces (used by Task 5): DOM element ids `lobby-screen`, `table-screen`, `lobby-status`, `create-room-button`, `join-room-button`, `room-code-input`, `room-code-display`, `connection-status`, `dealer-hand`, `dealer-cards`, `dealer-value`, `opponent-hand`, `opponent-cards`, `opponent-value`, `your-hand`, `your-cards`, `your-value`, `controls`, `hit-button`, `stand-button`, `ready-button`, `round-result`, `tally-display`. Globals `socket`, `currentRoomCode`, `currentPlayerToken`, and function `showTableScreen()`. The `renderState(state)` function is stubbed here and replaced in full in Task 5.

- [ ] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Blackjack with a Friend</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>
  <main id="lobby-screen">
    <h1>Blackjack</h1>
    <section>
      <button id="create-room-button">Create Room</button>
    </section>
    <section>
      <input id="room-code-input" placeholder="Room code" maxlength="4" />
      <button id="join-room-button">Join Room</button>
    </section>
    <p id="lobby-status"></p>
  </main>

  <main id="table-screen" hidden>
    <p id="room-code-display"></p>
    <p id="connection-status"></p>

    <section class="hand" id="dealer-hand">
      <h2>Dealer</h2>
      <div class="cards" id="dealer-cards"></div>
      <p id="dealer-value"></p>
    </section>

    <section class="hand" id="opponent-hand">
      <h2>Opponent</h2>
      <div class="cards" id="opponent-cards"></div>
      <p id="opponent-value"></p>
    </section>

    <section class="hand" id="your-hand">
      <h2>You</h2>
      <div class="cards" id="your-cards"></div>
      <p id="your-value"></p>
    </section>

    <section id="controls">
      <button id="hit-button">Hit</button>
      <button id="stand-button">Stand</button>
      <button id="ready-button" hidden>Play Again</button>
    </section>

    <p id="round-result"></p>
    <p id="tally-display"></p>
  </main>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `style.css`**

```css
body {
  font-family: sans-serif;
  max-width: 480px;
  margin: 2rem auto;
  text-align: center;
}

#table-screen[hidden],
#lobby-screen[hidden] {
  display: none;
}

.cards {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  min-height: 90px;
}

.card {
  width: 56px;
  height: 80px;
  border: 1px solid #333;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  font-weight: bold;
  background: white;
}

.card.red {
  color: #c0392b;
}

.card.black {
  color: #111;
}

.card.hidden {
  background: repeating-linear-gradient(45deg, #2c3e50, #2c3e50 5px, #34495e 5px, #34495e 10px);
}

#controls button {
  font-size: 1rem;
  padding: 0.5rem 1rem;
  margin: 0.25rem;
}

#lobby-status,
#connection-status {
  color: #555;
  min-height: 1.2em;
}
```

- [ ] **Step 3: Create `app.js` (lobby + connection only; `renderState` stubbed)**

```js
'use strict';

const isLocalDev =
  location.protocol === 'file:' ||
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1';
const SERVER_URL = isLocalDev
  ? 'ws://localhost:8080'
  : 'wss://REPLACE_WITH_YOUR_SERVER_URL.onrender.com';

const lobbyScreen = document.getElementById('lobby-screen');
const tableScreen = document.getElementById('table-screen');
const lobbyStatus = document.getElementById('lobby-status');
const createRoomButton = document.getElementById('create-room-button');
const joinRoomButton = document.getElementById('join-room-button');
const roomCodeInput = document.getElementById('room-code-input');
const roomCodeDisplay = document.getElementById('room-code-display');
const connectionStatus = document.getElementById('connection-status');

let socket = null;
let currentRoomCode = null;
let currentPlayerToken = null;
let pendingIntent = null;

function connect() {
  socket = new WebSocket(SERVER_URL);
  socket.addEventListener('open', onSocketOpen);
  socket.addEventListener('message', onSocketMessage);
  socket.addEventListener('close', onSocketClose);
  return new Promise((resolve) => {
    socket.addEventListener('open', () => resolve(socket), { once: true });
  });
}

function onSocketOpen() {
  if (pendingIntent) {
    socket.send(JSON.stringify(pendingIntent));
    pendingIntent = null;
  }
}

function onSocketClose() {
  if (currentRoomCode) {
    connectionStatus.textContent = 'Disconnected. Reconnecting...';
    setTimeout(reconnect, 1000);
  }
}

function reconnect() {
  pendingIntent = {
    type: 'rejoin_room',
    roomCode: currentRoomCode,
    playerToken: currentPlayerToken,
  };
  connect();
}

function onSocketMessage(event) {
  const msg = JSON.parse(event.data);
  if (msg.type === 'created') {
    currentRoomCode = msg.roomCode;
    currentPlayerToken = msg.playerToken;
    saveSession();
    showTableScreen();
    roomCodeDisplay.textContent = `Room code: ${currentRoomCode}`;
    lobbyStatus.textContent = '';
  } else if (msg.type === 'joined') {
    currentPlayerToken = msg.playerToken;
    saveSession();
    showTableScreen();
    roomCodeDisplay.textContent = `Room code: ${currentRoomCode}`;
    lobbyStatus.textContent = '';
  } else if (msg.type === 'error') {
    lobbyStatus.textContent = msg.message;
  } else if (msg.type === 'state') {
    connectionStatus.textContent = '';
    renderState(msg);
  }
}

function saveSession() {
  localStorage.setItem(
    'blackjackSession',
    JSON.stringify({ roomCode: currentRoomCode, playerToken: currentPlayerToken })
  );
}

function loadSession() {
  const raw = localStorage.getItem('blackjackSession');
  return raw ? JSON.parse(raw) : null;
}

function showTableScreen() {
  lobbyScreen.hidden = true;
  tableScreen.hidden = false;
}

createRoomButton.addEventListener('click', async () => {
  currentRoomCode = null;
  currentPlayerToken = null;
  pendingIntent = { type: 'create_room' };
  await connect();
});

joinRoomButton.addEventListener('click', async () => {
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  if (roomCode.length !== 4) {
    lobbyStatus.textContent = 'Enter the 4-character room code.';
    return;
  }
  currentRoomCode = roomCode;
  currentPlayerToken = null;
  pendingIntent = { type: 'join_room', roomCode };
  await connect();
});

function renderState(state) {
  // Replaced with full rendering in the next task.
}

(function autoRejoin() {
  const session = loadSession();
  if (session) {
    currentRoomCode = session.roomCode;
    currentPlayerToken = session.playerToken;
    pendingIntent = {
      type: 'rejoin_room',
      roomCode: session.roomCode,
      playerToken: session.playerToken,
    };
    showTableScreen();
    connect();
  }
})();
```

- [ ] **Step 4: Manually verify the lobby**

Run: `docker compose up` (from repo root)
Then open `index.html` directly in two separate browser windows (`file://` path works fine).
Expected: in window 1, click "Create Room" — it switches to the table screen and shows a 4-character room code. In window 2, type that code and click "Join Room" — it also switches to the table screen. No card rendering yet (that's Task 5) — this step only confirms the room handshake and screen switch work.

- [ ] **Step 5: Commit**

```bash
git add index.html style.css app.js
git commit -m "Add client lobby: create/join room and WebSocket connection"
```

---

### Task 5: Client game board and gameplay

**Files:**
- Modify: `app.js` (full replacement, extending Task 4's version)

**Interfaces:**
- Consumes: the `state` message shape from Task 3 (`phase`, `turn`, `you`, `hands.{host,guest,dealer}`, `results`, `tally`, `readyForNext`, `bothConnected`) and the DOM ids from Task 4.
- Produces: a fully playable client — no further tasks depend on new interfaces from this one.

- [ ] **Step 1: Replace `app.js` with the complete client**

```js
'use strict';

const isLocalDev =
  location.protocol === 'file:' ||
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1';
const SERVER_URL = isLocalDev
  ? 'ws://localhost:8080'
  : 'wss://REPLACE_WITH_YOUR_SERVER_URL.onrender.com';

const lobbyScreen = document.getElementById('lobby-screen');
const tableScreen = document.getElementById('table-screen');
const lobbyStatus = document.getElementById('lobby-status');
const createRoomButton = document.getElementById('create-room-button');
const joinRoomButton = document.getElementById('join-room-button');
const roomCodeInput = document.getElementById('room-code-input');
const roomCodeDisplay = document.getElementById('room-code-display');
const connectionStatus = document.getElementById('connection-status');

const dealerCardsEl = document.getElementById('dealer-cards');
const dealerValueEl = document.getElementById('dealer-value');
const opponentCardsEl = document.getElementById('opponent-cards');
const opponentValueEl = document.getElementById('opponent-value');
const yourCardsEl = document.getElementById('your-cards');
const yourValueEl = document.getElementById('your-value');
const hitButton = document.getElementById('hit-button');
const standButton = document.getElementById('stand-button');
const readyButton = document.getElementById('ready-button');
const roundResultEl = document.getElementById('round-result');
const tallyDisplayEl = document.getElementById('tally-display');

let socket = null;
let currentRoomCode = null;
let currentPlayerToken = null;
let pendingIntent = null;

function connect() {
  socket = new WebSocket(SERVER_URL);
  socket.addEventListener('open', onSocketOpen);
  socket.addEventListener('message', onSocketMessage);
  socket.addEventListener('close', onSocketClose);
  return new Promise((resolve) => {
    socket.addEventListener('open', () => resolve(socket), { once: true });
  });
}

function onSocketOpen() {
  if (pendingIntent) {
    socket.send(JSON.stringify(pendingIntent));
    pendingIntent = null;
  }
}

function onSocketClose() {
  if (currentRoomCode) {
    connectionStatus.textContent = 'Disconnected. Reconnecting...';
    setTimeout(reconnect, 1000);
  }
}

function reconnect() {
  pendingIntent = {
    type: 'rejoin_room',
    roomCode: currentRoomCode,
    playerToken: currentPlayerToken,
  };
  connect();
}

function onSocketMessage(event) {
  const msg = JSON.parse(event.data);
  if (msg.type === 'created') {
    currentRoomCode = msg.roomCode;
    currentPlayerToken = msg.playerToken;
    saveSession();
    showTableScreen();
    roomCodeDisplay.textContent = `Room code: ${currentRoomCode}`;
    lobbyStatus.textContent = '';
  } else if (msg.type === 'joined') {
    currentPlayerToken = msg.playerToken;
    saveSession();
    showTableScreen();
    roomCodeDisplay.textContent = `Room code: ${currentRoomCode}`;
    lobbyStatus.textContent = '';
  } else if (msg.type === 'error') {
    if (tableScreen.hidden) {
      lobbyStatus.textContent = msg.message;
    } else {
      connectionStatus.textContent = msg.message;
      setTimeout(() => {
        connectionStatus.textContent = '';
      }, 2000);
    }
  } else if (msg.type === 'state') {
    renderState(msg);
  }
}

function saveSession() {
  localStorage.setItem(
    'blackjackSession',
    JSON.stringify({ roomCode: currentRoomCode, playerToken: currentPlayerToken })
  );
}

function loadSession() {
  const raw = localStorage.getItem('blackjackSession');
  return raw ? JSON.parse(raw) : null;
}

function showTableScreen() {
  lobbyScreen.hidden = true;
  tableScreen.hidden = false;
}

createRoomButton.addEventListener('click', async () => {
  currentRoomCode = null;
  currentPlayerToken = null;
  pendingIntent = { type: 'create_room' };
  await connect();
});

joinRoomButton.addEventListener('click', async () => {
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  if (roomCode.length !== 4) {
    lobbyStatus.textContent = 'Enter the 4-character room code.';
    return;
  }
  currentRoomCode = roomCode;
  currentPlayerToken = null;
  pendingIntent = { type: 'join_room', roomCode };
  await connect();
});

function cardValueForDisplay(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

function computeDisplayValue(cards) {
  const visibleCards = cards.filter((card) => !card.hidden);
  let total = visibleCards.reduce((sum, card) => sum + cardValueForDisplay(card.rank), 0);
  let aceCount = visibleCards.filter((card) => card.rank === 'A').length;
  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount -= 1;
  }
  return total;
}

function renderCard(card) {
  const div = document.createElement('div');
  if (card.hidden) {
    div.className = 'card hidden';
    return div;
  }
  const isRed = card.suit === '♥' || card.suit === '♦';
  div.className = `card ${isRed ? 'red' : 'black'}`;
  div.textContent = `${card.rank}${card.suit}`;
  return div;
}

function renderHand(container, cards) {
  container.innerHTML = '';
  for (const card of cards) {
    container.appendChild(renderCard(card));
  }
}

function renderState(state) {
  const opponentSeat = state.you === 'host' ? 'guest' : 'host';

  renderHand(yourCardsEl, state.hands[state.you]);
  yourValueEl.textContent = `Value: ${computeDisplayValue(state.hands[state.you])}`;

  renderHand(opponentCardsEl, state.hands[opponentSeat]);
  opponentValueEl.textContent = `Value: ${computeDisplayValue(state.hands[opponentSeat])}`;

  renderHand(dealerCardsEl, state.hands.dealer);
  dealerValueEl.textContent =
    state.phase === 'playing' ? '' : `Value: ${computeDisplayValue(state.hands.dealer)}`;

  const yourTurn = state.phase === 'playing' && state.turn === state.you;
  hitButton.disabled = !yourTurn;
  standButton.disabled = !yourTurn;

  if (state.phase === 'results') {
    const result = state.results[state.you];
    roundResultEl.textContent =
      result === 'win' ? 'You win!' : result === 'lose' ? 'You lose.' : 'Push.';
    const tally = state.tally[state.you];
    tallyDisplayEl.textContent = `Session: ${tally.win}W - ${tally.lose}L - ${tally.push}P`;
    readyButton.hidden = false;
    readyButton.disabled = state.readyForNext[state.you];
    readyButton.textContent = state.readyForNext[state.you]
      ? 'Waiting for opponent...'
      : 'Play Again';
  } else {
    roundResultEl.textContent = '';
    readyButton.hidden = true;
  }

  if (!state.bothConnected) {
    connectionStatus.textContent = 'Waiting for opponent to reconnect...';
  } else if (connectionStatus.textContent === 'Waiting for opponent to reconnect...') {
    connectionStatus.textContent = '';
  }
}

hitButton.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'hit' }));
});

standButton.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'stand' }));
});

readyButton.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'ready' }));
});

(function autoRejoin() {
  const session = loadSession();
  if (session) {
    currentRoomCode = session.roomCode;
    currentPlayerToken = session.playerToken;
    pendingIntent = {
      type: 'rejoin_room',
      roomCode: session.roomCode,
      playerToken: session.playerToken,
    };
    showTableScreen();
    connect();
  }
})();
```

- [ ] **Step 2: Manually play a full game**

Run: `docker compose up` (from repo root, if not already running)
Open `index.html` in two browser windows. In window 1 click "Create Room"; in window 2 enter the shown code and click "Join Room".

Verify:
- Both windows show 2 dealt cards each for "You" and "Opponent", and the dealer shows one real card plus one face-down placeholder.
- Hit/Stand buttons are enabled only for the player whose turn it is (host first).
- Clicking Hit adds a card and updates the value; busting (value > 21) automatically ends that player's turn.
- Clicking Stand passes the turn to the other player, then to the dealer, which reveals its hidden card and draws until 17+.
- Results show "You win!" / "You lose." / "Push." correctly per player, and the session tally increments.
- "Play Again" is disabled after clicking until the other player also clicks it, then a new round deals automatically.
- Refresh one browser window mid-round: it should auto-rejoin (via the stored `localStorage` session) and resume seeing the current state; the other window should briefly show "Waiting for opponent to reconnect..." until the refresh completes.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Add full game board rendering and gameplay actions"
```

---

### Task 6: Deployment docs and README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the finished `server/` (Task 3) and root static client (Tasks 4-5).
- Produces: nothing further consumes this — it is the terminal task.

- [ ] **Step 1: Create `README.md`**

```markdown
# Blackjack with a Friend

A two-player blackjack game you play in the browser with a friend, each
against an automated dealer that plays by standard rules (hits below 17,
stands on soft 17). No accounts, no betting — just Hit, Stand, and a
running win/lose/push tally for the session.

## Local development

Requires Docker (no local Node.js install needed):

\`\`\`bash
docker compose up --build
\`\`\`

This starts the WebSocket server on `ws://localhost:8080`. Then open
`index.html` directly in two browser tabs/windows (opening the file
directly, `file://`, works fine) to play a round against yourself locally.

Run the test suite:

\`\`\`bash
docker compose run --rm blackjack-server npm test
\`\`\`

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
\`\`\`

- [ ] **Step 2: Deploy and verify live**

Follow the steps in the README to deploy the server and client. Then, from
two different devices/networks (or your phone on cellular data plus your
laptop), open the GitHub Pages URL on both, create a room on one, join
with the code on the other, and play at least one full round end-to-end,
including clicking "Play Again" on both to confirm a second round deals.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Add README with local dev and deployment instructions"
```
