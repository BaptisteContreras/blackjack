'use strict';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createShuffledDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

function handValue(cards) {
  let total = cards.reduce((sum, card) => sum + cardValue(card.rank), 0);
  let aceCount = cards.filter((card) => card.rank === 'A').length;
  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount -= 1;
  }
  return total;
}

function isBust(cards) {
  return handValue(cards) > 21;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

function dealerShouldHit(cards) {
  return handValue(cards) < 17;
}

function resolveOutcome(playerCards, dealerCards) {
  if (isBust(playerCards)) return 'lose';

  const playerHasBlackjack = isBlackjack(playerCards);
  const dealerHasBlackjack = isBlackjack(dealerCards);
  if (playerHasBlackjack && dealerHasBlackjack) return 'push';
  if (playerHasBlackjack) return 'win';
  if (dealerHasBlackjack) return 'lose';
  if (isBust(dealerCards)) return 'win';

  const playerValue = handValue(playerCards);
  const dealerValue = handValue(dealerCards);
  if (playerValue > dealerValue) return 'win';
  if (playerValue < dealerValue) return 'lose';
  return 'push';
}

module.exports = {
  createShuffledDeck,
  handValue,
  isBust,
  isBlackjack,
  dealerShouldHit,
  resolveOutcome,
};
