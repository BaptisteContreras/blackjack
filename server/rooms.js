'use strict';

const rooms = new Map();
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;
const ROOM_GC_DELAY_MS = 10 * 60 * 1000;
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
