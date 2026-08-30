# Betting & Bankroll — Design Spec

Date: 2026-08-30

## Purpose

Add fake-money betting to the existing multiplayer blackjack game: each room
starts with a configurable chip bankroll per player, players wager before
every round, winnings/losses flow through standard blackjack payout rules,
the game ends when a player's bankroll hits zero, and either player can
reset the bankroll at any time to start a fresh session in the same room.

This supersedes the "no betting/chips" scope boundary from the original
design (`docs/superpowers/specs/2026-08-29-multiplayer-blackjack-design.md`).
Everything else in that spec (Hit/Stand-only actions, one shared reshuffled
deck, dealer stands on soft 17, turn order, disconnect/reconnect handling,
the win/lose/push session tally) is unchanged and still applies.

**Explicitly deferred, not part of this change:** double down and split
(conventional in real-money blackjack, but not requested — easy to add
later as a follow-up), table bet minimums/maximums beyond "must fit within
your current bankroll", and persisting bankroll across server restarts
(still in-memory only, consistent with the rest of the app).

## State machine changes

The round cycle gains two phases:

```
waiting → betting → playing → dealer → results → betting → ... 
                                            ↘ game_over (if someone hit 0)
```

- **`betting`** (new): entered once both seats are filled (replacing the
  old immediate deal-on-join), and again after every round that doesn't
  end the game. Both players independently submit a bet — no turn order,
  since a bet amount doesn't leak strategic information the way a
  mid-hand action would. Once both bets are in, the round deals
  automatically, exactly like the old deal-on-join behavior.
- **`game_over`** (new): entered instead of cycling back to `betting`
  after a round's payout leaves either player's bankroll at exactly 0.
  Terminal until a `reset_game` message arrives.

Room state gains:
- `startingBankroll: number` — set once, at room creation.
- `bankroll: { host: number, guest: number }` — current chip counts.
- `bets: { host: number|null, guest: number|null }` — this round's wagers;
  `null` means "not placed yet."

## Protocol changes

**Client → Server:**
- `create_room {startingBankroll?}` — `startingBankroll` is optional; if
  missing, non-numeric, non-positive, or absurdly large, the server
  silently clamps it to a sane default/range (default 1000, clamped to
  [10, 1,000,000]) rather than rejecting the request.
- `place_bet {amount}` — valid only during `betting`. Rejected with an
  `error` if: phase isn't `betting` (`"not in betting phase"`), this seat
  already has a bet this round (`"bet already placed"`), or `amount` isn't
  an integer with `1 <= amount <= bankroll[seat]` (`"invalid bet amount"`).
- `reset_game` — valid in **any** phase. Either player can send it
  unilaterally at any time (no agreement from the other player required —
  consistent with every other action in this app, which trusts both
  players).
- `hit` / `stand` / `ready` — unchanged in shape. `ready`'s effect changes:
  after both players ready up from `results`, the room now returns to
  `betting` (to collect new bets) instead of dealing immediately.

**Server → Client `state`:** gains `bankroll`, `bets`, and
`startingBankroll` fields. `phase` can now also be `"betting"` or
`"game_over"`.

## Payout rules (escrow model)

- **Placing a bet** immediately deducts it from that player's bankroll and
  records it in `bets[seat]`. This happens once, up front — not at
  resolution — so a player's bankroll during `playing`/`dealer`/`results`
  already reflects the bet being "at risk."
- **At resolution**, for each player: their existing `resolveOutcome`
  result determines the payout added back to their bankroll:
  - **Push:** `+= bet` (full stake returned, net zero).
  - **Win (normal):** `+= bet * 2` (stake returned + an equal amount, 1:1).
  - **Win (natural blackjack):** `+= bet + floor(bet * 1.5)` (stake
    returned + 1.5× winnings, rounded down for odd bet amounts — standard
    3:2 blackjack payout).
  - **Lose:** `+= 0` (the bet was already deducted; nothing comes back).
- This payout calculation is a new pure function in `server/game.js` —
  `computePayout(result, isPlayerBlackjack, bet)` — alongside the
  existing pure rule functions, unit-tested the same way.

## Game over

Checked immediately after payouts are applied, before deciding the next
phase: if either player's bankroll is now exactly 0, phase becomes
`game_over` instead of `betting`. Both players see a Game Over screen with
final bankrolls. Both bankrolls can reach 0 in the *same* round (each
player's bet and outcome are independent — e.g. both go all-in and both
lose), which the client treats as a draw rather than crashing or picking
an arbitrary winner.

The existing win/lose/push session tally (the "Leaderboard" panel) is
**not** reset by any of this — it's a running record of hands played in
the room, independent of the bankroll's ebb and flow.

## Reset

`reset_game` (any phase, either player, no confirmation required
server-side — the client adds its own confirm dialog to guard against
misclicks, see below):
- Restores both bankrolls to `room.startingBankroll`.
- Clears the in-progress round entirely: hands, bets, results, `stood`,
  `readyForNext`, turn.
- Returns phase to `betting` (or `waiting` if, edge case, only one seat is
  currently filled — e.g. a reset sent right as the other player
  disconnected permanently... though in practice this requires an
  occupied seat to exist to send the message at all, so this mostly
  matters if a room somehow has only one seat filled when reset fires).
- Does **not** touch the win/lose/push tally.

## Client UI

- **Lobby:** a "Starting chips" number input (default 1000) next to
  "Create Room" — only the host sets it; the joiner inherits whatever the
  host chose. Empty/invalid input is simply omitted from the
  `create_room` message, letting the server default apply.
- **Betting phase:** replaces the dealt-hands view with a bet input +
  "Place Bet" button per player, showing their current bankroll. After
  placing, the input/button disable and show "Waiting for opponent's
  bet..." (or "Waiting for your bet..." is never shown to yourself, only
  the other player's pending status is relevant to display). Once both
  bets land, the view transitions to the normal dealt-hands view
  automatically.
- **Bankroll display:** each of "You"/"Opponent"'s hand-section headers
  gets a small chip-count badge, visible whenever bankroll is meaningful
  (i.e., not during `waiting`).
- **Game Over screen:** a distinct banner — "You win the game!" if the
  opponent hit 0 and you didn't, "Game Over — you're out of chips." if you
  hit 0 and they didn't, "You both ran out of chips!" if both did — showing
  final bankrolls, plus a prominent "New Game" button that sends
  `reset_game`.
- **Reset Game button:** small, persistent, near the room code display,
  visible in every phase once seated in a room. Sends `reset_game` after a
  native `window.confirm` guard (this action is unilateral and
  irreversible from the other player's perspective, so a misclick
  shouldn't be able to wipe their progress without at least a pause).

## Edge cases

- **Both players hit 0 in the same round:** handled explicitly above (draw
  messaging, not a crash or arbitrary pick).
- **Disconnect during `betting` or `game_over`:** no special handling
  needed — the existing disconnect/reconnect logic is already
  phase-agnostic (pause, wait, reconnect via token).
- **A player has fewer chips than they'd like to bet:** no minimum-bet
  floor beyond 1 chip; a player with, say, 1 chip left must bet that 1
  chip (no partial/skip option) — consistent with "reaching 0 ends the
  game," since there's no smaller increment to fall back to.
- **Reset mid-round:** any bet already escrowed for the in-progress round
  is simply discarded — bankrolls are set directly to
  `startingBankroll`, not "returned" through normal resolution.
- **Rejoin during `betting`/`game_over`:** unaffected — reconnect logic
  only touches seat/connection state, not phase, so a rejoining client
  just receives whatever the current phase/bankroll/bets are.
- **`startingBankroll` validation:** non-integer, ≤0, missing, or absurdly
  large values are clamped/defaulted server-side rather than rejected.

## Testing approach

- `game.js`: unit tests for the new `computePayout` function covering
  push, normal win, blackjack win (including odd-bet rounding), and lose.
- `server/test/server.test.js`: integration tests covering — `create_room`
  with a custom `startingBankroll`; `place_bet` validation (wrong phase,
  double-bet, invalid amount); a full `betting → playing → results →
  betting` cycle with bankroll changes asserted; a round that drives a
  bankroll to exactly 0 and confirms `phase` becomes `game_over`; and
  `reset_game` from a few different phases confirming bankrolls/phase
  reset correctly.
- Client changes (lobby bankroll input, betting-phase UI, game-over
  screen, reset button) are verified the same way prior UI work in this
  project was verified: careful reading plus a headless-Chrome screenshot
  pass with mock data, not full interactive browser testing.
