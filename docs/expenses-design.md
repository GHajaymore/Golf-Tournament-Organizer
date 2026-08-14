# Shared expenses — design brief

**Status:** not started. This is the spec, written 2026-08-12 so the build can
begin cold without re-deriving the reasoning.

Players on an outing or trip record what they spent, split it, and settle up —
**together with the side games they already play in this app.**

---

## 1. Why this belongs here rather than in Splitwise

Splitwise splits costs, free, and does it well. Copying it adds nothing.

The feature worth building is the **one ledger**: Dave owes $40 in skins, lost
$20 on the Nassau, and paid $260 for dinner — and the app produces **one net
number**. No general expense app can ever do that, because it does not know the
golf. That is the entire reason to build this, and it should drive every
design decision. If a choice makes the combined settle-up worse, it is the
wrong choice.

**The standing principle holds unchanged: the app calculates and records money,
it never moves it.** No payment rail, no wallet, no transfers. That is also
what keeps this cheap — no PCI, no money-transmitter surface.

---

## 2. Reuse — do not write new money maths

Two tested functions already exist in `src/lib/domain/skins-pot.ts`:

```ts
splitExactly(totalCents: number, weights: number[]): number[]
```
Exact proportional split, never loses or invents a cent; the odd penny goes to
the biggest fractional part, index order settling a dead heat.

```ts
settle(nets: Array<{ playerId: string; netCents: number }>): Transfer[]
```
Minimal transfer list — who hands what to whom. Verified over 3,000 randomised
weeks: every settlement left every player exactly square, with no zero and no
self-transfers.

**The expense module's job is to produce `nets`. It must not re-implement
settlement.** Two settlement implementations that can disagree about money is
the exact defect class the 2026-08-12 audit was full of.

Consider moving both helpers to a neutral `src/lib/domain/money.ts` so neither
feature owns the other's maths. Cheap now, awkward later.

---

## 3. Domain module — `src/lib/domain/expenses.ts`

Pure. No Prisma import, so it is testable without a database.

```ts
export interface ExpenseShare {
  playerId: string;
  /** Relative weight. 1 each = even split. 0 excludes without deleting. */
  weight: number;
}

export interface Expense {
  id: string;
  description: string;
  amountCents: number;
  /** Who actually paid the bill. */
  paidBy: string;
  shares: ExpenseShare[];
}
```

Functions:

- `shareOf(expense): Map<playerId, cents>` — via `splitExactly`. **Must sum to
  `amountCents` exactly.**
- `balances(expenses, playerIds): Array<{ playerId, netCents }>` — positive is
  owed to them, negative is owed by them. **Must sum to zero.**
- `combinedBalances(expenseNets, gameNets)` — merges the expense ledger with
  the side-game ledger (skins pot, Nassau). This is the differentiator; give it
  its own function and its own tests.

Then hand the result to the existing `settle()`.

### Invariants to assert (the whole point)

1. Every split sums **exactly** to the expense total — no cent lost or invented.
2. Balances sum to **zero** across the field.
3. After settlement, every player is exactly square.
4. No zero transfers, no self-transfers.
5. Combining expenses with side games conserves both totals.
6. Randomised property test — mirror the skins-pot one: N players, random
   amounts, random weights, some excluded, and assert 1–4 hold every time.

Edge cases that must behave: an expense paid by someone not in its own split;
a single-player split; an expense with every weight 0; a zero-amount expense; a
negative amount (refund — decide explicitly whether to allow, and say so).

---

## 4. Schema

Additive, two tables. Follow the house conventions: `cuid()` ids, `eventId`
scoping, empty string rather than null for "not set", **integer cents** for all
money (never a float).

```prisma
model Expense {
  id          String   @id @default(cuid())
  eventId     String
  /** Optional round. Empty means the whole outing. */
  stageId     String   @default("")
  description String
  amountCents Int
  /** Player id of whoever paid. */
  paidBy      String
  /** Free-text category: green fees, cart, lodging, dinner, other. */
  category    String   @default("")
  spentOn     String   @default("")   // ISO date, calendar day (see round-dates.ts)
  createdBy   String   @default("")
  createdAt   DateTime @default(now())
  shares      ExpenseShare[]
  @@index([eventId])
}

model ExpenseShare {
  id        String @id @default(cuid())
  expenseId String
  playerId  String
  weight    Int    @default(1)
  expense   Expense @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  @@index([expenseId])
}
```

Note `onDelete: Cascade` on shares — and be aware that `Player` rows are
**hard-deleted** today with no cascade (audit D3), so an expense can end up
pointing at a dead player id. Either fix the withdraw path first or make the
UI tolerate an unknown payer rather than crashing.

A `settled` marker is deliberately **not** in v1 — see section 7.

---

## 5. Server actions — `src/app/actions/expenses.ts`

Follow `attendance.ts`, which the security audit named as the model.

- `addExpense`, `updateExpense`, `removeExpense`
- Guard: staff, **or** the player who created it, for their own rows.
- Every action must scope every id to `session.eventId`, and re-query
  `playerIds` against this event's confirmed field rather than trusting the
  client — copy `setSkinsEntrants`, which does this correctly.
- **Audit-log every write.** Money actions in this app currently do not, and
  the audit called that out. Do not repeat it.
- Validate `amountCents` is a finite integer within sane bounds before it
  reaches any maths.

---

## 6. UI — the part that actually costs the time

Mobile-first, in the player shell (`src/app/(player)/`), as a fifth tab beside
Today / Board / My card / Rules. The splitting logic is easy; the interaction
design is the work. Budget accordingly.

**The screen opens on one number** — what you owe, or are owed, net of
everything including side games. Most people open this to see that number and
nothing else.

**Adding an expense is three taps.** Defaults: paid by me, split evenly,
everyone in. The common case should need only an amount and a label. Anything
more (uneven weights, excluding someone) is a disclosure behind that.

**Settle up** is a plain list — "Dave → you $40" — with a mark-as-settled that
records the fact. The app is not moving the money and the copy should never
imply otherwise.

Two rules taken straight from today's audit:

- **Never render a split that does not sum to the total.** The week view
  currently shows a refunded skins pot as if everyone won money — correct
  arithmetic, wrong display. In an expense ledger that is the bug that ends
  friendships.
- Show the combined figure and let people expand into its parts. Hiding the
  side games makes the number look wrong to whoever remembers the bet.

Touch targets 44px on coarse pointers, both themes, and it must pass the
filesystem-derived layout sweep like every other route.

---

## 7. Explicitly NOT in v1

- **Multi-currency.** A tax on every calculation and every display. Add it when
  somebody actually books Portugal.
- **Receipt OCR.** Tempting because the scorecard vision path exists, but it is
  a nice-to-have that will eat a week.
- **Settlement state machine.** Record that a settle-up happened; do not model
  partial payments, reminders or confirmations yet.
- **The trip planner** — flights, lodging, itineraries. Different product,
  different competitors, no golf moat. Expenses is adjacent to something this
  app already owns; itineraries are not.

---

## 8. Sequencing

This should land **after** the open security holes and after #88, one real
tournament run end to end. Two reasons, and the second matters more:

1. The differentiator depends on the side-game ledger being trustworthy. Built
   on shaky skins code, a money bug now has double the blast radius.
2. That first real event will tell you what people actually expensed, which
   beats guessing at the split rules.

Build order when it starts: domain module + tests → schema + migration →
actions → UI. The domain module is worth doing first regardless; it is
self-contained and everything else depends on its shape.
