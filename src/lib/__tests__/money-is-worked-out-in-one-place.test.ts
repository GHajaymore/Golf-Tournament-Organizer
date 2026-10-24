import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * MONEY IS WORKED OUT IN THE MONEY MODULE, AND IT IS NEVER MOVED (foundation
 * pass, layer 8, 2026-10-23).
 *
 * Two rules, each a sweep with a control:
 *
 * 1. THE ARITHMETIC OF A POT IS IN `src/lib/domain`'s money files. What a pot
 *    holds (`potCents`), how it divides (`splitExactly`) and who hands what to
 *    whom (`settle`) are each one function. The re-measure that wrote this
 *    found the pot multiplied out by hand in six places, and the tournament
 *    report multiplying by the wrong count — the players whose net was not
 *    nought — so a pot of five with three breaking even read "2 in".
 *
 * 2. TOURNEYHQ CALCULATES AND RECORDS MONEY. IT NEVER MOVES MONEY (CLAUDE.md,
 *    hard rule 7). The one payment provider the app talks to is for the club's
 *    own subscription, and it lives in `services/billing.ts` and its webhook.
 *    No other file may import it, nothing may call a transfer or a payout, and
 *    billing may not read the players' ledger — so a side game, a skins pot or
 *    a shared cost can never become a charge.
 */

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      sources(rel, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}
const FILES = sources("src");

/** The money module: the files that hold a side game's or a shared cost's arithmetic. */
const MONEY_MODULE = new Set(
  [
    "money",
    "money-layout",
    "money-breakdown",
    "money-mode",
    "money-rules-version",
    "money-format",
    "derived-games",
    "skins-pot",
    "skins",
    "nassau",
    "contests",
    "expenses",
    "pot-entry",
  ].map((m) => `src/lib/domain/${m}.ts`),
);

/** Outside the module and allowed, each with its reason. May only shrink. */
const ALLOWED: Record<string, string> = {
  "src/components/MoneyClient.tsx": "the entry form's preview, printed as \"about … each\" while a bill is typed",
};

const POT_BY_HAND = /\b\w*(?:buyIn|stake)Cents\s*\*|\*\s*[\w.]*(?:buyIn|stake)Cents\b/;
const DIVIDED_BY_HAND = /[cC]ents\)?\s*\/\s*[\w.]+\.length\b/;
const SPLIT_OR_SETTLE_WRITTEN = /function\s+(?:splitExactly|settle)\s*\(/;

describe("the arithmetic of a pot is in the money module", () => {
  it("CONTROL: the sweep recognises the lines it replaced, and not a stake read or formatted", () => {
    expect(POT_BY_HAND.test("potCents: c.buyInCents * m.entrants.length,")).toBe(true);
    expect(POT_BY_HAND.test("${money(g.buyInCents * nets.length)} pot.")).toBe(true);
    expect(POT_BY_HAND.test("const pot = stakeCents * players.length;")).toBe(true);
    expect(DIVIDED_BY_HAND.test("const each = Math.floor(Math.abs(cents) / shareIds.length);")).toBe(true);
    expect(POT_BY_HAND.test("const cents = Math.round(Number(buyInCents));")).toBe(false);
    expect(POT_BY_HAND.test("potCents: potCentsOf(g.buyInCents, membership.entrants.length),")).toBe(false);
    expect(SPLIT_OR_SETTLE_WRITTEN.test("export function settle(nets: Net[]): Transfer[] {")).toBe(true);
  });

  it("finds the app at all", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.filter((f) => MONEY_MODULE.has(f)).length).toBe(MONEY_MODULE.size);
  });

  it("no pot is multiplied out, or money divided by a head count, outside it", () => {
    const strays = FILES.filter((f) => !MONEY_MODULE.has(f) && !(f in ALLOWED)).filter((f) => {
      const src = readSource(f);
      return POT_BY_HAND.test(src) || DIVIDED_BY_HAND.test(src);
    });
    expect(strays, "ask potCents(stake, entrants) or splitExactly(total, weights) in domain/money.ts").toEqual([]);
  });

  it("there is one split and one settle-up, in domain/money.ts", () => {
    const writers = FILES.filter((f) => SPLIT_OR_SETTLE_WRITTEN.test(readSource(f)));
    expect(writers).toEqual(["src/lib/domain/money.ts"]);
  });

  it("every exemption is still a real file that still does it", () => {
    for (const f of Object.keys(ALLOWED)) {
      expect(FILES, f).toContain(f);
      const src = readSource(f);
      expect(POT_BY_HAND.test(src) || DIVIDED_BY_HAND.test(src), `${f} is exempted but no longer does it`).toBe(true);
    }
  });
});

describe("TourneyHQ records money and never moves it", () => {
  const PROVIDER = /from\s+["'](?:stripe|@stripe\/[\w-]+|paypal[\w/-]*|@paypal\/[\w-]+|braintree|square|@square\/[\w-]+|plaid|@adyen\/[\w-]+)["']/;
  const MOVES_MONEY = /\.(?:transfers|payouts|paymentIntents|charges|refunds)\.create\s*\(|api\.(?:stripe|paypal)\.com|venmo:\/\/|paypal\.me\//i;
  const BILLING = ["src/lib/services/billing.ts", "src/app/api/stripe/webhook/route.ts"];
  const LEDGER = /from\s+["'][^"']*(?:services\/expenses|services\/skins-pot|domain\/derived-games|domain\/skins-pot|domain\/expenses|domain\/contests|domain\/money)["']/;

  it("CONTROL: the sweep recognises a payment provider and a call that moves money", () => {
    expect(PROVIDER.test('import Stripe from "stripe";')).toBe(true);
    expect(PROVIDER.test('import { loadStripe } from "@stripe/stripe-js";')).toBe(true);
    expect(MOVES_MONEY.test("await stripe.transfers.create({ amount, destination })")).toBe(true);
    expect(MOVES_MONEY.test("await stripe.paymentIntents.create({ amount })")).toBe(true);
    expect(MOVES_MONEY.test('href={`venmo://paycharge?amount=${x}`}')).toBe(true);
    expect(MOVES_MONEY.test("const session = await stripe.checkout.sessions.create({")).toBe(false);
    expect(LEDGER.test('import { moneyFor } from "./expenses";')).toBe(false); // a relative import is read below
    expect(LEDGER.test('import { moneyFor } from "@/lib/services/expenses";')).toBe(true);
  });

  it("only the club's own billing imports a payment provider", () => {
    const importers = FILES.filter((f) => PROVIDER.test(readSource(f)));
    expect(importers.length, "the sweep found no billing at all").toBeGreaterThan(0);
    expect(importers.filter((f) => !BILLING.includes(f))).toEqual([]);
  });

  it("nothing anywhere makes a transfer, a payout, a charge or a payment link", () => {
    expect(FILES.filter((f) => MOVES_MONEY.test(readSource(f)))).toEqual([]);
  });

  it("billing reads nothing of the players' ledger", () => {
    for (const f of BILLING) {
      const src = readSource(f);
      expect(LEDGER.test(src), f).toBe(false);
      expect(/from\s+["']\.\/(?:expenses|skins-pot)["']/.test(src), f).toBe(false);
    }
  });
});
