import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE LIST YOU CAN SEE AND THE LIST THE ARROW KEYS CAN REACH MUST BE ONE LIST.
 *
 * `CoursePicker` opens with its own contract at the top: "type to narrow,
 * arrows to move, Enter to take it, Escape to back out". It honoured that for
 * one row kind out of five.
 *
 * The listbox was assembled from five separate renderings — the "none" row,
 * the `extras` ("Other (enter manually)", "No fixed course — players choose"),
 * the club's own courses, the course-directory hits, and "Use «what you
 * typed»". Only the club's own courses carried an `id`, were counted by the
 * arrow handler, or could be taken with Enter. So `aria-activedescendant`
 * could only ever name a course the club already owned, and everything else
 * was `role="option"` that no keyboard could reach.
 *
 * Worst in the commonest state there is. A club with nothing in its library
 * has no matching courses, so the handler's `shown.length === 0` guard
 * returned immediately and the keyboard did NOTHING while three choices sat
 * visibly open. Walked on 2026-09-11 on a brand-new club: ArrowDown moved
 * nothing, `aria-activedescendant` stayed null.
 *
 * The directory rows are the sharper half — "results appear as you type" is
 * the assistance this control exists to give, and taking one needed a mouse.
 *
 * Verified after the fix, on the same screen: ArrowDown reaches
 * `course-option-2` ("No fixed course — players choose") and Enter takes it.
 *
 * These are source assertions because the list only exists once the control is
 * open, which a static render cannot reach. What they pin is the STRUCTURE
 * that made the bug possible, not the behaviour — a component that builds its
 * rows once cannot have a row the keyboard does not know about.
 */

const SRC = ["src", "components", "CoursePicker.tsx"] as const;

describe("the picker renders one list", () => {
  it("declares role=option in exactly one place", () => {
    /**
     * The count is the whole point. Five occurrences was five renderings, and
     * four of them were unreachable; a sixth added later would be unreachable
     * too and nothing would say so.
     */
    const src = readSource(...SRC);
    expect(src.match(/role="option"/g) ?? []).toHaveLength(1);
  });

  it("gives every option an id, from the row's own index", () => {
    const src = readSource(...SRC);
    // One template, applied to every row, so the ids cannot have holes.
    expect(src.match(/id=\{`course-option-\$\{i\}`\}/g) ?? []).toHaveLength(1);
  });

  it("moves the arrows over the whole list, not the courses alone", () => {
    /**
     * `shown` is the club's own matching courses. The handler used to bound
     * itself by that and index into it, which is precisely why the other four
     * row kinds were unreachable.
     */
    const src = readSource(...SRC);
    const handler = src.slice(src.indexOf('if (e.key === "ArrowDown"'), src.indexOf('if (e.key === "Escape"'));
    expect(handler).toMatch(/rows\.length/);
    expect(handler).toMatch(/rows\[active\]/);
    expect(handler, "the arrow handler must not bound itself by the course list").not.toMatch(/shown\.length/);
    expect(handler, "Enter must not index the course list").not.toMatch(/shown\[active\]/);
  });

  it("takes a row through one function, so the mouse and the keyboard agree", () => {
    /**
     * The click handler and the Enter handler both call `choose`. When they
     * were separate, the directory rows were clickable and un-pressable — a
     * difference nobody could see from either side alone.
     */
    const src = readSource(...SRC);
    expect(src).toMatch(/onClick=\{\(\) => choose\(row\)\}/);
    expect(src).toMatch(/const row = rows\[active\];\s*if \(row\) choose\(row\);/);
  });

  it("tells a screen reader that the list is filtered by what is typed", () => {
    expect(readSource(...SRC)).toMatch(/aria-autocomplete="list"/);
  });

  it("still builds the rows in the order a reader sees them", () => {
    /**
     * Order is behaviour here: the club's own courses come before directory
     * hits, because a club that owns the course must never be offered a
     * directory copy to import a second time. Pinned as the sequence of
     * pushes, which is the only place that order now lives.
     */
    const src = readSource(...SRC);
    const build = src.slice(src.indexOf("const rows = useMemo"), src.indexOf("const pick = (id: string)"));
    const order = ["none", "extra", "course", "directory", "new"].map((k) => build.indexOf(`kind: "${k}"`));
    expect(order.every((n) => n > -1), "every row kind is built").toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
