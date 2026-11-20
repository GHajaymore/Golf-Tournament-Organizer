import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSource } from "./source";

/**
 * A REFUSAL SAID UNDER A CONTROL IS STILL IN VIEW ONCE THE SCREEN HAS CAUGHT UP
 * WITH THE LOCK (J12, PR 7b; 2026-11-09).
 *
 * Found by `e2e/locked-setup-refuses-in-words.spec.ts` on CI (run 42718807588,
 * "Cut the field for Round 2: the refusal is not in view"): the box was pressed
 * at the top of Rounds & formats, the refusal was said under it, and then the
 * "Locked" banner arrived above and pushed the sentence below the fold — the
 * page's scroll was 0 throughout, where a browser does not hold the place.
 *
 * The browser spec is what proves the screen. This holds the two things it
 * rests on, without a browser (this suite has no DOM): the hook scrolls when the
 * sentence appears AND again when the lock arrives, and on nothing else — a hook
 * that scrolled on every render is the keystroke fault `bring-into-view.test.ts`
 * was written against — and the cut's refusal is given to it with the lock.
 */

/** What the hook handed React: the effect and what it depends on. */
const seen: { effect: (() => void) | null; deps: unknown[] | null; el: { scrollIntoView: ReturnType<typeof vi.fn> } } = {
  effect: null,
  deps: null,
  el: { scrollIntoView: vi.fn() },
};

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: () => ({ current: seen.el }),
  useEffect: (effect: () => void, deps?: unknown[]) => {
    seen.effect = effect;
    seen.deps = deps ?? null;
  },
}));

import { useKeptInView } from "@/lib/bring-into-view";

describe("a refusal is kept in view when the lock arrives", () => {
  beforeEach(() => {
    seen.effect = null;
    seen.deps = null;
    seen.el = { scrollIntoView: vi.fn() };
  });

  it("scrolls the least it can when there is a sentence, and not at all when there is none", () => {
    useKeptInView("Locked because the tournament is live.", false);
    seen.effect!();
    expect(seen.el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(seen.el.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    seen.el = { scrollIntoView: vi.fn() };
    useKeptInView("", true);
    seen.effect!();
    expect(seen.el.scrollIntoView, "nothing was refused, and the page was moved").not.toHaveBeenCalled();
  });

  it("runs again for the sentence and for the lock, and for nothing else", () => {
    useKeptInView("Refused.", false);
    // No list at all would be every render: the page pulled back on each keystroke.
    expect(seen.deps, "the effect runs on every render").not.toBeNull();
    expect(seen.deps).toEqual(["Refused.", false]);
    useKeptInView("Refused.", true);
    expect(seen.deps, "the lock arriving does not bring the refusal back into view").toEqual(["Refused.", true]);
  });

  it("the cut's refusal is given to it, with the lock", () => {
    const src = readSource("src/components/CutControl.tsx");
    expect(src).toContain("const refusedRef = useKeptInView(refused, locked);");
    const alert = src.split("\n").find((l) => l.includes('role="alert"')) ?? "";
    expect(alert, "the cut's refusal is not the element kept in view").toContain("ref={refusedRef}");
  });

  it("control: the element the hook returns is the one it scrolls", () => {
    const ref = useKeptInView("Refused.", false);
    expect(ref.current).toBe(seen.el);
  });
});
