# Monetization runbook — what is built, and how to switch it on

Written 2026-09-23. This records the monetization system shipped over the night
of 2026-09-23 and the exact remaining steps to take money. Nothing here needs a
code change to go live; it needs a payment provider connected and two or three
environment values set.

## The tiers, as built

Priced per **organization** — players are free forever, by rule.

| Tier | Monthly | Annual (2 months free) | Limits | White-label |
|---|---|---|---|---|
| **Free** | $0 | — | 1 active tournament, 1 organizer | no |
| **Society** | $12 | $120 | unlimited tournaments, 3 organizers | no |
| **Club** | $29 | $290 | unlimited tournaments, 10 organizers | yes |

Definitions live in `src/lib/plans.ts` (`PLANS`). The season table, all money
games, the player app and the public board are on every paid tier; the metered
features (SMS, card scan, AI drafting) are built but switched off on all tiers
until there is revenue to cover their per-use carrier/model cost.

## What already works today (no billing needed)

- **Prices are configurable without a deploy.** Set `TOURNEYHQ_PRICING` in
  Vercel, e.g. `{"plans":{"society":{"monthly":9},"club":{"monthly":39}}}`.
  Every surface — landing page, settings panel, schema.org offer, and the owner
  console's MRR — reads the override through `effectivePrice` /
  `effectiveAnnualPrice`. Malformed values fall back to the code default.
- **The owner console** at `/owner`, gated on `OWNER_EMAILS` (comma-separated
  allow-list). Set `OWNER_EMAILS=golferajay@gmail.com` in Vercel to turn it on;
  it 404s for everyone else. It shows organizations, tier mix, projected
  MRR/ARR, onboarding drop-off, live tournaments and newest signups — counts
  only, never player PII.
- **The pricing page and plan panel** show all three tiers and the annual price.
- **Limits are counted and shown honestly** (`limitStatus`), but not enforced —
  see below.

## Enforcement is built and dormant — this is the key point

`src/lib/services/limits.ts` already enforces the plan limits, and the refusal
is already wired into every creation path:

- `refusalFor(orgId, "activeEvents")` — creating a tournament
  (`tournament.ts`), cloning one, and the setup flow.
- `refusalFor(orgId, "staffSeats")` — adding staff (`organization.ts`,
  `join.ts`, `tournament.ts`).
- Casual rounds are deliberately NOT counted (`match-setup.ts`).

`limits.test.ts` pins that these calls exist. The refusal **allows
unconditionally until a payment provider is attached**:

```
enforcementActive(orgId) === true  ⇔  the org's Subscription.provider is non-empty
```

So the tiers begin to bite the moment a subscription row has a `provider` set —
with **no code change**. Until then nothing is refused, which is correct: a
limit with no paid tier to buy is an outage, not a business model.

## To take money — the remaining steps

The app never moves an event's money (hard rule 7). A **subscription** bills for
software, which is a different thing and is fine; it just lives outside the
tournament money code entirely.

1. **Connect a provider through the Vercel Marketplace** (Stripe is the obvious
   one). Do this via the marketplace integration flow rather than hand-wiring an
   SDK, so keys and webhooks are provisioned properly. This is the step that
   needs your account and a few decisions; it is not something to script blind.
2. **Create the products/prices in the provider** to match `PLANS` — Society and
   Club, monthly and annual. Keep the numbers in sync with `TOURNEYHQ_PRICING`
   (or leave `TOURNEYHQ_PRICING` unset and let the code defaults be the truth).
3. **On a completed checkout / subscription webhook, write the org's
   `Subscription` row**: set `plan` to the tier, `provider` to e.g. `"stripe"`,
   `status`, `providerCustomerId`, `providerSubscriptionId`, `currentPeriodEnd`.
   The schema already has every one of these columns. Setting `provider` is what
   flips `enforcementActive` on for that org.
4. **On cancellation / past_due**, update `status` (and clear `provider` if you
   want enforcement to stop). `planFor` falls back to free for an unknown or
   missing plan, so a lapsed org degrades safely to the free limits rather than
   locking anyone out of their own data.
5. **Add a checkout entry point** — an "Upgrade" button on the plan panel that
   starts the provider's checkout for the chosen tier and billing period.

That is the whole of it. The pricing, the tiers, the limits, the enforcement and
the owner-side visibility are done; the provider is the missing wire.

## Environment values to set in Vercel

| Key | Purpose | Needed for |
|---|---|---|
| `OWNER_EMAILS` | owner-console allow-list | the owner console |
| `TOURNEYHQ_PRICING` | price overrides (optional) | changing a price without a deploy |
| `CRON_SECRET` | casual-round expiry sweep | the nightly `/api/cron/expire-rounds` |
| *(provider keys)* | subscription billing | taking money |

## The positioning, in one line

Against Golf Genius's ~$3,000/yr for a club: **$290/yr, simpler, with the money
games and a player app members enjoy — and we never touch your money.** The full
argument and the competitor comparison are in
`docs/monetization-and-tiers-proposal.md`.
