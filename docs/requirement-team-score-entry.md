# Team vs individual score entry — DECIDED 2026-08-21, not yet built

Ajay, 2026-08-21. Extends `docs/scoring-input-model.md`, which currently
excludes team cards outright; this is the decision to bring them in properly.

**Decided, not implemented.** The rule is settled; nothing is built.

## The decision, in one line

> **The input mirrors the physical scorecard. The override may reduce detail;
> it may never invent it.**

That is the whole rule, and it answers "team or individual?" without anyone
having to remember a list:

- **One ball → one line on the card → TEAM entry.** Foursomes, alternate shot,
  greensomes, Chapman/Pinehurst, scramble. Individual entry is **not offered** —
  not as a restriction but because the choice is meaningless. There was no
  individual ball, so there is no individual score to type, and offering the
  option invites somebody to invent one.
- **Two balls → two lines → INDIVIDUAL entry, team score DERIVED.** Four-ball
  and best ball. Both scores are real and both are on the paper card; the side's
  score is the better of them and the app computes it rather than asking for it.

The override exists where both are physically meaningful. A four-ball club in a
hurry may choose to record only the side's better-ball score. That LOSES
information, and every number typed is still real — which is the direction the
rule permits. Nothing may go the other way.

This keeps faith with the principle already set in `scoring-input-model.md` —
*"the default is a real card"* — where the real card is the paper one in the
player's pocket.

## Why this beats the incumbent

Checked against Golf Genius on 2026-08-21 rather than assumed. On the
fundamentals we agree, and could not do otherwise: in alternate shot GG records
one ball and one score per pair, because that is what the Rules leave. Format
coverage is where they are strongest and competing there is a losing game.

Three places this decision is genuinely better:

1. **It is not a setting.** GG's help centre carries an article titled *"How can
   I enter one team scores for each hole rather than individual?"* — and the
   existence of that article is the finding. Organizers set up an alternate-shot
   event, get individual entry, and go looking for support. Here the format
   knows there was one ball, so the wrong option is never offered. Same
   capability, misconfiguration removed. It is the pattern this codebase already
   enforces in `resolveThirdPlace` and `drawReadiness`: refuse with an
   explanation, never guess.
2. **Never type a derived number.** GG's guidance includes *"if playing a net
   tournament, enter the total net team score for every hole."* Typing net
   stores a DERIVATION as if it were a fact, and it costs three things: no gross
   means no handicap record from that round, no countback on gross, and no way
   to recompute when a handicap turns out to be wrong. The principle in
   `scoring-input-model.md` forbids it, and
   `requirement-per-round-handicap.md` is the right way to get immutability
   without losing the fact — freeze the HANDICAP as of the round, not the net
   score.
3. **Say the cost where the choice is made.** See the section below. GG will let
   a club pick team-only silently.

See `docs/positioning.md` for what this is an instance of.

## The cost of the reduced option, which must be said on screen

If a four-ball club records only the side's score, **individual handicap
records cannot come from that round.** Under WHS a four-ball score is
acceptable for handicapping when the player's own ball is recorded; choosing
team-only quietly gives that up for everyone in the field.

That belongs beside the control where the choice is made, not in a footnote and
not in a tooltip — see `no-tooltip-refusals.test.ts`.

## Where it lives

`formats.ts` already declares `sideSize`, `allowance`, `allowanceWeights`,
`countBest` and `engine` per format. The input mode belongs there beside them —
the same "fixed by format, with an override" shape already decided for match
play in `scoring-input-model.md` — with the one-ball engines simply not
offering the individual option.

## Why the question needed deciding at all

The formats split into two genuinely different groups, and the ask read cleanly
for only one of them.

**One ball — no individual gross exists.** In foursomes the side plays ONE ball,
alternating strokes (Rule 22). There is no such thing as a player's gross for
the hole; there is the side's. Recording "player A had a 5" would invent a round
nobody played — which is exactly what `match-cards.ts` already refuses to do:
*"a side's card is not a player's card — a foursomes pair returns one card for
two people, and crediting it to either of them individually would invent a round
neither played."* Greensomes and Chapman/Pinehurst have some individual strokes
but one ball and one score; a scramble likewise.

**Two balls — individual gross is real.** In four-ball (Rule 23) each player
plays their own ball throughout. Both scores exist, and the side's is derived.

So "report individual scores" is a real option for one group and a physical
impossibility for the other, which is what the rule above encodes.

## What was asked

For alternate shot, modified alternate shot "or any such kind of format", there
should be an option to report a **team/pair score** rather than individual
scores. Offer individual reporting as an option, but let the **format's real
requirement override** it.

That last clause is the important half: the organizer picks how they want to
type it in, and the FORMAT decides what the authoritative score actually is.

## What it touches

- `TeamScorecard` holds a SIDE's card today, and `match-cards.ts` deliberately
  does not join it: "a side's card is not a player's card — a foursomes pair
  returns one card for two people, and crediting it to either of them
  individually would invent a round neither played." That comment is the
  existing position, and this requirement is the decision to revisit it.
- **Handicaps.** A side's playing handicap is not a player's — `effectiveAllowance`
  and `allowanceWeights` split it between partners. Whatever gets stored has to
  keep the side's allowance the thing that is applied.
- **The stroke board and WHS.** A foursomes round is not an individual round and
  does not go on an individual handicap record. If individual entry is allowed,
  it must not silently become a counting score.
- `forfeitMatch` already REFUSES a team forfeit rather than storing one nothing
  reads — the same "do not store what nothing can honestly use" instinct.

Per CLAUDE.md this is the COMBINATIONS class: add cells to
`src/lib/__tests__/matrix.test.ts` for format x stage type, sweep field sizes
from ONE, and assert against the Rules — foursomes is Rule 22, four-ball Rule 23.

## Sequencing

After `docs/scoring-input-model.md` lands, for the same reason the per-round
handicap requirement is deferred: both change what a card means, and two such
changes in flight at once cannot be verified independently.
