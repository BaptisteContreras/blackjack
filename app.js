'use strict';

const isLocalDev =
  location.protocol === 'file:' ||
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1';
const SERVER_URL = isLocalDev
  ? 'ws://localhost:8080'
  : 'wss://blackjack-v2v3.onrender.com';

const lobbyScreen = document.getElementById('lobby-screen');
const tableScreen = document.getElementById('table-screen');
const lobbyStatus = document.getElementById('lobby-status');
const createRoomButton = document.getElementById('create-room-button');
const joinRoomButton = document.getElementById('join-room-button');
const roomCodeInput = document.getElementById('room-code-input');
const roomCodeDisplay = document.getElementById('room-code-display');
const connectionStatus = document.getElementById('connection-status');

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

const dealerCardsEl = document.getElementById('dealer-cards');
const dealerValueEl = document.getElementById('dealer-value');
const opponentHandSection = document.getElementById('opponent-hand');
const opponentCardsEl = document.getElementById('opponent-cards');
const opponentValueEl = document.getElementById('opponent-value');
const yourHandSection = document.getElementById('your-hand');
const yourCardsEl = document.getElementById('your-cards');
const yourValueEl = document.getElementById('your-value');
const hitButton = document.getElementById('hit-button');
const standButton = document.getElementById('stand-button');
const readyButton = document.getElementById('ready-button');
const roundResultEl = document.getElementById('round-result');
const leaderboardYouRow = document.getElementById('leaderboard-you');
const leaderboardYouScoreEl = document.getElementById('leaderboard-you-score');
const leaderboardOpponentRow = document.getElementById('leaderboard-opponent');
const leaderboardOpponentScoreEl = document.getElementById('leaderboard-opponent-score');

let socket = null;
let currentRoomCode = null;
let currentPlayerToken = null;
let pendingIntent = null;
// True only once the server has confirmed we are actually seated in a room
// (via 'created'/'joined', or a 'state' broadcast after a successful rejoin).
// While false, an 'error' means our join/rejoin attempt failed, not that an
// in-game action was invalid.
let hasJoinedRoom = false;

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
  hasJoinedRoom = false;
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
    hasJoinedRoom = true;
    showTableScreen();
    roomCodeDisplay.textContent = `Room code: ${currentRoomCode}`;
    lobbyStatus.textContent = '';
    saveSession();
  } else if (msg.type === 'joined') {
    currentPlayerToken = msg.playerToken;
    hasJoinedRoom = true;
    showTableScreen();
    roomCodeDisplay.textContent = `Room code: ${currentRoomCode}`;
    lobbyStatus.textContent = '';
    saveSession();
  } else if (msg.type === 'error') {
    if (!hasJoinedRoom) {
      // We were attempting to create/join/rejoin a room and it failed (room
      // not found, invalid token, server restarted, etc.) - the stored
      // session is no longer valid, so drop it and send the user back to a
      // working lobby instead of leaving them stuck on a blank table.
      try {
        localStorage.removeItem('blackjackSession');
      } catch {
        // ignore storage errors
      }
      currentRoomCode = null;
      currentPlayerToken = null;
      tableScreen.hidden = true;
      lobbyScreen.hidden = false;
      lobbyStatus.textContent = msg.message;
    } else if (tableScreen.hidden) {
      lobbyStatus.textContent = msg.message;
    } else {
      connectionStatus.textContent = msg.message;
      setTimeout(() => {
        connectionStatus.textContent = '';
      }, 2000);
    }
  } else if (msg.type === 'state') {
    hasJoinedRoom = true;
    renderState(msg);
  }
}

function saveSession() {
  try {
    localStorage.setItem(
      'blackjackSession',
      JSON.stringify({ roomCode: currentRoomCode, playerToken: currentPlayerToken })
    );
  } catch {
    // localStorage unavailable (private browsing, file://, etc.) - degrade
    // gracefully by simply not persisting the session for auto-rejoin.
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem('blackjackSession');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function showTableScreen() {
  lobbyScreen.hidden = true;
  tableScreen.hidden = false;
}

createRoomButton.addEventListener('click', async () => {
  currentRoomCode = null;
  currentPlayerToken = null;
  hasJoinedRoom = false;
  const raw = startingBankrollInput.value.trim();
  const startingBankroll = raw === '' ? undefined : parseInt(raw, 10);
  pendingIntent = { type: 'create_room', startingBankroll };
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
  hasJoinedRoom = false;
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

const CARD_SUIT_LETTERS = { '♥': 'H', '♦': 'D', '♣': 'C', '♠': 'S' };
const CARD_SUIT_NAMES = { '♥': 'Hearts', '♦': 'Diamonds', '♣': 'Clubs', '♠': 'Spades' };

function renderCard(card) {
  const img = document.createElement('img');
  img.className = 'card';
  if (card.hidden) {
    img.src = 'cards/back.png';
    img.alt = 'Face-down card';
    return img;
  }
  img.src = `cards/${card.rank}${CARD_SUIT_LETTERS[card.suit]}.png`;
  img.alt = `${card.rank} of ${CARD_SUIT_NAMES[card.suit]}`;
  return img;
}

function renderHand(container, cards) {
  // Only the cards added since the last render should play the "dealt in"
  // animation - otherwise every hit/stand broadcast would re-animate the
  // whole hand. A shorter hand than last time means a new round started,
  // so its initial cards count as freshly dealt too.
  const previousCount = Number(container.dataset.prevCount || 0);
  const isFreshHand = cards.length < previousCount;
  const animateFromIndex = isFreshHand ? 0 : previousCount;

  container.innerHTML = '';
  cards.forEach((card, index) => {
    const cardEl = renderCard(card);
    if (index >= animateFromIndex) {
      cardEl.classList.add('card-deal');
    }
    container.appendChild(cardEl);
  });
  container.dataset.prevCount = String(cards.length);
}

function valueTextFor(cards, phase) {
  if (phase === 'waiting' && cards.length === 0) return '';
  return `Value: ${computeDisplayValue(cards)}`;
}

function updateLeaderboard(yourTally, opponentTally) {
  leaderboardYouScoreEl.textContent = `${yourTally.win}W - ${yourTally.lose}L - ${yourTally.push}P`;
  leaderboardOpponentScoreEl.textContent = `${opponentTally.win}W - ${opponentTally.lose}L - ${opponentTally.push}P`;
  leaderboardYouRow.classList.toggle('leader', yourTally.win > opponentTally.win);
  leaderboardOpponentRow.classList.toggle('leader', opponentTally.win > yourTally.win);
}

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

function renderState(state) {
  const opponentSeat = state.you === 'host' ? 'guest' : 'host';

  renderHand(yourCardsEl, state.hands[state.you]);
  yourValueEl.textContent = valueTextFor(state.hands[state.you], state.phase);

  renderHand(opponentCardsEl, state.hands[opponentSeat]);
  opponentValueEl.textContent = valueTextFor(state.hands[opponentSeat], state.phase);

  renderHand(dealerCardsEl, state.hands.dealer);
  dealerValueEl.textContent =
    state.phase === 'playing' ? '' : valueTextFor(state.hands.dealer, state.phase);

  const yourTurn = state.phase === 'playing' && state.turn === state.you;
  const opponentTurn = state.phase === 'playing' && state.turn === opponentSeat;
  hitButton.disabled = !yourTurn;
  standButton.disabled = !yourTurn;
  yourHandSection.classList.toggle('active-turn', yourTurn);
  opponentHandSection.classList.toggle('active-turn', opponentTurn);

  updateLeaderboard(state.tally[state.you], state.tally[opponentSeat]);

  updateBankrollBadges(state);

  resetGameButton.hidden = false;

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

  if (state.bothConnected) {
    connectionStatus.textContent = '';
  } else if (state.phase === 'waiting') {
    connectionStatus.textContent = 'Waiting for your friend to join...';
  } else {
    connectionStatus.textContent = 'Waiting for opponent to reconnect...';
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

(function autoRejoin() {
  const session = loadSession();
  if (session) {
    currentRoomCode = session.roomCode;
    currentPlayerToken = session.playerToken;
    hasJoinedRoom = false;
    pendingIntent = {
      type: 'rejoin_room',
      roomCode: session.roomCode,
      playerToken: session.playerToken,
    };
    showTableScreen();
    connect();
  }
})();
