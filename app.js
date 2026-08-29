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
