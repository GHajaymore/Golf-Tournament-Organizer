# Corporate membership (multi-club under one corporation)

**Status: not built. This is the design for when a corporate deal justifies it —
and the reason it is safe to sell before it exists.**

The landing carries an **Ultimate "Let's talk" tier** for associations,
corporates, and multi-venue operators (an Arcis-type group that runs many
clubs). It is a *contact* tier by design: its copy names no capability the code
does not have, because the engine described below is not built. See
`src/app/page.tsx` (the pricing section) and the note that keeps that card
honest.

## Why we can sell it before building it

The commercial value of "corporate" is two things: **one operator across all our
clubs, and one bill.** Both can be served today, by hand, for the first one or
two customers — with no new code:

- **One operator across clubs.** Access already keys on `accessibleEvents(email)`
  / `effectiveAccess`, resolved from the person's `Account` rows. Give one person
  an admin `Account` on each of the corporation's club `Organization`s and a
  single login reaches all of them.
- **One bill.** Invoice the corporation offline. `Subscription` is per-org today;
  a manual arrangement covers a bespoke deal.

So the first deals are an **operations** problem, not an engineering one. Build
the engine when there are enough corporates that manual onboarding and billing
stop scaling — matched to revenue, not ahead of it.

## Current state (what the engine assumes today)

- `Organization` (`prisma/schema.prisma`) is **flat**: `kind` is
  `club | community | personal`, with **no parent / holding / corporation**
  field and no self-relation.
- **Everything is `organizationId`-scoped** — events, courses, roster, money,
  subscriptions. This scoping is the app's core tenancy boundary and its main
  security property.
- **Billing is per-org** (`Subscription`, `PLANS`, `effectiveLimit` /
  `effectivePrice`).
- **Order of merit / Series** aggregates a season **within one organization**,
  never across clubs.
- The **interclub league** models competing clubs as **flights (`Group`) inside
  one event**, not as separate orgs under a parent. That already covers "clubs
  play each other in one competition"; it is *not* a corporate/tenancy structure.

## The plumbing, phased by risk

### Phase A — foundation (additive, low-risk)

The core corporate value — one login across our clubs, one bill — without
touching the scoring engine.

1. **A `Corporation` (parent) model**, and a **nullable** `corporationId` on
   `Organization`. Nullable is the whole trick: every existing club has no
   parent and behaves exactly as today. No backfill, no behaviour change for
   standalone clubs.
2. **Consolidated billing.** Resolve plan and limits from the parent first;
   child orgs inherit the corporation's `Subscription`. A contained change to the
   plan/limit resolver (`effectiveLimit` / `effectivePrice` and
   `services/limits.ts`), guarded so a child org with no parent still resolves
   its own plan.
3. **Corp-admin access — the security-critical piece.** A corporation admin gets
   admin on every child org. This MUST be implemented in the **one** access
   resolver the whole app already trusts (`accessibleEvents` /
   `effectiveAccess`): widen the set of orgs/events that resolver returns, so
   every downstream `organizationId` check keeps holding unchanged, just over a
   wider accessible set. **Do not** scatter a `parentId === parentId` check
   anywhere else — a second reader of "who can see this org" is exactly how a
   cross-tenant leak happens (the app's whole tenancy safety rests on there
   being one). Extend `audit-idor` and add a dedicated cross-tenant test:
   a corp admin reaches their children and **no** org outside their corporation.

### Phase B — read-only rollup

4. **A cross-club dashboard and an order of merit that AGGREGATES child-org
   standings.** Read-only: it rolls up results already computed per event, so it
   cannot corrupt any single event's scoring. This is where "orders of merit
   across clubs" becomes real, safely. Model it as a corporation-level view over
   the children's existing standings, not a new scoring path.

### Phase C — only if a customer demands it (defer)

5. **True cross-club fixtures** (a league whose rounds span clubs) and **members
   shared across clubs**. Large, and mostly unnecessary: the interclub-as-flights
   model already handles clubs competing in one event, and rosters are per-org
   for good reasons. Build only against a paid requirement.

## The one rule that matters

The risk here is not the schema — it is the access model. The app is safe today
because access is `organizationId`-scoped through a single resolver. The
corporate layer earns its keep only if "this operator sees all our clubs" lives
in **that** resolver and nowhere else, and is covered by the IDOR sweep and a
cross-tenant test. Get that wrong and one corporation sees another's members;
get it right and Phase A is a small, safe change.

## Related

- The Ultimate tier's honest copy: `src/app/page.tsx`, pricing section.
- Org merge was considered and not built — a neighbouring tenancy question.
- Pricing ladder and positioning: the pricing decision doc / owner console
  (`/owner`, `plans.ts`).
