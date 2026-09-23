import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanPanel } from "@/components/PlanPanel";
import type { OrgLimits } from "@/lib/services/limits";

/**
 * A CLUB CAN SEE WHERE IT STANDS BEFORE IT IS REFUSED.
 *
 * `limitStatus` was written with a comment promising the UI "can say so
 * honestly" and nothing called it until 2026-09-18, so a club on one
 * tournament at a time found that out by being refused the second one.
 *
 * The cells here are about the WORDING, because that is where this can go
 * wrong in a way nobody notices: limits do not bite until a payment provider
 * is attached, so a panel saying "you are at your limit" to a club the app
 * would happily let carry on is a small lie on the one screen whose job is to
 * be straight about what has been bought.
 */

const standing = (over: boolean, enforced: boolean): OrgLimits => ({
  plan: "free",
  enforced,
  activeEvents: over
    ? { allowed: false, limit: 1, current: 1, reason: "The Free plan includes 1 active tournaments. Upgrade to add more." }
    : { allowed: true, limit: 1, current: 0 },
  staffSeats: { allowed: true, limit: 1, current: 1 },
});

/** React's SSR separators sit between text nodes; strip them before matching. */
const text = (html: string) => html.replace(/<!--[^>]*-->/g, "").replace(/<[^>]+>/g, " ");

describe("where a club stands", () => {
  it("says how much of the plan is used", () => {
    const body = text(renderToStaticMarkup(<PlanPanel planKey="free" standing={standing(false, false)} />));
    expect(body).toMatch(/0 of 1 tournament running/);
    expect(body).toMatch(/1 of 1 organizer/);
  });

  it("does NOT claim a refusal that would not happen", () => {
    /**
     * At the cap, but enforcement is off — which is every club today, because
     * no payment provider is attached to anything. The usage is still shown;
     * the consequence is not claimed.
     */
    const body = text(renderToStaticMarkup(<PlanPanel planKey="free" standing={standing(true, false)} />));
    expect(body).toMatch(/1 of 1 tournament running/);
    expect(body, "promised a refusal the app would not actually make").not.toMatch(/needs a bigger plan/);
  });

  it("reads as a fact rather than a typo once the club is PAST the allowance", () => {
    /**
     * The fixture above stops AT the cap — `limit: 1, current: 1` — so being
     * over it was a state nothing here could reach, and the panel printed
     * "9 of 1 tournament running" on the seeded club without anything noticing.
     *
     * It is the ordinary path, not an edge: limits do not bite until a payment
     * provider is attached, so any free-plan club opening a second tournament
     * is already past one.
     */
    const past: OrgLimits = {
      plan: "free",
      enforced: false,
      activeEvents: { allowed: false, limit: 1, current: 9 },
      staffSeats: { allowed: true, limit: 1, current: 1 },
    };
    const body = text(renderToStaticMarkup(<PlanPanel planKey="free" standing={past} />));
    expect(body).toMatch(/9 tournaments running · plan includes 1/);
    // The noun follows what is being COUNTED. "9 of 1 tournament running" put
    // it on the limit, which is the one number in the phrase that is not.
    expect(body, "printed the unreadable X-of-Y form over the allowance").not.toMatch(/9 of 1/);
    // Still no consequence claimed while nothing is enforced — the rule the
    // rest of this file exists for, and the fix must not quietly break it.
    expect(body).not.toMatch(/needs a bigger plan/);
    // The row that is WITHIN its limit keeps the plain form.
    expect(body).toMatch(/1 of 1 organizer/);
  });

  it("says it plainly once a refusal is real", () => {
    const body = text(renderToStaticMarkup(<PlanPanel planKey="free" standing={standing(true, true)} />));
    expect(body).toMatch(/Another tournament needs a bigger plan/);
  });

  it("does not say 'of' when there is no limit to be of", () => {
    const unlimited: OrgLimits = {
      plan: "club",
      enforced: true,
      activeEvents: { allowed: true, limit: null, current: 4 },
      staffSeats: { allowed: true, limit: 10, current: 3 },
    };
    const body = text(renderToStaticMarkup(<PlanPanel planKey="club" standing={unlimited} />));
    expect(body).toMatch(/4 tournaments running · no limit/);
    expect(body).toMatch(/3 of 10 organizers/);
  });

  it("renders without it, for every caller that has not been given one", () => {
    // The prop is optional on purpose: a panel with no standing is the old
    // panel, not a crash.
    const body = text(renderToStaticMarkup(<PlanPanel planKey="free" />));
    expect(body).toMatch(/Your plan/);
    expect(body).not.toMatch(/of 1 tournament running/);
  });
});
