import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { landingNav } from "@/components/landing/chrome";
import { FRONT_DOOR, frontDoorWords, type LaunchState } from "@/lib/go-live";
import { FAQ, faqItem } from "@/lib/landing/faq";
import { faqStructuredData, nodeText } from "@/lib/landing/faq-structured-data";
import { editionFor, editionSwaps } from "@/lib/landing/edition";
import { landingPrices } from "@/lib/landing/pricing";
import { parsePricingOverrides } from "@/lib/plans";
import { readSource } from "./source";

/**
 * THREE SMALL CHANGES TO THE FRONT DOOR (Ajay, 2026-11-08), and what each one must keep true.
 *
 *  1. The questions page answers "Switching from another tool or a spreadsheet?" with what the app does today.
 *  2. "No fees. We never touch the money." is on the front door beside the pricing, and /faq explains it
 *     with one worked entry fee. TourneyHQ records money and never moves it (Hard rule 7).
 *  3. The ONE primary call to action is repeated quietly between sections and drawn in the top bar, in
 *     the hero's own words, and it follows the go-live switch because it is the hero's own function.
 */

const ctx = (launch: LaunchState) => ({
  prices: landingPrices(editionFor("US"), parsePricingOverrides(undefined)),
  email: "zz@example.invalid",
  launch,
});
const text = (id: string, launch: LaunchState = "held") => nodeText(faqItem(id).a(ctx(launch))).replace(/\s+/g, " ").trim();
const page = readSource("src/app/page.tsx");

describe("the one primary call to action", () => {
  for (const state of ["held", "live"] as const) {
    it(`${state}: the top bar says what the hero says`, () => {
      const words = frontDoorWords(state);
      expect(words.navCta).toBe(words.heroCta);
      const nav = renderToStaticMarkup(<>{landingNav("home", state)}</>);
      expect(nav).toContain(`>${words.heroCta}</a>`);
    });
  }

  it("held, it is the early list at /interest and never a sign-up", () => {
    const words = frontDoorWords("held");
    expect(words.startHref("")).toBe("/interest");
    expect(words.startHref("/")).toBe("/interest");
    expect(FRONT_DOOR.held.heroCta).toBe("Join the early list");
    const nav = renderToStaticMarkup(<>{landingNav("home", "held")}</>);
    expect(nav).not.toContain("#signup");
  });

  it("the quiet buttons at the section breaks ARE the hero's button: one function, one rule", () => {
    // Both are drawn by `primaryDoor`, which reads only `start` and `words.heroCta`.
    expect(page).toMatch(/const primaryDoor = \(cls: string\) => \(\s*<a className=\{`m-btn \$\{cls\}`\} href=\{start\}>\{words\.heroCta\}/);
    expect(page).toMatch(/const quietDoor = <div className="m-quiet">\{primaryDoor\("m-line"\)\}<\/div>;/);
    expect(page).toMatch(/\{primaryDoor\("m-primary"\)\}/);
    // A second rule would be a quiet button that names its own words or its own address.
    const quietAt = page.indexOf("const quietDoor");
    expect(quietAt).toBeGreaterThan(0);
    expect(page.slice(quietAt, quietAt + 200)).not.toMatch(/interest|signup|Run an event|Join the early list/);
    // Repeated at 2–3 natural breaks, not sprinkled.
    const uses = (page.match(/^\s*\{quietDoor\}$/gm) ?? []).length;
    expect(uses).toBeGreaterThanOrEqual(2);
    expect(uses).toBeLessThanOrEqual(3);
  });

  it("the quiet buttons sit BETWEEN sections: outside the two green test sections", () => {
    // Each `{quietDoor}` follows a closing </section>, so none can land inside `m-leaf`.
    for (const m of page.matchAll(/^\s*\{quietDoor\}$/gm)) {
      const before = page.slice(0, m.index).trimEnd();
      expect(before.endsWith("</section>"), "a quiet button follows a section's end").toBe(true);
    }
  });
});

describe("no fees: we never touch the money", () => {
  it("the front door says it beside the pricing, outside the green pricing section", () => {
    const at = page.indexOf('className="m-nofee"');
    expect(at, "the line is on the page").toBeGreaterThan(0);
    expect(at).toBeGreaterThan(page.indexOf('id="every-plan"'));
    expect(at).toBeLessThan(page.indexOf('id="pricing"'));
    const line = page.slice(at, page.indexOf("</p>", at));
    expect(line).toContain("No fees. We never touch the money.");
    expect(line).toContain('href="/faq#q-no-fees"');
  });

  it("/faq answers it with the worked example, in both launch states", () => {
    for (const state of ["held", "live"] as const) {
      const a = text("no-fees", state);
      expect(a).toMatch(/takes no percentage/);
      expect(a).toMatch(/processes none of it/);
      expect(a).toMatch(/entry fee is 40 and twenty players enter/);
      expect(a).toMatch(/That is 800, and all of it reaches your club/);
    }
  });

  it("never offers a payment, never claims to record who paid an ENTRY fee, never says bet", () => {
    const a = text("no-fees");
    expect(a).not.toMatch(/\b(pay (us|here|online|now|through)|pay button|checkout|we (collect|hold|move|send))\b/i);
    expect(a).not.toMatch(/\b(bet|bets|betting)\b/i);
    // The record of "who has paid in" is a skins and side-game column; the answer says so.
    expect(a).toMatch(/For a skins game or a side game, staff mark who has paid in/);
    expect(a).not.toMatch(/records who has paid (their|the) entry/i);
  });

  it("extends the existing money answers: they are still there and still say 'never'", () => {
    expect(text("money")).toMatch(/never holds, moves or takes a cut/);
    expect(text("entry-fees")).toMatch(/No payment fees on|no payment fees on/i);
    // Placed in the Money group, after the two it extends.
    const money = FAQ.find((g) => g.id === "money")!;
    const ids = money.items.map((i) => i.id);
    expect(ids.indexOf("no-fees")).toBeGreaterThan(ids.indexOf("entry-fees"));
  });
});

describe("switching from another tool or a spreadsheet", () => {
  const a = text("switching");

  it("states what carries over and what does not", () => {
    expect(faqItem("switching").q).toBe("Switching from another tool or a spreadsheet?");
    expect(a).toMatch(/spreadsheet saved as CSV/);
    expect(a).toMatch(/Other \(enter manually\)/);
    expect(a).toMatch(/Copy it/);
    expect(a).toMatch(/What does not carry/);
    expect(a).toMatch(/Handicap indexes are entered by you for now/);
  });

  it("names no other company, promises no migration service, never says 'only TourneyHQ'", () => {
    const wording = (a + " " + faqItem("switching").q).toLowerCase();
    for (const banned of ["golf genius", "bluegolf", "squabbit", "gamebook", "leaguegolfer", "migration service", "we will move", "we'll move", "only tourneyhq", "we import for you"])
      expect(wording, banned).not.toContain(banned);
  });

  it("is in the FAQPage structured data with the same words, in the visitor's edition", () => {
    const edition = editionFor("US");
    const data = faqStructuredData(FAQ, ctx("held"), editionSwaps(edition));
    const names = data.mainEntity.map((e) => e.name);
    expect(names).toContain("Switching from another tool or a spreadsheet?");
    expect(names).toContain("Do you take a fee or a percentage of the money?");
    const entry = data.mainEntity.find((e) => e.name.startsWith("Do you take a fee"))!;
    expect(entry.acceptedAnswer.text).toContain("takes no percentage");
  });
});
