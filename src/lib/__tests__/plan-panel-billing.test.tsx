import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/app/actions/billing", () => ({ startCheckout: vi.fn(), openBillingPortal: vi.fn() }));

import { PlanPanel } from "@/components/PlanPanel";
import { PLANS, parsePricingOverrides } from "@/lib/plans";

/**
 * The plan panel in its three billing states. With billing off it must read
 * exactly as before — the change is invisible until Stripe is configured — and
 * with it on, a club buys a plan it is not already on, or manages the one it
 * has, but never both.
 */

const NONE = parsePricingOverrides(undefined);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const panel = (planKey: string, billing?: { enabled: boolean; hasSubscription: boolean; pastDue: boolean; canEdit: boolean }) =>
  text(renderToStaticMarkup(<PlanPanel planKey={planKey} overrides={NONE} currency="USD" billing={billing} />));

describe("buying a plan from the plan panel", () => {
  it("with billing off, says plans are arranged directly and offers no button", () => {
    const body = panel("free", { enabled: false, hasSubscription: false, pastDue: false, canEdit: true });
    expect(body).toContain("Changing plan is arranged with us directly");
    expect(body).not.toContain("Manage billing");
    expect(body).not.toMatch(/Birdie · \$[\d,]+\/yr/);
  });

  it("with billing on, a Par club is offered Birdie and Eagle, yearly and monthly", () => {
    const body = panel("free", { enabled: true, hasSubscription: false, pastDue: false, canEdit: true });
    for (const p of [PLANS.society.name, PLANS.club.name]) {
      expect(body).toMatch(new RegExp(`${p} · \\$[\\d,]+/yr`));
      expect(body).toMatch(new RegExp(`${p} · \\$[\\d,]+/mo`));
    }
    expect(body).not.toContain("arranged with us directly");
    // Albatross is "Let's talk" and is never sold by a button.
    expect(body).not.toMatch(new RegExp(`${PLANS.enterprise.name} · \\$`));
  });

  it("never offers the plan the club is already on", () => {
    const body = panel("society", { enabled: true, hasSubscription: false, pastDue: false, canEdit: true });
    expect(body).not.toMatch(new RegExp(`${PLANS.society.name} · \\$[\\d,]+/yr`));
    expect(body).toMatch(new RegExp(`${PLANS.club.name} · \\$[\\d,]+/yr`));
  });

  /** A buy button's label — "Birdie · $490/yr" — not the plan cards' "$49/mo · $490/yr". */
  const BUY = new RegExp(`(${PLANS.society.name}|${PLANS.club.name}) · \\$[\\d,]+/(yr|mo)`);

  it("CONTROL: the buy-button pattern finds buttons when there are some", () => {
    expect(panel("free", { enabled: true, hasSubscription: false, pastDue: false, canEdit: true })).toMatch(BUY);
  });

  it("says where the card goes and how to stop, before the card is asked for", () => {
    const body = panel("free", { enabled: true, hasSubscription: false, pastDue: false, canEdit: true });
    expect(body).toMatch(/Stripe’s secure page — TourneyHQ never sees the card/);
    expect(body).toMatch(/Renews until you cancel/);
    // Only where something can be bought: the reassurance is about a purchase.
    const off = panel("free", { enabled: false, hasSubscription: false, pastDue: false, canEdit: true });
    expect(off).not.toMatch(/never sees the card/);
  });

  it("a club already paying manages billing instead — no second checkout", () => {
    const body = panel("society", { enabled: true, hasSubscription: true, pastDue: false, canEdit: true });
    expect(body).toContain("Manage billing");
    expect(body).not.toMatch(BUY);
  });

  it("says plainly when the last payment failed", () => {
    expect(panel("club", { enabled: true, hasSubscription: true, pastDue: true, canEdit: true })).toMatch(/last payment didn.t go through/);
  });

  it("someone who can't change club settings is told so, not shown buttons", () => {
    const body = panel("free", { enabled: true, hasSubscription: false, pastDue: false, canEdit: false });
    expect(body).toContain("Only a club owner or admin can change the plan.");
    expect(body).not.toMatch(BUY);
  });
});
