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
const leaveRoomButton = document.getElementById('leave-room-button');
const dealerHandSection = document.getElementById('dealer-hand');
const controlsSection = document.getElementById('controls');
const yourBankrollEl = document.getElementById('your-bankroll');
const opponentBankrollEl = document.getElementById('opponent-bankroll');
const bettingPhaseSection = document.getElementById('betting-phase');
const bettingBankrollDisplay = document.getElementById('betting-bankroll-display');
const chipRowEl = document.getElementById('chip-row');
const betStackEl = document.getElementById('bet-stack');
const betTotalAmountEl = document.getElementById('bet-total-amount');
const bettingActionsEl = document.getElementById('betting-actions');
const clearBetButton = document.getElementById('clear-bet-button');
const allInButton = document.getElementById('all-in-button');
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

// Chip-based betting state, entirely client-local until "Place Bet" is
// clicked - the server only ever sees the final summed amount.
let stackedChips = []; // chip values staged for this bet, in click order
let betIsAllIn = false;
let bettingRoundBankroll = 0; // bankroll snapshot the current chip row/stack was built for
let bettingDenominations = []; // chip values available this betting round
let wasInBettingPhase = false; // true only while yourBet is null during 'betting'

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

function returnToLobby(message) {
  try {
    localStorage.removeItem('blackjackSession');
  } catch {
    // ignore storage errors
  }
  currentRoomCode = null;
  currentPlayerToken = null;
  tableScreen.hidden = true;
  lobbyScreen.hidden = false;
  lobbyStatus.textContent = message;
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
      returnToLobby(msg.message);
    } else if (tableScreen.hidden) {
      lobbyStatus.textContent = msg.message;
    } else {
      connectionStatus.textContent = msg.message;
      setTimeout(() => {
        connectionStatus.textContent = '';
      }, 2000);
    }
  } else if (msg.type === 'opponent_left') {
    returnToLobby('Your opponent left the game.');
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

const CHIP_FRACTIONS = [0.01, 0.05, 0.1, 0.25, 0.5];
const CHIP_TIER_COUNT = 5;

// Rounds to a "nice" number (1/2/5/10/20/50/100/...) so chip denominations
// never land on an ugly value like 137, regardless of bankroll size.
function niceChipRound(x) {
  if (x <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(x));
  const normalized = x / magnitude;
  let nice;
  if (normalized < 1.5) nice = 1;
  else if (normalized < 3.5) nice = 2;
  else if (normalized < 7.5) nice = 5;
  else nice = 10;
  return Math.round(nice * magnitude);
}

// Denominations scale to the player's current bankroll (roughly 1/5/10/25/50%,
// each rounded to a nice number) so betting takes a reasonable number of
// clicks whether the bankroll is 10 chips or 1,000,000.
function computeChipDenominations(bankroll) {
  const values = [];
  for (const fraction of CHIP_FRACTIONS) {
    const rounded = Math.min(bankroll, niceChipRound(bankroll * fraction));
    if (rounded >= 1 && !values.includes(rounded)) {
      values.push(rounded);
    }
  }
  if (values.length === 0) {
    values.push(Math.min(1, bankroll));
  }
  return values;
}

function formatChipValue(value) {
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
  }
  return String(value);
}

function buildChipVisual(tagName, label, tierIndex) {
  const chip = document.createElement(tagName);
  chip.className = `chip chip-tier-${tierIndex}`;
  const valueEl = document.createElement('span');
  valueEl.className = 'chip-value';
  valueEl.textContent = label;
  chip.appendChild(valueEl);
  return chip;
}

function stagedBetTotal() {
  return stackedChips.reduce((sum, value) => sum + value, 0);
}

function renderChipRow() {
  chipRowEl.innerHTML = '';
  const remaining = bettingRoundBankroll - stagedBetTotal();
  bettingDenominations.forEach((value, index) => {
    const chip = buildChipVisual('button', formatChipValue(value), index % CHIP_TIER_COUNT);
    chip.type = 'button';
    chip.disabled = value > remaining;
    chip.setAttribute('aria-label', `Add a ${value}-chip to your bet`);
    chip.addEventListener('click', () => {
      stackedChips.push(value);
      betIsAllIn = false;
      refreshBettingUI();
    });
    chipRowEl.appendChild(chip);
  });
}

function renderBetStack() {
  if (betIsAllIn) {
    betStackEl.innerHTML = '';
    const chip = buildChipVisual('div', 'ALL IN', CHIP_TIER_COUNT);
    chip.classList.add('chip-allin', 'chip-toss');
    betStackEl.appendChild(chip);
    betStackEl.dataset.prevCount = '1';
    return;
  }
  // Only newly-added chips play the toss-in animation, same idea as
  // renderHand's "only animate the cards dealt since last render".
  const previousCount = Number(betStackEl.dataset.prevCount || 0);
  const isFreshStack = stackedChips.length < previousCount;
  const animateFromIndex = isFreshStack ? 0 : previousCount;

  betStackEl.innerHTML = '';
  stackedChips.forEach((value, index) => {
    const chip = buildChipVisual('div', formatChipValue(value), index % CHIP_TIER_COUNT);
    chip.classList.add('chip-in-stack');
    if (index >= animateFromIndex) chip.classList.add('chip-toss');
    betStackEl.appendChild(chip);
  });
  betStackEl.dataset.prevCount = String(stackedChips.length);
}

function updateBettingControls() {
  const total = stagedBetTotal();
  betTotalAmountEl.textContent = String(total);
  placeBetButton.disabled = total <= 0 || total > bettingRoundBankroll;
  clearBetButton.disabled = total <= 0;
}

function refreshBettingUI() {
  renderChipRow();
  renderBetStack();
  updateBettingControls();
}

function renderBettingPhase(state) {
  const opponentSeat = state.you === 'host' ? 'guest' : 'host';
  const yourBet = state.bets[state.you];
  const opponentBet = state.bets[opponentSeat];
  const bankroll = state.bankroll[state.you];
  bettingBankrollDisplay.textContent = `Your chips: ${bankroll}`;

  if (yourBet === null) {
    // Recompute denominations and clear the stack only on a genuinely fresh
    // betting round - not on every broadcast while still deciding (e.g. the
    // opponent placing their bet re-broadcasts state to us too).
    if (!wasInBettingPhase || bankroll !== bettingRoundBankroll) {
      bettingRoundBankroll = bankroll;
      bettingDenominations = computeChipDenominations(bankroll);
      stackedChips = [];
      betIsAllIn = false;
      betStackEl.dataset.prevCount = '0';
    }
    wasInBettingPhase = true;
    chipRowEl.hidden = false;
    betStackEl.hidden = false;
    bettingActionsEl.hidden = false;
    refreshBettingUI();
    bettingStatus.textContent = '';
  } else {
    wasInBettingPhase = false;
    chipRowEl.hidden = true;
    betStackEl.hidden = true;
    bettingActionsEl.hidden = true;
    bettingStatus.textContent =
      opponentBet === null
        ? `You bet ${yourBet}. Waiting for opponent's bet...`
        : `You bet ${yourBet}.`;
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
  leaveRoomButton.hidden = false;

  const isBettingPhase = state.phase === 'betting';
  if (!isBettingPhase) {
    wasInBettingPhase = false;
  }
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

clearBetButton.addEventListener('click', () => {
  stackedChips = [];
  betIsAllIn = false;
  betStackEl.dataset.prevCount = '0';
  refreshBettingUI();
});

allInButton.addEventListener('click', () => {
  if (bettingRoundBankroll <= 0) return;
  stackedChips = [bettingRoundBankroll];
  betIsAllIn = true;
  refreshBettingUI();
});

placeBetButton.addEventListener('click', () => {
  const amount = stagedBetTotal();
  // bettingRoundBankroll is kept in sync with the current bankroll by
  // renderBettingPhase, so it's a reliable ceiling here.
  if (amount <= 0 || amount > bettingRoundBankroll) return;
  socket.send(JSON.stringify({ type: 'place_bet', amount }));
});

newGameButton.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'reset_game' }));
});

leaveRoomButton.addEventListener('click', () => {
  const confirmed = window.confirm('Leave this room? This ends the game for both players.');
  if (!confirmed) return;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'leave_room' }));
  }
  returnToLobby('');
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
