# Pricing: what the code actually gates today

**Facts, not a proposal.** Measured on 2026-09-18 to be read beside
`docs/pricing-proposal.md`, which was written on 2026-09-11 and decides the
tiers. This decides nothing; it says what exists, so the tier decision is made
against the code rather than against memory.

Ajay, 2026-09-18: *"once we get this 100% accurate and confirmed, we need to
decide on pricing tiers and the gates in the code."* This is the second half.

---

## The tiers that exist

Two, in `src/lib/plans.ts`: **Free** ($0) and **Club** ($29/month).

## What is enforced, and where

| gate | Free | Club | enforced? |
|---|---|---|---|
| Active tournaments | 1 | unlimited | **yes** — `createEvent`, `cloneEvent` |
| Staff seats | 1 | 10 | **yes** — `addOrganizationMember`, `approveJoinRequest`, and per-event roles in `tournament.ts` (an event organizer consumes a seat, or the limit would be bypassed one event at a time) |
| Players per tournament | unlimited | unlimited | **no limit exists** — see the conflict below |
| Attribution hidden (`whiteLabel`) | no | yes | **yes** — `showAttribution` in `services/organization.ts` |
| Season standings | no | yes | **yes** — `services/series.ts` |
| SMS · card scan · AI assist | off | **off** | entitlement checks exist and work; all three are dark on **both** tiers, switched off by cost rather than by tier |
| Honours board (`honours`) | on | on | **gateable, deliberately ungated** — sink in `services/honours.ts` |
| Public leaderboard (`publicBoard`) | on | on | **gateable, deliberately ungated** — sink in `services/live-board.ts` |
| Per-club exceptions (`featureOverrides`) | — | — | **yes** — any feature can be turned on or off for one organization without moving its tier |
| 48-hour retention on Free | declared | — | **nothing purges.** `dueForPurge` has never had a caller outside its own tests |

So the live difference between Free and Club is: **unlimited tournaments, ten
seats instead of one, no attribution, and season standings.** Nothing else.

**"Gateable, deliberately ungated" is a state, and it is the answer to
*"start gating the features we need per tier, and make it dynamic"*
(Ajay, 2026-09-18).** The capability is wired to a sink that can refuse, the
tier table decides it, and one club can be excepted from its tier — so turning
it into a tier difference later is editing a boolean in `plans.ts`, not writing
a gate. It is ON for everybody until the ladder is decided, because choosing
which tier loses a feature *is* the tier decision, and
`no-dead-feature-keys.test.ts` fails the day one is switched off, so it cannot
happen by accident.

Gate at the SINK, never at the screen: `honours` returns an empty list and
`publicBoard` returns null, so a second screen reading the same service is
gated without knowing the rule exists. A gate on a screen is a gate the next
screen forgets.

The retention gap is known and already handled honestly — `retentionNotice`
says only that the plan "doesn't guarantee that a finished tournament is kept",
after the earlier copy promised a deletion that never happened. The comment
there is worth reading before anyone changes it.

---

## The thing everything else depends on: there is no way to pay

**No Stripe code exists in `src`.** No checkout, no webhook, no portal, no
billing route. `Subscription` carries `provider`, `providerCustomerId` and
`providerSubscriptionId` and **nothing writes them** — a plan can only change
by a direct database write. `PlanPanel` says so on screen: *"Changing plan is
arranged with us directly — nothing is charged through the app."*

That is deliberate, and its stated reason is:

> No buy button, deliberately. TourneyHQ calculates and records money; it never
> takes any.

**DECIDED, 2026-09-18 — Ajay: "yes people should be able to pay in app".**

So the reason quoted above no longer stands, and the distinction it missed
should be written into the code when the button is built: hard rule 7 is about
never being a payment rail *between players* — skins, payouts, prize splits.
A club paying a subscription is TourneyHQ's own revenue and touches no golfer's
money. Both remain true at once, and the comment in `PlanPanel` needs to say
which of the two it is guarding when it is replaced.

**Not yet, though.** The same message set the order: *"we need to decide 3-5
level tiered plan and the pricing and features. That's why I said let's get the
app 100% ready and then we can decide the pricing tiers."* Readiness first,
tiers second, billing after the tiers exist to sell — building checkout against
a two-tier ladder that is about to become four would be work done twice.

---

## Where the proposal needs gates that do not exist

Each row of the proposal's feature table, against the code:

| proposal says | gate today |
|---|---|
| Casual ≤ 8 players · Event ≤ 72 | **none, and the type forbids it** — `playersPerEvent` is typed as the literal `null`, commented "Always unlimited", and the plan panel says "players are always unlimited" on screen |
| Casual: one round per tournament | **none** — no per-tournament round limit anywhere |
| Public leaderboard link from Event up | **gateable, and ON for everybody** — `publicBoard`, withheld at the sink in `services/live-board.ts` (returns null). `leaderboardVisibility` remains the per-event setting and is a separate question |
| Flights, cuts, brackets, tee sheet from Event up | **none** |
| Roster & handicap history from Society up | **none** — the Members screen is present for every kind and plan |
| Season standings from Society up | **exists** (`seasonStandings`) |
| Honours board on Club | **gateable, and ON for everybody** — `honours`, withheld at the sink in `services/honours.ts` (returns an empty list) |
| Club branding on Club | **exists** (`whiteLabel`) |
| Course library: 1 on Event, unlimited above | **no limit, but the door is built** — every `Course` is now created through `addCourseToLibrary` (#446) and nothing else may; the cap is one `refusalFor` call on that line. Its `origin` already carries the exemption a cap needs: a casual round naming its own venue must never be refused |
| Staff seats 1 / 2 / 5 / 10 | **exists** (`staffSeats`), enforced in three places |
| Results kept 24h / 12mo / for good | `retentionHours` exists per plan; **nothing enforces it** |
| Per-active-member pricing | **none** — no active-member count, and `LimitKey` is only `"activeEvents" \| "staffSeats"` |
| One-off event purchase | **none** — no entitlement keyed to an event |

Two of these are worth calling out as *conflicts* rather than gaps, because the
code currently asserts the opposite in public:

1. **Player caps.** `plans.ts` states players are always unlimited and the
   interface repeats it to every organizer. Capping Casual at 8 and Event at 72
   reverses a promise already on screen.
2. **Feature gating by tier.** Everything in the "from Event up" and "from
   Society up" rows is presently available to everyone, including on Free. The
   proposal's own distinction holds — gating by purchased TIER is ordinary,
   gating by self-declared KIND is not. Two of those rows now have their
   machinery (`honours`, `publicBoard`) and are ungated by choice; the rest —
   flights, cuts, brackets, the tee sheet, the roster — have no sink wired at
   all, and wiring one is a product decision about what Free stops being, not a
   refactor.

---

## Two facts in the proposal that have changed since it was written

- **`kind` is editable now.** The proposal argues against pricing on
  organization kind partly because it "is not even editable afterwards". As of
  #434 it is: club settings has a "What this is" control. **The conclusion is
  unaffected and still right** — a self-declared radio button is not a billing
  metric, whether or not it can be changed — but the premise is stale and
  somebody re-deriving from it would reach a different answer.
- **The tier prose is one draft behind its own table.** The table sets Society
  at "$10 per active member / yr, minimum $199" and the reasoning under it
  explains why flat bands were abandoned. The "What each tier is" section below
  still describes "Society — $299/yr, up to 30" and "League — $599/yr, up to
  60", which are the superseded flat tiers. Anybody reading down the page acts
  on the older answer.

---

## What tonight's work changed that bears on pricing

- **The single staff seat on Free is the sharpest friction the product has
  right now.** A local league's second organizer asks to join (#433), the club
  approves, and the seat limit refuses — on exactly the customer Ajay named as
  most affected. The refusal names the person and offers Member as a way
  through, which is a workaround rather than an answer. Under the proposal this
  resolves itself, because a league belongs on Society with five seats and Free
  narrows to casual rounds; it is only a problem while Free is a tier a league
  can live on.
- **Guest costs no seat** (#429), so a charity field or a league substitute
  never counts against the cap. That stays true at any tier and should survive
  the redesign.
- **The course library has one door now** (#446), which is the prerequisite the
  "1 course on Event" row needed — four separate creates could not have been
  capped without four separate guards, and two of them were already forgetting
  the duplicate check they did have. The cap is one line on that door when the
  ladder says what it is. It also closed a live defect on the way: pasting the
  same scorecard twice made a second course, and two rows for one golf course
  are not interchangeable when one carries the real stroke index.
- **A tier limit needs an exemption vocabulary, and the door is the first place
  it exists.** `origin` distinguishes a club building its library from a casual
  round naming where it was played. Every limit the ladder adds will need the
  same distinction somewhere, because the casual round is the free product and
  must never be refused for a paid allowance being full — `limits.ts` already
  makes that argument for tournaments, and this is the second instance of it.
  Worth deciding once, generally, rather than per gate.

---

## The order, now that payment is decided

Ajay's sequence, 2026-09-18: **the app is made ready, then the tiers are
decided (three to five of them, with their prices and features), then it is
built.** What follows is the build order once those tiers exist — not a plan to
start now.

1. `LimitKey` and the `Plan` shape widen to carry whatever the tiers need. One
   file, and the cheapest thing on this list;
2. the gates themselves, at the SINKS rather than the screens — the codebase's
   own rule, and why `standingRows` returns `[]` on its first line. A gate on a
   screen is a gate a second screen forgets;
3. the payment path. After the tiers, not before: checkout built against a
   two-tier ladder that is about to become four is work done twice, and the
   webhook has to write a plan key that exists;
4. retention last and most carefully, because it is the only one that deletes
   somebody's data. Note what it already costs to get wrong — the copy
   promising a 48-hour deletion outlived the deletion itself by months.

The one thing worth doing before any of it: **decide what a tier limit does to
a customer who is already over it.** Every gate above is a refusal somebody
meets on a Thursday afternoon, and the seat limit is the live example — a club
at its cap cannot add the organizer who just asked to join. Grandfathering and
the wording of each refusal are part of the tier decision, not an afterthought
to it.
