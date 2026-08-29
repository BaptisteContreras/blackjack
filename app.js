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
