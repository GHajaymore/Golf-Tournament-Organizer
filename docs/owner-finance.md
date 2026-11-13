# The owner's books (B44) — the Finance tab on /owner

A record of what TourneyHQ earned and spent. Not accounting or tax advice. **It records; nothing moves money**
(CLAUDE.md, Hard rule 7). Owners on `OWNER_EMAILS` only: a club Admin, a pilot on `SIGNIN_ALLOW_EMAILS` and a
signed-out visitor get the 404 the console gives, and each of the three actions asks `isOwner` itself.

Spec and the deciding session's rulings: the Finance Director's "Spec - Owner P&L (B44)", 12 Nov 2026.
Rulings in force: its own tab (A); the projection only here, in its own box "Projection — not revenue", never totalled
with revenue (B); dollars, with the original amount in small type (C); Albatross only as a manual invoice (G); comped
clubs as zero revenue plus a count (H).

## What is in PR 1 (migration `A042_owner_finance`)

- **Tables** — `CostEntry` (typed costs; edited by a new row that supersedes, deleted only by a void with a reason),
  `FxRate` (millionths of a US dollar per whole unit, one row per currency, day and source), `BillingRecord` (the
  contract billing will write into; empty until billing exists; `providerRef` is unique so a repeated webhook is one row).
- **`src/lib/domain/finance.ts`** — the arithmetic, pure. Minor units only; BigInt wherever it divides; rounded
  once per row, half away from zero, then summed; a currency is never mixed; the rate used travels with the figure;
  a month missing hosting or the database, or a rate, is *incomplete*. `finance-input.ts` reads the two forms'
  boxes (`minorUnitsFrom` in the chosen currency, `moneyBoxRefusal`).
- **Services/actions/route** — `services/owner-finance.ts`, `actions/owner-finance.ts` (`addCostEntry`,
  `voidCostEntry`, `saveFxRate`), the CSV at `/owner/finance-export` (no club, no player, no id; free text made safe
  for a spreadsheet; never cached).
- **Screen** — `OwnerFinance.tsx`. Revenue reads "no billing yet", never zero; margin is a dash until there is revenue.
  Overview keeps one tile with "See projection in Finance".

## Not yet (later changes)

Automatic cost reads (Vercel, SMS segments), the daily published-rate fetch (rates are typed for now), revenue read
from `BillingRecord` (recognition, refunds, discounts, per active club), editing a cost (void and re-enter until then),
a monthly line on the status board (ruling J).

## Tests

`finance.test.ts` (worked by hand + properties), `finance-has-no-floats.test.ts`, `owner-finance.audit.test.ts`
(real rows: who may touch the books), `e2e/owner-finance.spec.ts`. Money arithmetic: three rounds.
