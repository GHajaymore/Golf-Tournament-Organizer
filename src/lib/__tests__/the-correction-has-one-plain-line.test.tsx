import { describe, it, expect, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("@/app/actions/tournament", () => ({ openCorrection: async () => ({ ok: true }), endCorrection: async () => ({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { CorrectionButton, CORRECTION_PLAIN_LINE } = await import("@/components/CommitteeCorrection");
const { ScopeLockBanner } = await import("@/components/ScopeLockBanner");
const { locksFor, scopeLockOf } = await import("@/lib/domain/tournament-status");
const { facts, launched } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");
const { GUIDE_STEPS } = await import("@/lib/guide-steps");

/**
 * ONE PLAIN LINE UNDER "MAKE A COMMITTEE CORRECTION" (state machine PR 9b; the persona re-walk's
 * N3, test plan B19). A first-time reader meets the term on a refusal; the line under the button
 * says what pressing it does, in the dialog's own words, with no new term:
 *
 *   "Opens one part for changes, with your reason on record."
 *
 * ONE string (one rule, one place): declared once in `CommitteeCorrection.tsx`, drawn by the
 * button itself — so every place the button is drawn (each banner, the dashboard) carries it —
 * and said in the guide's committee-correction step, so the guide and the screen cannot part.
 */
const PLAIN = "Opens one part for changes, with your reason on record.";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") walk(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

describe("the plain line under the committee correction (PR 9b, B19)", () => {
  it("is the sentence, declared once, in the button's own module", () => {
    expect(CORRECTION_PLAIN_LINE).toBe(PLAIN);
    const holders = [...walk("src/app"), ...walk("src/components"), ...walk("src/lib")].filter((f) => readSource(f).includes(PLAIN));
    // The button's module declares it; the guide says it in its correction step (asserted below). No third copy.
    expect(holders.sort()).toEqual(["src/components/CommitteeCorrection.tsx", "src/lib/guide-steps.ts"]);
  });

  it("is drawn under the button wherever the button is — on its own, and on a banner", () => {
    const button = renderToStaticMarkup(<CorrectionButton scopes={["field"]} />);
    expect(button).toContain("Make a committee correction");
    expect(button).toContain(PLAIN);
    // The line comes after the button, not before it.
    expect(button.indexOf(PLAIN)).toBeGreaterThan(button.indexOf("Make a committee correction"));
    // At least 48 px high, pressed on a phone on the course (design principle 10).
    expect(button).toMatch(/<button[^>]*style="min-height:48px"/);
    const banner = renderToStaticMarkup(<ScopeLockBanner locks={[scopeLockOf(locksFor(launched(facts())), "field")!]} isAdmin />);
    expect(banner).toContain(PLAIN);
  });

  it("CONTROL: not drawn where the button is not — an assistant's banner says who can, with no button and no line", () => {
    const banner = renderToStaticMarkup(<ScopeLockBanner locks={[scopeLockOf(locksFor(launched(facts())), "field")!]} isAdmin={false} />);
    expect(banner).toContain("Only the Organizer can make a committee correction.");
    expect(banner).not.toContain(PLAIN);
  });

  it("the guide's committee-correction step says the same sentence, beside the button's name", () => {
    const texts: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === "string") texts.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(GUIDE_STEPS);
    const step = texts.filter((p) => p.includes("[[Make a committee correction]]") && p.includes(PLAIN));
    expect(step.length, "the guide's correction step does not say what the button does").toBe(1);
  });
});
