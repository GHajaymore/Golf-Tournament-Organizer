# TourneyHQ — monetization, tiers, and the pitch against the field

A proposal for Ajay. Written 2026-09-23. Prices are proposals, not decisions.

**Market order: United States first, then UK/Ireland, then other regions.**
Pricing in USD; the app already carries currency per club, so £/€ follow.

Everything below obeys the one rule that shapes the whole business model:
**TourneyHQ calculates and records money; it never moves it** (hard rule 7).
That is not a limitation to apologise for — it is the wedge. See §3.

---

## 1. TL;DR — the recommendation

Move from today's two tiers (**Free** and **Club $29/mo**) to a **four-rung
ladder**, priced per *organization* (players are free forever), billed monthly
or annual (two months free on annual):

| Tier | Who | Price (proposed) | The one-line reason to buy it |
|---|---|---|---|
| **Free** | a golfer, a one-off | $0 | Run one event or a casual round, beautifully, for nothing. |
| **Society** | societies, leagues, outings | **$12/mo · $120/yr** | Unlimited events, a season table, and the money worked out — without a spreadsheet. |
| **Club** | golf clubs, serious leagues | **$29/mo · $290/yr** | Everything a committee needs to run the season, at a tenth of Golf Genius. |
| **Association** | state/regional golf associations, multi-club, white-label | **from $2,000/yr, quote** | Every club's competitions in one place, in your brand. |

The headline pitch, the sentence for the pricing page and the sales call:

> **Golf Genius runs championships for committees. TourneyHQ runs the golf your
> members actually play — medals, matches, leagues, outings, four-balls,
> skins — beautifully, on a phone, for a tenth of the price, and it never
> touches your money.**

Keep **Club at $29/mo**: it is already live, it already reads as fair against a
$2,500–3,500/yr incumbent, and moving it now would punish today's customers.
Add **Society** *below* it (the biggest missed market) and **Association**
*above* it (the only credible enterprise story). The new **Society** rung is the
growth engine; **Association** is the margin.

---

## 2. The pitch — against Golf Genius and the closest apps

The US market splits into four camps. TourneyHQ can beat each on the ground it
actually competes for, and should say so explicitly.

### 2a. Golf Genius — the giant to pitch against

**What they are.** The US market leader. Powerful, all-in-one, trusted by the
PGA and championship committees. Per-event from **$99** (≤50 players) up to
**$499+**; club/association "TM" subscriptions around **$2,500–$3,500/yr** (often
bundled "free" through a state/regional golf association, with a paid Premium
upsell), plus a **$500** onboarding fee. ([FSGA][fsga], [pricing][gg-pricing],
[LiveTourney][lt])

**Where they win:** professional championships, deep committee tooling,
association-scale operations, integrations, brand trust.

**Where they are beatable, and TourneyHQ's line for each:**

- **Price.** *"A tenth of the cost, and no onboarding fee."* $290/yr vs
  ~$3,000/yr + $500 setup. For a members' club running medals, a men's/ladies'
  league, or an outing, Golf Genius is priced for a championship budget they
  don't have.
- **Simplicity.** *"Your committee sets up a medal in two minutes, on a phone,
  not on a training call."* Golf Genius is powerful because it is complex;
  TourneyHQ's north star is "simple but effective and impressive." The setup
  flow, one-tap score entry, the live board a member reads in the sun — that is
  the product.
- **The player experience.** *"Your members get an app they enjoy, not a portal
  they tolerate."* A fixed, sun-legible scoreboard; a card that matches the paper
  one exactly; a live leaderboard that reads correctly down the column.
- **Money games, honestly.** *"Skins, Nassau, 2s and split costs worked out to
  the penny — and we never hold a dollar of it."* Golf Genius has money features;
  TourneyHQ makes them the point, and makes *not touching the money* a feature
  (§3).
- **Leagues and outings.** Golf Genius is championship-shaped. TourneyHQ runs the
  men's league, the order-of-merit, the interclub pairs league, the member-guest
  four-ball, the corporate outing — the golf most golfers actually play.

**Where NOT to fight them:** national championships, tour operations, deep
handicapping authority. Concede it. TourneyHQ is not the USGA's software; it is
the club's, the league's, and the outing's.

### 2b. The charity/outing camp — GolfStatus, EventCaddy, PlayThru

**How they make money is the whole difference.** GolfStatus is **free to
nonprofits** and earns via a **contingent Technology Sponsorship (~$899, only if
it sells)** plus fundraising add-ons (mulligans, raffles, contests); EventCaddy
is **~$199/feature/yr** with online **registration and payment** processing.
Their revenue rides on **moving the event's money**. ([GolfStatus][gs],
[EventCaddy][ec])

**TourneyHQ's line:** *"They pay for their software out of your fundraiser.
We don't touch your money at all."* For a members' club, a recurring league, or
a member-guest — *not* a one-off charity scramble — a platform that skims
sponsorships or holds entry fees is the wrong shape. TourneyHQ's subscription is
honest and predictable, with no payment rail to reconcile, refund, or trust.
Concede the pure charity-scramble-once-a-year buyer to GolfStatus; win the club,
league, and outing that runs *many* events a year.

### 2c. The league tools — Golf League Network, LeagueLeader

Niche, functional, unglamorous, often desktop-era. TourneyHQ's interclub pairs
league, weekly attendance, season table and live board already match or beat
them on experience. The line: *"Your league, on a phone, that looks like this
century."* A credible **Society**-tier feature set closes this without a
dedicated product. Handicaps post back to **GHIN** (§6).

### 2d. Internationally — the UK incumbent (HowDidiDo / ClubV1 / intelligentgolf)

For the UK/Ireland expansion (phase two), the closest competitor is **Club
Systems' HowDidiDo / ClubV1 / intelligentgolf**, connecting **1M+ golfers across
2,000+ clubs**, bundling official **CONGU/WHS handicapping**, membership admin,
tee booking and competitions; the member app is **£2.99–£9.99/yr** and the club
software is sold B2B, bundled with a club's WHS obligations. ([HowDidiDo][hdid],
[intelligentgolf][ig], [ClubV1][clubv1])

**Do not try to replace it — position beside it.** Most UK clubs *must* have a
CONGU/WHS system; that is not the fight. It is admin-first, dated, and weak on
leagues, outings, fun formats and the day-of experience. TourneyHQ's line there:
*"HowDidiDo keeps your handicap. TourneyHQ runs the competition — and posts the
scores back to your WHS record."* This is a phase-two story; the US market
(GHIN) is first.

---

## 3. Why subscription, and why "we never move money" is a strength

TourneyHQ cannot — and by rule will not — take a cut of entry fees, hold a
purse, or process a sponsorship. That rules out the GolfStatus/EventCaddy
transaction model entirely. The only honest engine is **SaaS subscription**.

Frame it as trust, because that is what it is:

- **No middleman on the members' money.** Skins, the sweep, the split cart fees —
  worked out to the penny and handed back as a record; the cash stays between the
  members and the pro shop. Clubs and league treasurers *distrust* a platform
  that sits in the money path.
- **Predictable cost.** A flat annual fee, not a percentage that grows with the
  club's own fundraising success.
- **No PCI, no refunds, no chargebacks, no payout delays** — for the club or for
  TourneyHQ. The product stays simple because the money stays out of it.

So the pricing page should say, plainly: **"We do the math. You keep the
money."** It is a differentiator GolfStatus and EventCaddy structurally cannot
copy.

---

## 4. The tier ladder in detail

Priced **per organization**, not per player — players are free forever (already
a rule, and the single best acquisition engine: every event puts the app in a
member's hand for nothing).

### Free — "run one, for nothing"
The hook and the try-before-buy. A single golfer's casual rounds, or one live
tournament at a time, one organizer, TourneyHQ branding, **history not
guaranteed to be kept**. Enough to run a real event and fall in love; capped so a
club outgrows it in one season.

### Society — $12/mo · $120/yr — *the new rung, and the growth engine*
For societies, recurring leagues, outings and member-guests. **Unlimited
tournaments**, **up to 3 organizers**, the **season/order-of-merit table**,
**weekly leagues with attendance**, **all the money games** (skins, Nassau, 2s,
split costs), the **full player app**, **basic prize lists**, kept history, light
SMS. This is the biggest under-served US market and the rung most competitors
ignore — Golf Genius is too dear, GolfStatus wrong-shaped, the league tools too
ugly.

### Club — $29/mo · $290/yr — *the flagship, vs Golf Genius*
Everything in Society, plus **up to 10 committee seats**, **full branding /
white-label** (TourneyHQ mark removed), **card-photo scanning**, **AI drafting**
(commentary, invitations, setup), **GHIN score posting**, **custom prize
structures and templates** (see §5), **priority support**, and the advanced
formats a club championship needs (cuts, multi-flight, split/plate knockouts,
36-hole gross). Keep the price at **$29** — it is live, it is fair, and against
~$3,000/yr it is the obvious choice.

### Association — from $2,000/yr, quote — *the margin, vs BlueGolf/Golf Genius association*
State/regional golf associations, groups, and multi-club operators. Everything in
Club across **many clubs**, plus the **multi-club owner console** (§6),
**white-label + custom domain**, **SSO**, **an API/export**, and **aggregate
analytics** across member clubs. Quote-based, land-and-expand; one association
sells many clubs at once — which is exactly how Golf Genius and BlueGolf grew.

---

## 5. Feature-gating matrix

| Capability | Free | Society | Club | Association |
|---|:--:|:--:|:--:|:--:|
| Casual rounds | ✅ | ✅ | ✅ | ✅ |
| Live tournaments at once | 1 | ∞ | ∞ | ∞ |
| Organizer / committee seats | 1 | 3 | 10 | custom |
| Formats: medal, Stableford, matchplay | ✅ | ✅ | ✅ | ✅ |
| Four-ball / foursomes / scrambles | ✅ | ✅ | ✅ | ✅ |
| Cuts, multi-flight, knockouts (split/plate) | — | ✅ | ✅ | ✅ |
| Weekly leagues + season table | — | ✅ | ✅ | ✅ |
| Money games (skins, Nassau, 2s, splits) | view | ✅ | ✅ | ✅ |
| **Prize lists (basic)** | ✅ | ✅ | ✅ | ✅ |
| **Custom prize structures + templates** | — | — | ✅ | ✅ |
| Player app + public live board | ✅ | ✅ | ✅ | ✅ |
| History kept for good | — | ✅ | ✅ | ✅ |
| SMS to the field | — | lite | full | full |
| Card-photo scanning | — | — | ✅ | ✅ |
| AI drafting | — | — | ✅ | ✅ |
| GHIN / WHS posting | — | — | ✅ | ✅ |
| Branding / white-label | — | — | ✅ | ✅+domain |
| Multi-club owner console | — | — | — | ✅ |
| Aggregate analytics / API / SSO | — | — | — | ✅ |
| Support | community | email | priority | dedicated |

The value metric that scales price is **breadth and permanence** (how many
events, how many committee hands, kept how long, in whose brand) — never
per-player, which stays free.

---

## 6. Where the two features you asked for land

**Customizable prize control (§5, "custom prize structures").** Today's Prizes
screen takes a flat list (category · detail · amount). The upgrade — per-place
splits, flight/division prizes, auto-split rules tied to the standings, saved
templates a club reuses each medal, and nearest-pin/longest-drive/specials as
first-class lines — is a natural **Club-tier** differentiator. Basic prize lists
stay free so every tier can name a winner; the *structure and reuse* is what a
club pays for. (It records prizes; it never pays them — hard rule 7 holds.)

**Owner analytics console.** Two distinct things, do not conflate them:
1. **The platform owner's console (yours).** Internal, owner-only: clubs signed
   up, tier mix, MRR/ARR, active tournaments, engagement, churn signals, GHIN
   posting volume, "anything worth your attention." Not a customer tier — it is
   how *you* run the business. Build it behind a hard owner-only gate.
2. **An association/club's own analytics.** Their engagement and usage, an
   **Association** perk (and a lighter Club view). Different audience, different
   data scope.

Both are detailed as build proposals in the companion docs; this proposal only
places them in the model.

---

## 7. Rollout, migration, and risks

- **Grandfather everything.** Every current Club stays Club at $29; the existing
  `eventCount > 0` "don't touch an existing org" instinct applies to pricing too.
- **Introduce Society first.** It is additive (a new rung below Club), needs only
  seat/among-tournament limits already modelled, and captures demand Club's price
  turns away. Ship it, measure conversion from Free.
- **Association later.** It depends on the multi-club owner console; sell the
  first one or two by hand ("quote") before productising.
- **Annual billing** (two months free) smooths cash and cuts churn; there is no
  payment rail in-app, so billing is arranged directly (as the Club plan already
  says) or through a standard external subscriptions provider that bills for
  *software* — which is not the same as moving an *event's* money, and does not
  breach rule 7.
- **Risks to name:** (a) Society could cannibalise Club — mitigate with the seat
  cap and branding/white-label being Club-only, the two things a real club wants;
  (b) US GHIN access — confirm the club's GHIN service relationship for posting;
  (c) support load at $12/mo — mitigate with community + email only at Society.

---

## 8. Open decisions for you

1. **The Society price:** $12/mo is a proposal. $9 grows faster; $15 protects
   Club. Your call on how aggressively to buy the society/league market.
2. **Region rollout:** US ($/GHIN) first is set. When does UK/IE (£/WHS) turn on,
   and is it a marketing switch or a feature gate?
3. **Association floor:** $2,000/yr is a placeholder; a state association with
   dozens of clubs is worth far more, but the first one is a reference sale —
   price it to win.
4. **Casual (Free) generosity:** exactly one live tournament, or a small season
   allowance, before Society is required?

None of these blocks building the two features — they slot into the tiers
whatever the final numbers.

---

## Sources

- Golf Genius pricing & positioning: [FSGA — About Golf Genius][fsga] · [Golf Genius pricing][gg-pricing] · [LiveTourney: best golf tournament software 2026][lt]
- GolfStatus model: [GolfStatus FAQ / Golf for Good][gs]
- EventCaddy: [Capterra — Event Caddy][ec]
- UK incumbents (phase two): [HowDidiDo][hdid] · [intelligentgolf][ig] · [ClubV1 / Club Systems][clubv1]

[fsga]: https://www.fsga.org/sections/Clubs/About-Golf-Genius/868
[gg-pricing]: https://share-cdn.golfgenius.com/products/tm/pricing
[lt]: https://www.livetourney.com/blog/best-golf-tournament-software
[gs]: https://golfstatus.com/faqs
[ec]: https://www.capterra.com/p/166084/Event-Caddy/
[hdid]: https://apps.apple.com/gb/app/howdidido/id6742023251
[ig]: https://www.intelligentgolf.co.uk/
[clubv1]: https://www.clubsystems.com/products/club-management-with-clubv1
