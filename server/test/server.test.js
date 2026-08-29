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
