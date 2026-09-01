'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createShuffledDeck,
  handValue,
  isBust,
  isBlackjack,
  dealerShouldHit,
  resolveOutcome,
  computePayout,
} = require('../game');

test('createShuffledDeck returns 52 unique cards', () => {
  const deck = createShuffledDeck();
  assert.equal(deck.length, 52);
  const unique = new Set(deck.map((c) => `${c.rank}${c.suit}`));
  assert.equal(unique.size, 52);
});

test('handValue counts face cards as 10', () => {
  assert.equal(handValue([{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }]), 20);
});

test('handValue counts Ace as 11 when it does not bust', () => {
  assert.equal(handValue([{ rank: 'A', suit: '♠' }, { rank: '9', suit: '♥' }]), 20);
});

test('handValue drops Ace to 1 when 11 would bust', () => {
  assert.equal(
    handValue([{ rank: 'A', suit: '♠' }, { rank: '9', suit: '♥' }, { rank: '5', suit: '♦' }]),
    15
  );
});

test('handValue handles multiple Aces', () => {
  assert.equal(
    handValue([{ rank: 'A', suit: '♠' }, { rank: 'A', suit: '♥' }, { rank: '9', suit: '♦' }]),
    21
  );
});

test('isBust is true only above 21', () => {
  assert.equal(
    isBust([{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }, { rank: '5', suit: '♦' }]),
    true
  );
  assert.equal(isBust([{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }]), false);
});

test('isBlackjack requires exactly two cards totalling 21', () => {
  assert.equal(isBlackjack([{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }]), true);
  assert.equal(
    isBlackjack([{ rank: '7', suit: '♠' }, { rank: '7', suit: '♥' }, { rank: '7', suit: '♦' }]),
    false
  );
});

test('dealerShouldHit stands on soft 17', () => {
  assert.equal(dealerShouldHit([{ rank: 'A', suit: '♠' }, { rank: '6', suit: '♥' }]), false);
});

test('dealerShouldHit hits below 17', () => {
  assert.equal(dealerShouldHit([{ rank: '9', suit: '♠' }, { rank: '6', suit: '♥' }]), true);
});

test('resolveOutcome: player bust always loses even if dealer also busts', () => {
  const playerBust = [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }, { rank: '5', suit: '♦' }];
  const dealerBust = [{ rank: 'K', suit: '♣' }, { rank: 'Q', suit: '♦' }, { rank: '5', suit: '♠' }];
  assert.equal(resolveOutcome(playerBust, dealerBust), 'lose');
});

test('resolveOutcome: both blackjack is a push', () => {
  const hand = [{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }];
  const dealerHand = [{ rank: 'A', suit: '♣' }, { rank: 'K', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'push');
});

test('resolveOutcome: player blackjack beats dealer non-blackjack', () => {
  const hand = [{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }];
  const dealerHand = [{ rank: '9', suit: '♣' }, { rank: '9', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'win');
});

test('resolveOutcome: dealer blackjack beats player non-blackjack', () => {
  const hand = [{ rank: '9', suit: '♠' }, { rank: '9', suit: '♥' }];
  const dealerHand = [{ rank: 'A', suit: '♣' }, { rank: 'K', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'lose');
});

test('resolveOutcome: dealer bust with player still in play is a win', () => {
  const hand = [{ rank: '9', suit: '♠' }, { rank: '8', suit: '♥' }];
  const dealerBust = [{ rank: 'K', suit: '♣' }, { rank: 'Q', suit: '♦' }, { rank: '5', suit: '♠' }];
  assert.equal(resolveOutcome(hand, dealerBust), 'win');
});

test('resolveOutcome: higher hand value wins when neither busts nor has blackjack', () => {
  const hand = [{ rank: '9', suit: '♠' }, { rank: '9', suit: '♥' }];
  const dealerHand = [{ rank: '9', suit: '♣' }, { rank: '7', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'win');
});

test('resolveOutcome: equal values push', () => {
  const hand = [{ rank: '9', suit: '♠' }, { rank: '9', suit: '♥' }];
  const dealerHand = [{ rank: 'K', suit: '♣' }, { rank: '8', suit: '♦' }];
  assert.equal(resolveOutcome(hand, dealerHand), 'push');
});

test('computePayout: push returns the full stake and nothing more', () => {
  assert.equal(computePayout('push', false, 50), 50);
  assert.equal(computePayout('push', true, 50), 50);
});

test('computePayout: lose returns nothing (the stake was already deducted)', () => {
  assert.equal(computePayout('lose', false, 50), 0);
  assert.equal(computePayout('lose', true, 50), 0);
});

test('computePayout: normal win pays 1:1 (stake back plus an equal amount)', () => {
  assert.equal(computePayout('win', false, 50), 100);
  assert.equal(computePayout('win', false, 1), 2);
});

test('computePayout: blackjack win pays 3:2, rounded down for odd bets', () => {
  assert.equal(computePayout('win', true, 50), 125);
  assert.equal(computePayout('win', true, 5), 12);
  assert.equal(computePayout('win', true, 1), 2);
});
