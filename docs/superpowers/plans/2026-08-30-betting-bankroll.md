# Betting & Bankroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fake-money betting to the existing multiplayer blackjack game — each room starts with a configurable chip bankroll, players wager before every round, payouts follow standard blackjack rules, the game ends when a player's bankroll hits zero, and either player can reset the bankroll at any time.

**Architecture:** Same client/server split as the base game. The server remains the sole authority: room state gains `startingBankroll`, `bankroll`, and `bets`; the round cycle gains a `betting` phase (collects wagers before dealing) and a `game_over` phase (terminal until `reset_game`). Payout math is a new pure function in `server/game.js`, unit-tested like the other rule functions. The client adds a lobby input, a betting-phase view, bankroll badges, a game-over screen, and a persistent reset button — all thin renderers of whatever `state` the server broadcasts, same as the rest of the client.

**Tech Stack:** Node.js + `ws` (server, no new dependencies), vanilla HTML/CSS/JS (client), Docker + docker-compose for all local commands, Node's built-in `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-08-30-betting-bankroll-design.md`

## Global Constraints

- All local commands go through Docker — `docker compose run --rm blackjack-server npm test` for tests, `docker compose up --build` to run the server. Never install Node or npm packages directly on the host.
- No new dependencies — reuse the existing `ws` package only.
- Escrow model: a bet is deducted from bankroll the instant it's placed (during `betting`), not at resolution. Resolution only adds the payout back.
- Payout by outcome: push → stake returned (`+= bet`); normal win → 1:1 (`+= bet * 2`); blackjack win → 3:2, rounded down (`+= bet + floor(bet * 1.5)`); lose → nothing added back (`+= 0`).
- `startingBankroll`: missing, non-numeric, or non-positive values default to 1000; any other numeric value is floored to an integer and clamped to `[10, 1,000,000]`.
- Double down, split, table bet min/max beyond "must fit your bankroll", and bankroll persistence across server restarts are explicitly out of scope for this change.
- The existing win/lose/push tally (the "Leaderboard" panel) is never reset by betting, game-over, or `reset_game` — it is untouched by all of this.
- `reset_game` is valid in any phase, from either player, with no server-side confirmation — the client's `window.confirm` dialog is the only guard against misclicks.
- Card rendering, turn order (host then guest), dealer standing on soft 17, and disconnect/reconnect handling are all unchanged from the base game and must keep working.

---

### Task 1: Payout calculation (`server/game.js`)

**Files:**
- Modify: `server/game.js`
- Test: `server/test/game.test.js`

**Interfaces:**
- Consumes: nothing new — sits alongside the existing pure rule functions.
- Produces (used by Task 4): `computePayout(result: 'win'|'lose'|'push', isPlayerBlackjack: boolean, bet: number): number` — the amount to add back to a player's bankroll after a round resolves.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/game.test.js` (add `computePayout` to the existing `require` destructure at the top, then add these tests at the end of the file):

```js
const {
  createShuffledDeck,
  handValue,
  isBust,
  isBlackjack,
  dealerShouldHit,
  resolveOutcome,
  computePayout,
} = require('../game');
```

```js
test('computePayout: push returns the full stake and nothing more', () => {
  assert.equal(computePayout('push', false, 50), 50);
  assert.equal(computePayout('push', true, 50), 50);
});

test('computePayout: lose returns nothing (the stake was already deducted)', () => {
  assert.equal(computePayout('lose', false, 50), 0);
  assert.equal(computePayout('lose', true, 50), 0);
});

test('computePayout: normal win pays 1:1 (stake back plus an equal amount)', () => {
  assert.equal(computePayout('win', false, 50), 100);
  assert.equal(computePayout('win', false, 1), 2);
});

test('computePayout: blackjack win pays 3:2, rounded down for odd bets', () => {
  assert.equal(computePayout('win', true, 50), 125);
  assert.equal(computePayout('win', true, 5), 12);
  assert.equal(computePayout('win', true, 1), 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm blackjack-server npm test`
Expected: FAIL — `computePayout is not a function` (or `undefined`)

- [ ] **Step 3: Implement `computePayout`**

In `server/game.js`, add the function after `resolveOutcome` and add it to `module.exports`:

```js
function computePayout(result, isPlayerBlackjack, bet) {
  if (result === 'push') return bet;
  if (result === 'lose') return 0;
  if (isPlayerBlackjack) return bet + Math.floor(bet * 1.5);
  return bet * 2;
}
```

```js
module.exports = {
  createShuffledDeck,
  handValue,
  isBust,
  isBlackjack,
  dealerShouldHit,
  resolveOutcome,
  computePayout,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm blackjack-server npm test`
Expected: PASS (all `game.test.js` tests, including the 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add server/game.js server/test/game.test.js
git commit -m "Add computePayout for betting payouts"
```

---

### Task 2: Bankroll state in the room registry (`server/rooms.js`)

**Files:**
- Modify: `server/rooms.js`
- Test: `server/test/rooms.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 3 & 4): `rooms.createRoom(startingBankroll?: number): Room` — now accepts an optional starting bankroll. Every `Room` gains `startingBankroll: number`, `bankroll: { host: number, guest: number }`, and `bets: { host: number|null, guest: number|null }`.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/rooms.test.js` (after the existing `createRoom generates a 4-character code...` test):

```js
test('createRoom defaults startingBankroll to 1000 when omitted', () => {
  const room = rooms.createRoom();
  assert.equal(room.startingBankroll, 1000);
  assert.deepEqual(room.bankroll, { host: 1000, guest: 1000 });
  assert.deepEqual(room.bets, { host: null, guest: null });
  rooms.removeRoom(room.code);
});

test('createRoom clamps a non-positive or non-numeric startingBankroll to the default', () => {
  const roomA = rooms.createRoom(-50);
  assert.equal(roomA.startingBankroll, 1000);
  rooms.removeRoom(roomA.code);

  const roomB = rooms.createRoom('not a number');
  assert.equal(roomB.startingBankroll, 1000);
  rooms.removeRoom(roomB.code);

  const roomC = rooms.createRoom(0);
  assert.equal(roomC.startingBankroll, 1000);
  rooms.removeRoom(roomC.code);
});

test('createRoom clamps an absurdly large startingBankroll down to 1,000,000', () => {
  const room = rooms.createRoom(50000000);
  assert.equal(room.startingBankroll, 1000000);
  rooms.removeRoom(room.code);
});

test('createRoom clamps a too-small positive startingBankroll up to 10', () => {
  const room = rooms.createRoom(3);
  assert.equal(room.startingBankroll, 10);
  rooms.removeRoom(room.code);
});

test('createRoom floors a non-integer startingBankroll before clamping', () => {
  const room = rooms.createRoom(500.7);
  assert.equal(room.startingBankroll, 500);
  rooms.removeRoom(room.code);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm blackjack-server npm test`
Expected: FAIL — `room.startingBankroll` is `undefined`

- [ ] **Step 3: Implement the bankroll fields**

In `server/rooms.js`, add constants near the top (after `ROOM_GC_DELAY_MS`):

```js
const DEFAULT_STARTING_BANKROLL = 1000;
const MIN_STARTING_BANKROLL = 10;
const MAX_STARTING_BANKROLL = 1000000;

function clampStartingBankroll(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return DEFAULT_STARTING_BANKROLL;
  }
  const rounded = Math.floor(num);
  return Math.min(MAX_STARTING_BANKROLL, Math.max(MIN_STARTING_BANKROLL, rounded));
}
```

Update `createRoom` to accept and use it:

```js
function createRoom(startingBankroll) {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));

  const bankroll = clampStartingBankroll(startingBankroll);
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
    startingBankroll: bankroll,
    bankroll: { host: bankroll, guest: bankroll },
    bets: { host: null, guest: null },
    gcTimer: null,
  };
  rooms.set(code, room);
  return room;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm blackjack-server npm test`
Expected: PASS (all tests, including the 5 new ones)

- [ ] **Step 5: Commit**

```bash
git add server/rooms.js server/test/rooms.test.js
git commit -m "Add startingBankroll, bankroll and bets to room state"
```

---

### Task 3: Betting phase protocol (`server/server.js`)

**Files:**
- Modify: `server/server.js`
- Test: `server/test/server.test.js`

**Interfaces:**
- Consumes: `rooms.createRoom(startingBankroll)`, `room.bankroll`, `room.bets`, `room.startingBankroll` (Task 2).
- Produces (used by Task 4): `enterBetting(room)` — resets `bets`/`hands`/`turn` and sets `phase = 'betting'`. `buildStateView` now includes `startingBankroll`, `bankroll`, `bets`. `phase` can now be `'betting'` in addition to the existing values. Client→server `place_bet {amount}` and `create_room {startingBankroll?}`.

- [ ] **Step 1: Write the failing tests**

In `server/test/server.test.js`, add a helper right after the existing `trackState` helper:

```js
async function placeBetsAndWaitForPlaying(host, guest, box, amount = 50) {
  host.send(JSON.stringify({ type: 'place_bet', amount }));
  guest.send(JSON.stringify({ type: 'place_bet', amount }));
  await waitUntil(() => box.state.phase === 'playing');
}
```

Replace the body of the existing `'create_room then join_room deals a round to both players'` test with:

```js
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

    await waitUntil(() => box.state && box.state.phase === 'betting');
    await placeBetsAndWaitForPlaying(host, guest, box);

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
```

Replace the body of `'acting out of turn is rejected with an error'` with:

```js
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

    await waitUntil(() => box.state && box.state.phase === 'betting');
    await placeBetsAndWaitForPlaying(host, guest, box);
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
```

Replace the body of `'a full round of standing resolves to results with a tally'` with:

```js
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

    await waitUntil(() => box.state && box.state.phase === 'betting');
    await placeBetsAndWaitForPlaying(host, guest, box);

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
```

Replace the body of `'hitting until bust advances the turn'` with:

```js
test('hitting until bust advances the turn', async () => {
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

    await waitUntil(() => box.state && box.state.phase === 'betting');
    await placeBetsAndWaitForPlaying(host, guest, box);

    const actingSeat = box.state.turn;
    const actingClient = actingSeat === 'host' ? host : guest;

    let turnAdvanced = false;
    let previousHandLength = box.state.hands[actingSeat].length;

    for (let i = 0; i < 10 && !turnAdvanced; i++) {
      actingClient.send(JSON.stringify({ type: 'hit' }));
      await waitUntil(
        () =>
          box.state.hands[actingSeat].length > previousHandLength ||
          box.state.turn !== actingSeat ||
          box.state.phase !== 'playing'
      );
      if (box.state.turn !== actingSeat || box.state.phase !== 'playing') {
        turnAdvanced = true;
        break;
      }
      previousHandLength = box.state.hands[actingSeat].length;
    }

    assert.ok(
      turnAdvanced,
      'expected the turn to advance (or the round to move past "playing") after repeated hits'
    );

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});
```

Replace the body of `'both players readying up deals a fresh round'` (rename it too) with:

```js
test('both players readying up returns to betting, and new bets deal a fresh round', async () => {
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

    await waitUntil(() => box.state && box.state.phase === 'betting');

    async function placeBetsAndPlayToResults() {
      await placeBetsAndWaitForPlaying(host, guest, box);
      while (box.state.phase === 'playing') {
        const actingClient = box.state.turn === 'host' ? host : guest;
        const turnBeforeAction = box.state.turn;
        actingClient.send(JSON.stringify({ type: 'stand' }));
        await waitUntil(() => box.state.turn !== turnBeforeAction || box.state.phase !== 'playing');
      }
    }

    await placeBetsAndPlayToResults();
    assert.equal(box.state.phase, 'results');

    host.send(JSON.stringify({ type: 'ready' }));
    await waitUntil(() => box.state.readyForNext.host === true);

    guest.send(JSON.stringify({ type: 'ready' }));
    await waitUntil(() => box.state.phase === 'betting');

    assert.equal(box.state.readyForNext.host, false);
    assert.equal(box.state.readyForNext.guest, false);
    assert.deepEqual(box.state.bets, { host: null, guest: null });

    await placeBetsAndPlayToResults();

    assert.equal(box.state.phase, 'results');
    const hostTotal =
      box.state.tally.host.win + box.state.tally.host.lose + box.state.tally.host.push;
    assert.equal(hostTotal, 2);

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});
```

Add three new tests (place near the end of the file, before the garbage-collection test):

```js
test('create_room honors a custom startingBankroll, exposed once the room fills', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room', startingBankroll: 500 }));
    const { roomCode } = await created;

    const guest = await openClient(port);
    const box = trackState(host, guest);
    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode }));
    await joined;

    await waitUntil(() => box.state && box.state.phase === 'betting');
    assert.equal(box.state.startingBankroll, 500);
    assert.deepEqual(box.state.bankroll, { host: 500, guest: 500 });

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});

test('placing a bet deducts it from bankroll immediately (escrow)', async () => {
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
    await waitUntil(() => box.state && box.state.phase === 'betting');

    host.send(JSON.stringify({ type: 'place_bet', amount: 100 }));
    await waitUntil(() => box.state.bets.host === 100);
    assert.equal(box.state.bankroll.host, 900);
    assert.equal(box.state.phase, 'betting');

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});

test('place_bet is rejected outside betting phase, when already placed, or with an invalid amount', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const guest = await openClient(port);
    const box = trackState(host, guest);

    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const { roomCode } = await created;

    const tooEarly = nextMessage(host);
    host.send(JSON.stringify({ type: 'place_bet', amount: 10 }));
    const tooEarlyErr = await tooEarly;
    assert.equal(tooEarlyErr.message, 'not in betting phase');

    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode }));
    await joined;
    await waitUntil(() => box.state && box.state.phase === 'betting');

    const invalidAmount = nextMessage(host);
    host.send(JSON.stringify({ type: 'place_bet', amount: 0 }));
    const invalidErr = await invalidAmount;
    assert.equal(invalidErr.message, 'invalid bet amount');

    const tooMuch = nextMessage(host);
    host.send(JSON.stringify({ type: 'place_bet', amount: box.state.bankroll.host + 1 }));
    const tooMuchErr = await tooMuch;
    assert.equal(tooMuchErr.message, 'invalid bet amount');

    host.send(JSON.stringify({ type: 'place_bet', amount: 50 }));
    await waitUntil(() => box.state.bets.host === 50);

    const alreadyPlaced = nextMessage(host);
    host.send(JSON.stringify({ type: 'place_bet', amount: 50 }));
    const alreadyErr = await alreadyPlaced;
    assert.equal(alreadyErr.message, 'bet already placed');

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm blackjack-server npm test`
Expected: FAIL — rooms fill and stay in `phase: 'playing'` immediately after join (no `betting` phase yet), `place_bet` is an unknown message type.

- [ ] **Step 3: Implement the betting phase in `server/server.js`**

Update the import to pull in `computePayout` too (used in Task 4, but destructure it now to avoid touching this line twice):

```js
const { createShuffledDeck, isBust, isBlackjack, dealerShouldHit, resolveOutcome, computePayout } = require('./game');
```

Add `enterBetting` right before `startRound`:

```js
function enterBetting(room) {
  room.phase = 'betting';
  room.bets = { host: null, guest: null };
  room.hands = { host: [], guest: [], dealer: [] };
  room.turn = null;
}
```

Add `onPlaceBet` right after `onJoinRoom`:

```js
function onPlaceBet(room, seat, amount) {
  const ws = room.seats[seat].ws;
  if (room.phase !== 'betting') return sendError(ws, 'not in betting phase');
  if (room.bets[seat] !== null) return sendError(ws, 'bet already placed');
  if (!Number.isInteger(amount) || amount < 1 || amount > room.bankroll[seat]) {
    return sendError(ws, 'invalid bet amount');
  }
  room.bets[seat] = amount;
  room.bankroll[seat] -= amount;
  if (room.bets.host !== null && room.bets.guest !== null) {
    startRound(room);
  }
  broadcastState(room);
}
```

Change `onJoinRoom` to enter betting instead of dealing directly:

```js
  if (rooms.isRoomFull(room)) {
    enterBetting(room);
  }
  broadcastState(room);
```

(replacing the previous `startRound(room)` call)

Change `onReady` to return to betting instead of dealing directly:

```js
function onReady(room, seat) {
  if (room.phase !== 'results') return;
  room.readyForNext[seat] = true;
  if (room.readyForNext.host && room.readyForNext.guest) {
    enterBetting(room);
  }
  broadcastState(room);
}
```

Add `bankroll`, `bets`, and `startingBankroll` to `buildStateView`'s return object:

```js
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
    startingBankroll: room.startingBankroll,
    bankroll: room.bankroll,
    bets: room.bets,
    bothConnected: Boolean(
      room.seats.host && room.seats.host.connected && room.seats.guest && room.seats.guest.connected
    ),
  };
```

Change `onCreateRoom` to accept and forward `startingBankroll`:

```js
function onCreateRoom(ws, startingBankroll) {
  const room = rooms.createRoom(startingBankroll);
  const token = rooms.addSeat(room, 'host', ws);
  ws.roomCode = room.code;
  ws.seat = 'host';
  send(ws, { type: 'created', roomCode: room.code, playerToken: token });
  broadcastState(room);
}
```

In `handleMessage`, update the `create_room` case and add a `place_bet` case:

```js
    case 'create_room':
      return onCreateRoom(ws, msg.startingBankroll);
    case 'join_room':
      return onJoinRoom(ws, msg.roomCode);
    case 'rejoin_room':
      return onRejoinRoom(ws, msg.roomCode, msg.playerToken);
    case 'place_bet':
      return withRoomAndSeat(ws, (room, seat) => onPlaceBet(room, seat, msg.amount));
    case 'hit':
      return withRoomAndSeat(ws, onHit);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm blackjack-server npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add server/server.js server/test/server.test.js
git commit -m "Add betting phase: place_bet, escrow deduction, custom startingBankroll"
```

---

### Task 4: Payouts, game over, and reset (`server/server.js`)

**Files:**
- Modify: `server/server.js`
- Test: `server/test/server.test.js`

**Interfaces:**
- Consumes: `computePayout` (Task 1), `enterBetting`, `placeBetsAndWaitForPlaying` test helper (Task 3).
- Produces: `onResetGame(room)`. `phase` can now also be `'game_over'`. Client→server `reset_game` (valid in any phase).

- [ ] **Step 1: Write the failing tests**

Add to `server/test/server.test.js`, before the garbage-collection test:

```js
test('a bankroll hitting exactly 0 ends the game with phase game_over', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const guest = await openClient(port);
    const box = trackState(host, guest);

    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room', startingBankroll: 1 }));
    const { roomCode } = await created;

    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode }));
    await joined;
    await waitUntil(() => box.state && box.state.phase === 'betting');

    async function playOneRoundAllIn() {
      host.send(JSON.stringify({ type: 'place_bet', amount: box.state.bankroll.host }));
      guest.send(JSON.stringify({ type: 'place_bet', amount: box.state.bankroll.guest }));
      await waitUntil(() => box.state.phase !== 'betting');
      while (box.state.phase === 'playing') {
        const actingClient = box.state.turn === 'host' ? host : guest;
        const turnBeforeAction = box.state.turn;
        actingClient.send(JSON.stringify({ type: 'stand' }));
        await waitUntil(() => box.state.turn !== turnBeforeAction || box.state.phase !== 'playing');
      }
    }

    for (let round = 0; round < 100 && box.state.phase !== 'game_over'; round++) {
      await playOneRoundAllIn();
      if (box.state.phase === 'results') {
        host.send(JSON.stringify({ type: 'ready' }));
        guest.send(JSON.stringify({ type: 'ready' }));
        await waitUntil(() => box.state.phase === 'betting' || box.state.phase === 'game_over');
      }
    }

    assert.equal(box.state.phase, 'game_over');
    assert.ok(box.state.bankroll.host === 0 || box.state.bankroll.guest === 0);

    host.send(JSON.stringify({ type: 'reset_game' }));
    await waitUntil(() => box.state.phase === 'betting');
    assert.deepEqual(box.state.bankroll, { host: 1, guest: 1 });

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});

test('reset_game restores bankrolls and phase from mid-round without touching the tally', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const guest = await openClient(port);
    const box = trackState(host, guest);

    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room', startingBankroll: 300 }));
    const { roomCode } = await created;

    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode }));
    await joined;
    await waitUntil(() => box.state && box.state.phase === 'betting');

    await placeBetsAndWaitForPlaying(host, guest, box, 100);
    assert.equal(box.state.bankroll.host, 200);

    host.send(JSON.stringify({ type: 'reset_game' }));
    await waitUntil(() => box.state.phase === 'betting');

    assert.deepEqual(box.state.bankroll, { host: 300, guest: 300 });
    assert.deepEqual(box.state.bets, { host: null, guest: null });
    assert.equal(
      box.state.tally.host.win + box.state.tally.host.lose + box.state.tally.host.push,
      0
    );

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm blackjack-server npm test`
Expected: FAIL — bankroll never gets credited back after a round (`playDealerAndResolve` doesn't apply payouts yet), `reset_game` is an unknown message type.

- [ ] **Step 3: Apply payouts, check for game over, and implement reset**

Update `playDealerAndResolve` in `server/server.js`:

```js
function playDealerAndResolve(room) {
  room.phase = 'dealer';
  room.turn = null;
  while (dealerShouldHit(room.hands.dealer)) {
    room.hands.dealer.push(drawCard(room));
  }
  let someoneHitZero = false;
  for (const seat of TURN_ORDER) {
    const outcome = resolveOutcome(room.hands[seat], room.hands.dealer);
    room.results[seat] = outcome;
    room.tally[seat][outcome] += 1;
    const payout = computePayout(outcome, isBlackjack(room.hands[seat]), room.bets[seat]);
    room.bankroll[seat] += payout;
    if (room.bankroll[seat] === 0) someoneHitZero = true;
  }
  room.phase = someoneHitZero ? 'game_over' : 'results';
}
```

Add `onResetGame` after `onReady`:

```js
function onResetGame(room) {
  room.bankroll = { host: room.startingBankroll, guest: room.startingBankroll };
  room.bets = { host: null, guest: null };
  room.hands = { host: [], guest: [], dealer: [] };
  room.deck = [];
  room.stood = { host: false, guest: false };
  room.results = { host: null, guest: null };
  room.readyForNext = { host: false, guest: false };
  room.turn = null;
  room.phase = rooms.isRoomFull(room) ? 'betting' : 'waiting';
  broadcastState(room);
}
```

Add the `reset_game` case in `handleMessage`, after `ready`:

```js
    case 'ready':
      return withRoomAndSeat(ws, onReady);
    case 'reset_game':
      return withRoomAndSeat(ws, (room) => onResetGame(room));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm blackjack-server npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add server/server.js server/test/server.test.js
git commit -m "Apply payouts, add game_over phase and reset_game"
```

---

### Task 5: Client UI — bankroll, betting, game over, reset

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `state.startingBankroll`, `state.bankroll`, `state.bets`, and `state.phase === 'betting' | 'game_over'` (Tasks 3 & 4). Sends `{ type: 'create_room', startingBankroll }`, `{ type: 'place_bet', amount }`, `{ type: 'reset_game' }`.
- Produces: nothing consumed by later tasks — this is the last code task.

There's no test runner for the client (matches the rest of this project — plain HTML/CSS/JS, no build step, no client test suite). Verification for this task is a manual pass in Task 6.

- [ ] **Step 1: Add the lobby "Starting chips" input**

In `index.html`, change the create-room section:

```html
    <section>
      <label for="starting-bankroll-input">Starting chips</label>
      <input
        id="starting-bankroll-input"
        type="number"
        min="10"
        max="1000000"
        step="1"
        placeholder="1000"
      />
      <button id="create-room-button">Create Room</button>
    </section>
```

- [ ] **Step 2: Add the reset button, betting-phase view, and game-over screen to the table screen**

In `index.html`, change the table screen's opening markup:

```html
  <main id="table-screen" hidden>
    <p id="room-code-display"></p>
    <button id="reset-game-button" hidden>Reset Game</button>
    <p id="connection-status"></p>

    <section id="game-over-screen" hidden>
      <h2 id="game-over-title"></h2>
      <p id="game-over-bankrolls"></p>
      <button id="new-game-button">New Game</button>
    </section>

    <section id="betting-phase" hidden>
      <h2>Place your bet</h2>
      <p id="betting-bankroll-display"></p>
      <input id="bet-amount-input" type="number" min="1" step="1" />
      <button id="place-bet-button">Place Bet</button>
      <p id="betting-status"></p>
    </section>

    <section class="hand" id="dealer-hand">
      <h2>Dealer</h2>
      <div class="cards" id="dealer-cards"></div>
      <p id="dealer-value"></p>
    </section>

    <section class="hand" id="opponent-hand">
      <h2>Opponent <span class="bankroll-badge" id="opponent-bankroll"></span></h2>
      <div class="cards" id="opponent-cards"></div>
      <p id="opponent-value"></p>
    </section>

    <section class="hand" id="your-hand">
      <h2>You <span class="bankroll-badge" id="your-bankroll"></span></h2>
      <div class="cards" id="your-cards"></div>
      <p id="your-value"></p>
    </section>
```

(the `controls`, `round-result`, and `leaderboard` sections below stay unchanged)

- [ ] **Step 3: Wire up the new DOM references in `app.js`**

Add these `const` declarations after the existing DOM lookups (right after `const roomCodeInput = ...` and before the hand-section lookups is fine — group them near the existing ones):

```js
const startingBankrollInput = document.getElementById('starting-bankroll-input');
const resetGameButton = document.getElementById('reset-game-button');
const dealerHandSection = document.getElementById('dealer-hand');
const controlsSection = document.getElementById('controls');
const yourBankrollEl = document.getElementById('your-bankroll');
const opponentBankrollEl = document.getElementById('opponent-bankroll');
const bettingPhaseSection = document.getElementById('betting-phase');
const bettingBankrollDisplay = document.getElementById('betting-bankroll-display');
const betAmountInput = document.getElementById('bet-amount-input');
const placeBetButton = document.getElementById('place-bet-button');
const bettingStatus = document.getElementById('betting-status');
const gameOverScreen = document.getElementById('game-over-screen');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverBankrolls = document.getElementById('game-over-bankrolls');
const newGameButton = document.getElementById('new-game-button');
```

- [ ] **Step 4: Send `startingBankroll` on create, and add the new button handlers**

Replace the `createRoomButton` click handler:

```js
createRoomButton.addEventListener('click', async () => {
  currentRoomCode = null;
  currentPlayerToken = null;
  hasJoinedRoom = false;
  const raw = startingBankrollInput.value.trim();
  const startingBankroll = raw === '' ? undefined : parseInt(raw, 10);
  pendingIntent = { type: 'create_room', startingBankroll };
  await connect();
});
```

Add near the other button handlers (after `readyButton`'s handler):

```js
placeBetButton.addEventListener('click', () => {
  const amount = parseInt(betAmountInput.value, 10);
  socket.send(JSON.stringify({ type: 'place_bet', amount }));
});

newGameButton.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'reset_game' }));
});

resetGameButton.addEventListener('click', () => {
  const confirmed = window.confirm(
    "Reset the game? This restores both players' chip counts and cannot be undone."
  );
  if (confirmed) {
    socket.send(JSON.stringify({ type: 'reset_game' }));
  }
});
```

- [ ] **Step 5: Add bankroll, betting, and game-over rendering to `app.js`**

Add these functions near `updateLeaderboard`:

```js
function updateBankrollBadges(state) {
  const opponentSeat = state.you === 'host' ? 'guest' : 'host';
  if (state.phase === 'waiting') {
    yourBankrollEl.textContent = '';
    opponentBankrollEl.textContent = '';
    return;
  }
  yourBankrollEl.textContent = `🪙 ${state.bankroll[state.you]}`;
  opponentBankrollEl.textContent = `🪙 ${state.bankroll[opponentSeat]}`;
}

function renderBettingPhase(state) {
  const opponentSeat = state.you === 'host' ? 'guest' : 'host';
  const yourBet = state.bets[state.you];
  const opponentBet = state.bets[opponentSeat];
  bettingBankrollDisplay.textContent = `Your chips: ${state.bankroll[state.you]}`;
  if (yourBet === null) {
    betAmountInput.disabled = false;
    betAmountInput.max = String(state.bankroll[state.you]);
    placeBetButton.disabled = false;
    bettingStatus.textContent = '';
  } else {
    betAmountInput.disabled = true;
    placeBetButton.disabled = true;
    bettingStatus.textContent = opponentBet === null ? "Waiting for opponent's bet..." : '';
  }
}

function renderGameOver(state) {
  const opponentSeat = state.you === 'host' ? 'guest' : 'host';
  const youZero = state.bankroll[state.you] === 0;
  const oppZero = state.bankroll[opponentSeat] === 0;
  gameOverTitle.textContent = youZero && oppZero
    ? 'You both ran out of chips!'
    : youZero
    ? "Game Over — you're out of chips."
    : 'You win the game!';
  gameOverBankrolls.textContent =
    `Final chips — You: ${state.bankroll[state.you]}, Opponent: ${state.bankroll[opponentSeat]}`;
}
```

(`🪙` is the poker-chip emoji, `—` is an em dash — written as escapes here so the plan file stays plain ASCII; type the literal characters in the actual source file instead of the escapes.)

- [ ] **Step 6: Hook the new rendering into `renderState`**

In `renderState`, right after `updateLeaderboard(state.tally[state.you], state.tally[opponentSeat]);`, add:

```js
  updateBankrollBadges(state);

  resetGameButton.hidden = state.phase === 'waiting';

  const isBettingPhase = state.phase === 'betting';
  bettingPhaseSection.hidden = !isBettingPhase;
  dealerHandSection.hidden = isBettingPhase;
  opponentHandSection.hidden = isBettingPhase;
  yourHandSection.hidden = isBettingPhase;
  controlsSection.hidden = isBettingPhase;
  if (isBettingPhase) renderBettingPhase(state);

  const isGameOver = state.phase === 'game_over';
  gameOverScreen.hidden = !isGameOver;
  if (isGameOver) renderGameOver(state);
```

Then replace the existing `if (state.phase === 'results') { ... } else { ... }` block (the one that sets `roundResultEl` and `readyButton`) with:

```js
  if (state.phase === 'results' || state.phase === 'game_over') {
    const result = state.results[state.you];
    roundResultEl.textContent =
      result === 'win' ? 'You win!' : result === 'lose' ? 'You lose.' : 'Push.';
    roundResultEl.className = '';
    void roundResultEl.offsetWidth;
    roundResultEl.className = `${result} pop`;
  } else {
    roundResultEl.textContent = '';
    roundResultEl.className = '';
  }

  readyButton.hidden = state.phase !== 'results';
  if (state.phase === 'results') {
    readyButton.disabled = state.readyForNext[state.you];
    readyButton.textContent = state.readyForNext[state.you]
      ? 'Waiting for opponent...'
      : 'Play Again';
  }
```

- [ ] **Step 7: Style the new elements**

Append to `style.css`:

```css
#starting-bankroll-input,
#bet-amount-input {
  font-family: 'Segoe UI', Roboto, sans-serif;
  text-align: center;
  width: 100px;
  padding: 0.6rem 0.5rem;
  border-radius: 8px;
  border: 2px solid var(--gold);
  background: rgba(0, 0, 0, 0.25);
  color: var(--cream);
  font-size: 1rem;
  margin-right: 0.5rem;
  box-sizing: border-box;
}

#starting-bankroll-input::placeholder {
  color: rgba(245, 239, 224, 0.5);
}

.bankroll-badge {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: rgba(212, 175, 55, 0.18);
  border: 1px solid rgba(212, 175, 55, 0.5);
  color: var(--gold-light);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  vertical-align: middle;
}

#reset-game-button {
  font-size: 0.8rem;
  padding: 0.4rem 1rem;
  margin: 0.3rem 0 0.5rem;
  background: linear-gradient(180deg, #d9d9d9, #a8a8a8);
  color: #2b2b2b;
  box-shadow: 0 2px 0 #7a7a7a, 0 3px 8px rgba(0, 0, 0, 0.35);
}

#betting-phase {
  background: rgba(0, 0, 0, 0.18);
  border: 2px solid rgba(212, 175, 55, 0.35);
  border-radius: 16px;
  padding: 1.25rem 1rem;
  margin-bottom: 1rem;
}

#betting-phase h2 {
  font-family: 'Cinzel', serif;
  font-size: 1.1rem;
  letter-spacing: 0.1em;
  color: var(--gold-light);
  margin: 0 0 0.75rem;
}

#betting-bankroll-display {
  color: var(--cream);
  font-weight: 600;
  margin: 0 0 0.75rem;
}

#betting-status {
  color: rgba(245, 239, 224, 0.85);
  min-height: 1.2em;
  font-size: 0.9rem;
  margin-top: 0.5rem;
}

#game-over-screen {
  background: rgba(0, 0, 0, 0.25);
  border: 2px solid var(--gold);
  border-radius: 16px;
  padding: 1.5rem 1rem;
  margin-bottom: 1rem;
}

#game-over-screen h2 {
  font-family: 'Cinzel', serif;
  font-size: 1.3rem;
  letter-spacing: 0.08em;
  color: var(--gold-light);
  margin: 0 0 0.75rem;
}

#game-over-bankrolls {
  color: var(--cream);
  font-weight: 600;
  margin: 0 0 1rem;
}
```

- [ ] **Step 8: Commit**

```bash
git add index.html app.js style.css
git commit -m "Add client UI for betting, bankroll, game over, and reset"
```

---

### Task 6: Manual verification and docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the full feature from Tasks 1-5.
- Produces: nothing — this is the last task.

- [ ] **Step 1: Run the full server test suite one more time**

Run: `docker compose run --rm blackjack-server npm test`
Expected: PASS (every test in `game.test.js`, `rooms.test.js`, `server.test.js`)

- [ ] **Step 2: Manually verify the client in a browser**

Start the server: `docker compose up --build -d`. Open `index.html` in two browser tabs (or use whatever browser automation this environment has — e.g. the `run` skill — to drive it and take screenshots). Walk through:

1. In tab 1, set "Starting chips" to `50` and click "Create Room". Confirm the room code appears and a "Reset Game" button is visible.
2. In tab 2, join with that room code. Confirm both tabs move to a "Place your bet" view showing 50 chips each, with Hit/Stand/dealer/hand sections hidden.
3. Place a bet in tab 1 only — confirm tab 1's input/button disable and show "Waiting for opponent's bet...", while tab 2's input stays active.
4. Place a bet in tab 2 — confirm both tabs transition automatically to the normal dealt-hands view, with bankroll badges on the "You"/"Opponent" headers reflecting the post-bet balances.
5. Play the round to results (Hit/Stand). Confirm the round result banner and bankroll badges reflect the payout (win/lose/push).
6. Click "Play Again" in both tabs. Confirm it returns to the betting view (not straight to a new deal) and a new bet is required.
7. Repeat betting your whole stack until one side hits exactly 0 chips. Confirm the Game Over screen appears with the correct message ("You win the game!" / "Game Over — you're out of chips." / "You both ran out of chips!" depending on who hit 0) and correct final chip counts.
8. Click "New Game". Confirm both bankrolls reset to the starting amount and the view returns to betting.
9. Click "Reset Game" mid-round in a fresh room and confirm the native browser confirm dialog appears; cancel it and confirm nothing changes; confirm it again and confirm bankrolls/phase reset.

Stop the server: `docker compose down`.

- [ ] **Step 3: Update the README**

In `README.md`, replace the intro paragraph:

```markdown
A two-player blackjack game you play in the browser with a friend, each
against an automated dealer that plays by standard rules (hits below 17,
stands on soft 17). No accounts — just Hit, Stand, chip betting with a
configurable starting bankroll, and a running win/lose/push tally for the
session.
```

Replace the `## Rules (v1)` section:

```markdown
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
```

Replace the `## Design & implementation docs` section:

```markdown
## Design & implementation docs

- `docs/superpowers/specs/2026-08-29-multiplayer-blackjack-design.md`
- `docs/superpowers/plans/2026-08-29-multiplayer-blackjack.md`
- `docs/superpowers/specs/2026-08-30-betting-bankroll-design.md`
- `docs/superpowers/plans/2026-08-30-betting-bankroll.md`
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document betting and bankroll in the README"
```
