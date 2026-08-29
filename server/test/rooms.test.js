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
