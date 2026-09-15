import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY DIALOG IN THIS APP, AND WHICH KIND IT IS.
 *
 * `layout.spec` and `touch.spec` sweep routes from the filesystem and measure
 * what renders on arrival. Neither contains a single `.click()` — measured, not
 * estimated — so no dialog in this app has ever had its geometry asserted at
 * any viewport. A route sweep can enumerate routes; it cannot enumerate STATES.
 *
 * `e2e/dialog.spec.ts` closes that, and it has to open each one by hand,
 * because a trigger is per-component and not derivable from the filesystem.
 * CLAUDE.md says layout is swept from the filesystem and "do not reintroduce a
 * hand list" — so THIS FILE IS WHY THAT ONE IS ALLOWED TO BE A HAND LIST.
 * A hand list that goes stale silently is the fault that rule was written
 * about; a hand list with a count pinned against it is a different animal. Add
 * a fourth dialog and this test goes red, which sends somebody to the spec.
 *
 * TWO MARKERS, because neither finds all three. `LifecycleBar` and
 * `PlayerSignOut` are keyed on `.dialog-backdrop`; `CardConflict` carries
 * `role="alertdialog"` and no backdrop at all. A sweep on the class alone
 * finds two of three and reports itself clean — the same shape as the `zz-`
 * grep that missed `ci-smoke` in #364, twice in one night in one repo, which
 * is less a coincidence than the default outcome of keying a sweep on whatever
 * marker is in front of you.
 */

const COMPONENTS = join("src", "components");

interface Found {
  file: string;
  /** A centred overlay with a backdrop — `.dialog-backdrop`. */
  modal: boolean;
  /** Announces itself to assistive tech, and to Playwright's `getByRole`. */
  announced: boolean;
}

function dialogs(): Found[] {
  const out: Found[] = [];
  for (const entry of readdirSync(COMPONENTS)) {
    if (!entry.endsWith(".tsx")) continue;
    const src = readSource(join(COMPONENTS, entry));
    const modal = src.includes("dialog-backdrop");
    const announced = /role="(?:alert)?dialog"/.test(src);
    if (modal || announced) out.push({ file: entry, modal, announced });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const found = dialogs();

describe("every dialog is accounted for", () => {
  it("finds the ones that exist, by name and by kind", () => {
    /**
     * PINNED, NOT COUNTED, so a failure says which one arrived and what shape
     * it is. A bare count tells the next person a number changed and leaves
     * them to find out which.
     *
     * `CardConflict` being `announced` and NOT `modal` is the interesting row
     * and the reason this test records a kind at all — see below.
     *
     * WHAT THIS LOOKED LIKE BEFORE. The app had it exactly backwards: the two
     * real modals carried no `role` and no `aria-modal`, so they were modal to
     * everybody except a screen reader, and the only thing announcing itself
     * as a dialog was the one that is not one. Both modals are labelled now.
     */
    expect(found).toEqual([
      { file: "CardConflict.tsx", modal: false, announced: true },
      { file: "LifecycleBar.tsx", modal: true, announced: true },
      { file: "PlayerSignOut.tsx", modal: true, announced: true },
    ]);
  });

  it("gives every real modal a role, a modal flag and a name", () => {
    /**
     * The half a `role` alone does not buy. `aria-modal` is what tells assistive
     * tech the rest of the page is inert behind this; `aria-labelledby` is what
     * makes the announcement say WHICH dialog — "Launch <tournament>?" rather
     * than "dialog".
     *
     * Labelled BY the title element rather than with a second copy of the
     * words, so the announced name and the visible one cannot drift apart.
     */
    for (const d of found.filter((x) => x.modal)) {
      const src = readSource(join(COMPONENTS, d.file));
      expect(src, `${d.file} has no role="dialog"`).toContain('role="dialog"');
      expect(src, `${d.file} does not say it is modal`).toContain('aria-modal="true"');
      expect(src, `${d.file} is announced without a name`).toContain("aria-labelledby");
    }
  });

  it("recognises both markers — the sweep's own control", () => {
    /**
     * Either half alone reports a clean sweep over an incomplete set. Asserted
     * so a refactor that drops one of the two patterns fails here rather than
     * quietly narrowing what gets measured.
     */
    expect(found.filter((d) => d.modal).length, "no backdrop dialogs found").toBeGreaterThan(1);
    expect(found.filter((d) => d.announced).length, "no announced dialogs found").toBeGreaterThan(1);
    expect(
      found.some((d) => d.announced && !d.modal),
      "the announced-but-not-modal case is gone — if that is deliberate, update the spec too",
    ).toBe(true);
  });
});

/**
 * AND THE ONE THAT IS NOT A DIALOG AT ALL.
 *
 * `CardConflict` is a `<section className="card">` rendered INLINE in
 * `PlayerCard`'s page flow. It has no backdrop, no `position: fixed`, and is
 * not centred — the only thing that makes it a dialog is `role="alertdialog"`,
 * which is what `page.getByRole("alertdialog")` in `offline.spec` binds to.
 *
 * WHY THIS IS WORTH A TEST RATHER THAN A COMMENT. `offline.spec:245` is the
 * intermittent CLAUDE.md has a long entry about, and every failing log shares
 * the sequence `element is not stable` → `outside of the viewport` →
 * `element was detached from the DOM`. That entry reasons about it as "a
 * dialog still animating or re-rendering", and a real modal dialog is centred
 * in the viewport and cannot be outside it. An inline card two thirds of the
 * way down a scrolling scorecard can, and Playwright must scroll to it before
 * it can click.
 *
 * So the kind is load-bearing for a live investigation, and a later change
 * making this a proper modal would resolve that symptom and should be noticed
 * rather than discovered. This is not a claim that it IS the cause — the
 * `usePendingCard` timer fix has its own evidence — only that the shape is a
 * fact the next person should not have to rediscover.
 */
describe("the card chooser is an inline card, not an overlay", () => {
  const src = readSource(join(COMPONENTS, "CardConflict.tsx"));

  it("announces itself as a dialog", () => {
    expect(src).toContain('role="alertdialog"');
  });

  it("is in the page flow, with no backdrop and nothing fixed", () => {
    expect(src, "it grew a backdrop — it is a modal now, tell e2e/dialog.spec.ts").not.toContain(
      "dialog-backdrop",
    );
    expect(src, "it grew fixed positioning — see above").not.toMatch(/position:\s*["']fixed["']/);
  });

  it("is rendered from exactly one place in PlayerCard", () => {
    /**
     * IT WAS TWO, AND THIS TEST PINNED THE TWO — deliberately, so that
     * collapsing them would be an act rather than an accident. It has now been
     * done, so this pins the one.
     *
     * The two sites sat at different JSX positions under mutually exclusive
     * guards, so a `conflict`/`recovered` flip made React UNMOUNT one and MOUNT
     * the other rather than update in place — and every failing log of the
     * `offline.spec:245` intermittent ends `element was detached from the DOM,
     * retrying`, which is what an unmount under a pending click looks like.
     *
     * Not a confirmed fix: that failure is intermittent and has never been
     * reproduced on demand, so what can be said is that one named mechanism
     * for it is gone. Which situation the chooser is asking about is decided
     * in a `chooser` value beside the handlers; `CardConflict` holds no state,
     * so nothing survives the flip that should not.
     */
    const card = readSource(join(COMPONENTS, "PlayerCard.tsx"));
    expect(
      card.split("<CardConflict").length - 1,
      "a second call site is back — a flip between them unmounts and remounts the chooser",
    ).toBe(1);
  });
});

/**
 * AND THE PLAYER IS TAKEN TO IT.
 *
 * The chooser is an inline section rendered after the scorecard, and a
 * scorecard is eighteen rows tall. Measured on a 320x568 phone with the
 * chooser open, its top edge sits at y=783 — 215px BELOW the fold. Nothing
 * scrolled to it, and the status line that might have mentioned it renders
 * BELOW it again, so a player whose card was in dispute saw an unchanged
 * scorecard and no sign anything had happened.
 *
 * Until that question is answered the strokes are not sent and the card cannot
 * be certified. It is the most urgent thing on the screen, and it was the only
 * thing off it.
 *
 * FOUND WHILE DEBUGGING A TEST, which is the part worth remembering.
 * `offline.spec:245` failed intermittently because Playwright had to SCROLL to
 * this element before clicking it — and "the thing you must act on is below
 * the fold" is a fact about the product that a test was reporting as its own
 * problem.
 */
describe("the card chooser is brought into view", () => {
  const card = readSource(join(COMPONENTS, "PlayerCard.tsx"));

  it("scrolls to the chooser when it opens", () => {
    expect(
      card,
      "nothing brings the chooser on screen — a player in dispute sees an unchanged scorecard",
    ).toMatch(/chooserRef\.current\?\.scrollIntoView/);
  });

  it("only on the transition to open, not on every render", () => {
    /**
     * The half that stops it being a nuisance. Scrolling on every render would
     * drag somebody back every time the card re-rendered underneath them —
     * and this component re-renders on every hole entered.
     */
    expect(card).toMatch(/chooserWasOpen/);
    expect(card).toMatch(/if \(chooserOpen && !chooserWasOpen\.current\)/);
  });

  it("leaves the manner of the scroll to the page", () => {
    /**
     * No `behavior` argument, deliberately: that defers to the page's
     * `scroll-behavior`, which is smooth for most people and `auto` for
     * anybody who has asked for reduced motion. Passing `"smooth"` here would
     * override that preference for the one scroll in the app most likely to
     * happen while somebody is already disoriented.
     */
    const call = /scrollIntoView\(\{([^}]*)\}\)/.exec(card)?.[1] ?? "";
    expect(call, "the scroll hardcodes a behavior and ignores reduced motion").not.toMatch(
      /behavior/,
    );
  });
});
