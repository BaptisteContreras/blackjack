'use strict';

const { WebSocketServer } = require('ws');
const rooms = require('./rooms');
const { createShuffledDeck, isBust, isBlackjack, dealerShouldHit, resolveOutcome, computePayout } = require('./game');

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

function enterBetting(room) {
  room.phase = 'betting';
  room.bets = { host: null, guest: null };
  room.hands = { host: [], guest: [], dealer: [] };
  room.turn = null;
  room.readyForNext = { host: false, guest: false };
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
    startingBankroll: room.startingBankroll,
    bankroll: room.bankroll,
    bets: room.bets,
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

function onCreateRoom(ws, startingBankroll) {
  const room = rooms.createRoom(startingBankroll);
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
    enterBetting(room);
  }
  broadcastState(room);
}

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
    enterBetting(room);
  }
  broadcastState(room);
}

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

function handleMessage(ws, msg) {
  if (!msg || typeof msg !== 'object') {
    return sendError(ws, 'invalid message');
  }
  switch (msg.type) {
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
    case 'stand':
      return withRoomAndSeat(ws, onStand);
    case 'ready':
      return withRoomAndSeat(ws, onReady);
    case 'reset_game':
      return withRoomAndSeat(ws, (room) => onResetGame(room));
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
    ws.on('error', () => {});
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
