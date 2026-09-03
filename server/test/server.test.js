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

async function placeBetsAndWaitForPlaying(host, guest, box, amount = 50) {
  // Track host's and guest's own copies of the broadcast in addition to the
  // caller's shared box. box.state can flip to 'playing' off whichever
  // socket's copy of the broadcast arrives first; a caller that immediately
  // does nextMessage(host) or nextMessage(guest) right after this resolves
  // would otherwise race that socket's own still-in-flight copy of the same
  // 'playing' broadcast. Waiting for all three confirms both sockets have
  // already fully processed their own copy before we return.
  const hostBox = trackState(host);
  const guestBox = trackState(guest);
  host.send(JSON.stringify({ type: 'place_bet', amount }));
  guest.send(JSON.stringify({ type: 'place_bet', amount }));
  await waitUntil(
    () =>
      box.state.phase === 'playing' &&
      hostBox.state &&
      hostBox.state.phase === 'playing' &&
      guestBox.state &&
      guestBox.state.phase === 'playing'
  );
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
    const box = trackState(host);

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
    // rooms.js clamps startingBankroll up to MIN_STARTING_BANKROLL (10), so the
    // requested value of 1 above is not what actually lands in room state;
    // read back the room's real starting bankroll instead of assuming it's 1.
    const actualStartingBankroll = box.state.startingBankroll;

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
    assert.deepEqual(box.state.bankroll, {
      host: actualStartingBankroll,
      guest: actualStartingBankroll,
    });

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

test('leave_room notifies the opponent and removes the room', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const guest = await openClient(port);

    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const { roomCode } = await created;

    const joined = nextMessage(guest);
    guest.send(JSON.stringify({ type: 'join_room', roomCode }));
    await joined;

    const opponentLeft = nextMessage(guest);
    host.send(JSON.stringify({ type: 'leave_room' }));
    const opponentLeftMsg = await opponentLeft;
    assert.equal(opponentLeftMsg.type, 'opponent_left');

    await waitUntil(() => rooms.getRoom(roomCode) === undefined);

    host.close();
    guest.close();
  } finally {
    server.close();
  }
});

test('leave_room while alone in the room just removes it, with no opponent to notify', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const { roomCode } = await created;

    assert.ok(rooms.getRoom(roomCode));
    host.send(JSON.stringify({ type: 'leave_room' }));
    await waitUntil(() => rooms.getRoom(roomCode) === undefined);

    host.close();
  } finally {
    server.close();
  }
});

test('leaving a room and rejoining with the old token afterward fails with room not found', async () => {
  const { server, port } = await startTestServer();
  try {
    const host = await openClient(port);
    const created = nextMessage(host);
    host.send(JSON.stringify({ type: 'create_room' }));
    const { roomCode, playerToken } = await created;

    host.send(JSON.stringify({ type: 'leave_room' }));
    await waitUntil(() => rooms.getRoom(roomCode) === undefined);

    const rejoined = await openClient(port);
    const errorMsg = nextMessage(rejoined);
    rejoined.send(JSON.stringify({ type: 'rejoin_room', roomCode, playerToken }));
    const err = await errorMsg;
    assert.equal(err.type, 'error');
    assert.equal(err.message, 'room not found');

    host.close();
    rejoined.close();
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
