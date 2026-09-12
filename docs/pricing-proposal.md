# Pricing: a proposed tier structure

**Proposal, not a decision.** Written 2026-09-11 at Ajay's request, after
looking at what the US market actually charges. Nothing here is built.

The three problems it has to solve, in his words:

1. groups taking advantage of the free plan by signing up fresh each year;
2. society and community golf needing a lower price point than a large club,
   without forking the product;
3. casual golf staying free, always — with more club-level features coming.

---

## What the market charges (US, September 2026)

| | model | price |
|---|---|---|
| Golf Genius | per facility, annual | ~$1,425/yr + $200 onboarding; ~$99/event pay-per-event |
| Event Caddy | per player, per event | $1.50–$2.50/player, $300–500 minimum |
| LeagueGolfer | **per roster member, annual** | $10/regular/yr web, $20 with mobile; substitutes free |
| GolfStatus | free for 501(c) | $0 upfront, transaction fee passed to golfers/sponsors |
| GolfRegistrations | free + transaction | 4.9% per transaction |

**Not one of them prices on what kind of organization you are.** They price on
scale of use — players, members, or facilities. That is the answer to problem
2: a society does not need a cheaper *product*, it needs a *metric that
scales*. A 40-member society then pays less than a 400-member club
automatically, with nothing to self-declare and nothing to game.

The current plan is $29/mo — under a quarter of Golf Genius. That is not
"affordable", it is under-priced to the point of signalling a lesser product.

---

## The proposed ladder

**Four tiers.** Every one set at half the closest comparable, which is the
brief.

| tier | price | band | comparable | gap |
|---|---|---|---|---|
| **Casual** | free, always | ≤8 players, one round | — | — |
| **Event** | **$49** one-off | one tournament, ≤72 players | Golf Genius $99/event | **−50%** |
| **Society** | **$10 per active member / yr**, minimum $199 | up to the point it reaches Club | LeagueGolfer $20/regular | **−50% at every size** |
| **Club** | **$699/yr** or $69/mo | unlimited | Golf Genius $1,425 + $200 setup | **−51%** |

Club carries **no onboarding fee**, so against Golf Genius's first year it is
−57%.

### Why Society is per member rather than a flat band

The first draft had two flat mid-tiers — Society ≤30 at $299 and League ≤60 at
$599 — and they were fighting the arithmetic. LeagueGolfer charges per member
and Golf Genius charges flat, so the two curves cross: half of LeagueGolfer at
80 members is $800, which is **more than an unlimited Club plan**. A league of
80 would have paid more than a club of 400. Squeezing League into ≤60 fixed the
inversion and left a tier $100 below Club, which is barely a tier.

Charging per member removes the problem instead of working around it:

| active members | Society | LeagueGolfer | gap |
|---|---|---|---|
| 20 | $199 (floor) | $400 | −50% |
| 30 | $300 | $600 | −50% |
| 50 | $500 | $1,000 | −50% |
| 60 | $600 | $1,200 | −50% |
| 70+ | *buy Club at $699* | $1,400 | −50% |

It holds 50% at **every** size, a 20-member society is not asked to subsidise a
60-member league, and the tier **caps itself**: the moment per-member pricing
would exceed $699 the club plan is cheaper, so the upgrade explains itself
without a rule anybody has to enforce. That is also exactly what the market
does — above roughly 70 members, per-head pricing costs more than flat facility
pricing everywhere in this segment.

The $199 floor is what stops a four-man committee running a 200-player open on
a per-member plan.

### What is in each tier

The scoring engine is identical everywhere. Nobody gets worse golf for paying
less: every format, slope-and-rating handicaps, the live board, the public
link, and the whole money side are in all four. What the money buys is
CONTINUITY, then SCALE, then the club's own identity.

| | Casual | Event | Society | Club |
|---|---|---|---|---|
| **Price** | free | $49/event | $10/member/yr, min $199 | $699/yr |
| Players | 8 | 72 | unlimited | unlimited |
| Tournaments | — | 1 per purchase | unlimited | unlimited |
| Rounds per tournament | 1 | unlimited | unlimited | unlimited |
| Every format, handicaps, live board | ✓ | ✓ | ✓ | ✓ |
| Skins, side bets, expenses, splits | ✓ | ✓ | ✓ | ✓ |
| Public leaderboard link | — | ✓ | ✓ | ✓ |
| Flights, cuts, brackets, tee sheet | — | ✓ | ✓ | ✓ |
| **Roster & handicap history** | — | — | ✓ | ✓ |
| **Season standings, league weeks** | — | — | ✓ | ✓ |
| **Honours board** | — | — | — | ✓ |
| **Club branding on every screen** | — | — | — | ✓ |
| Course library | — | 1 | ✓ | ✓ |
| Staff seats | 1 | 2 | 5 | 10 |
| Results kept | 24h after the round | 12 months | for good | for good |
| Metered add-ons (SMS, card scan, AI) | — | — | — | when enabled |

The three bolded rows are the upgrade story, and they are all things that
COMPOUND. That is deliberate: what a re-registering group loses is not a
feature, it is their history.

### What each tier is

**Casual — free, always.**
A round, up to eight players, one round, no club. This already exists as its
own product shape (`kind: "personal"`, `/match/new`, the round-code play
shell). No roster, no season, no club screens, no history to accumulate.

Nothing here is worth farming, which is the point.

**Event — $49, bought once, not a subscription.**
One tournament, any size of field, the whole tournament engine. Results kept
12 months so the club can look back at what they ran. Two staff seats.

This is the shape the one-off organizer actually wants — Event Caddy and Golf
Genius have trained them to expect per-event, and a subscription is the wrong
promise for something that happens each September.

**Society — $299/yr, up to 30 active members.**
Unlimited tournaments, the roster, handicap history, season standings, three
staff seats, results kept for good.

**League — $599/yr, up to 60 active members.**
As Society, five staff seats, and the weekly apparatus a league actually
runs on — availability, the week view, the season skins table — all of which
is already built.

**Club — $699/yr, unlimited.**
Everything, unlimited members and tournaments, ten staff seats, the club's own
branding on every screen and the public board, the honours board, and the
multi-course library.

**This is where future club-level features land.** Adding them raises the value
of the top band without a new SKU.

---

## Why this closes the re-signup loophole

Free today is **one active tournament** — which is exactly what a once-a-year
society or charity day needs, so re-registering each September gets them the
whole product for ever. The 48-hour retention does not stop it: they export
and go.

Moving the free line to *casual rounds only* removes the prize. Then:

- a group that re-registers annually is choosing to pay **$49 an event**, which
  is cheaper than the hassle of doing it again — so the honest path is also the
  easy one;
- everything that makes the product compound — roster, handicap history, season
  standings, honours board — accrues only on a subscription, and is lost by
  anyone who starts again.

**Continuity is the thing being bought.** That is a far better retention
mechanic than deleting a club's results after 48 hours, which reads as punitive
to exactly the small clubs this is meant to serve.

---

## One distinction worth being exact about

Earlier advice in this repo was: **do not fork features by organization KIND.**
That still holds, and this proposal does not.

`kind` (club / community / personal) is a self-declared radio button at sign-up
that is not even editable afterwards. Pricing or gating on it would be an
honour system with no verification, and anyone who picked wrong would be stuck.

**Forking by TIER is different and ordinary**, because a tier is *purchased* —
it is verified by the fact of payment. So Club may carry features Society does
not. What must not happen is a "society edition" of the product.

---

## Who the customer is, and what that settles

Raised by Ajay on 2026-09-11, from market reading:

> A club is typically the paying "customer," and its members receive access
> through the club rather than signing up individually.

**This is the missing half of the per-member metric**, and it settles three of
the open questions above rather than adding a fourth.

- **What a "seat" is.** It is a row on the club's roster, not a person with a
  login. That is already how the app works — `Member` outlives any one
  tournament and `createPlaySession` signs `stageId:playerId:expiry:code` and
  never reads an address — so a member who never opens the app is still a
  member the club is billed for, and that is the honest reading, not a
  loophole. It also means **the count is a number the club itself controls and
  can see**, which is the property a billing metric most needs.
- **Who signs up.** Nobody bills a player. Every player-side surface — round
  codes, the play shell, `/me` — stays free at every tier, because the player
  is not the customer. A tier limit that made a player unable to enter their
  own score would be charging the wrong person.
- **The free-plan re-signup loophole** gets smaller on its own footing: if
  access flows through the club, a group re-signing up each year abandons its
  roster, its history and its order of merit to do it. That is a real cost to
  them, where "make a new account" alone is not.

What it does NOT settle, and must be decided before this is built: whether an
inactive member still counts (proposed: no — `status !== "active"` is free, and
it is why that column exists), and what happens to a club that drops below a
band edge mid-year.

---

## What it means in the code

The existing `Plan` shape in `src/lib/plans.ts` carries most of this already —
`limits`, `retentionHours`, `features`, and the metered three
(`sms`, `cardScan`, `aiAssist`) which stay off on every tier until there is
revenue to cover the carrier and model bills.

Three things do not exist yet:

**1. An active-member limit, and a definition to go with it.**
This is the whole pricing model and it has to be decided before anything is
built. Entries write through to the roster automatically (`upsertMember` runs
on every entry path), so a club would be billed for every name ever added
unless the count is scoped — "played at least one round in the last 12 months"
is the obvious rule. A member who has left must stop counting without being
deleted, because deleting them would take their history with them.

**2. A one-off purchase.** `Event` is currently free-or-covered-by-the-org's
subscription; there is no notion of a tournament that was paid for on its own.
That is a new entitlement row keyed to the event, and it has to survive the
organization later subscribing and later lapsing.

**3. Retention per tier.** `retentionHours` is already per plan; Event needs
12 months rather than 48 hours or for ever.

### Migration

The app is pre-launch, so the population is small — but the rule should be
written down before it is not:

- **Existing free tenants holding a tournament**: grandfathered, not cut off.
  They keep what they have; the new line applies to tournaments created after
  the change.
- **Existing $29/mo subscribers**: honour the price for as long as they stay
  subscribed. It is a handful of tenants and the goodwill is worth more than
  the difference.
- **`personal` organizations**: unaffected — they are the free tier.

---

## Two cautions

**Pricing 50% below the leader is easy to go down from and very hard to climb
back up.** The Society and League tiers already make the product affordable for
community golf on their own. Club could sit nearer **$899** (still −38% against
Golf Genius) and keep room to rise as the club feature set grows. Worth
deciding deliberately rather than by anchoring on one number.

**The bands are a guess until somebody sells one.** 30 and 60 members are
plausible and not researched — they are where a society becomes a league and a
league becomes a club in the UK and US clubs the app has seen. Expect to move
them once real customers exist, which argues for keeping the band edges in
`plans.ts` rather than anywhere they would be expensive to change.

---

## Sources

- [Golf Genius pricing](https://www.golfgenius.com/pricing)
- [LeagueGolfer pricing](https://www.leaguegolfer.com/pricing.php)
- [GolfStatus — Golf for Good](https://golfstatus.com/)
- [Best golf tournament software 2026](https://www.livetourney.com/blog/best-golf-tournament-software)
- [Charity golf tournament software comparison](https://www.dojiggy.com/blog/best-charity-golf-tournament-software/)
