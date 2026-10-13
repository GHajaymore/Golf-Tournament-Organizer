import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { leaveOnEnter } from "@/lib/leave-on-enter";
import { readSource } from "./source";

/**
 * A BOX THAT SAVES WHEN IT IS LEFT, SAVES WHEN ENTER IS PRESSED.
 *
 * The console has a dozen boxes with no Save button: the figure is kept when
 * the box is left. Enter did not leave it, so Enter saved nothing — and Enter
 * is what a person presses when they have finished typing a number. See
 * `src/lib/leave-on-enter.ts` for how it was found (a knockout final's margin,
 * lost on Firefox).
 *
 * This is the sweep for the class: every element in the app that acts when it
 * is left (`onBlur`) is found, and each must take a key press — written above
 * its `onBlur`, where the two can be read together — or be on the list below,
 * which says why Enter is not for it.
 *
 * What it cannot see: that the key press it finds is the right one, or that a
 * browser really does save. The knockout specs press Enter on a margin and
 * wait for the word "Saved"; the Members spec presses it on a handicap.
 */

/** `file#n` — the nth `onBlur` in the file, counted from nought. */
const ENTER_IS_NOT_FOR_IT: Record<string, string> = {
  "src/components/RegistrationClient.tsx#2": "the invitation is a paragraph: Enter is a new line in it",
  "src/components/TeamsClient.tsx#1": "a dropdown, which closes itself when it is left; choosing is what acts",
  "src/components/EventSetupClient.tsx#0": "looks a zip code up as a convenience; the screen's own Save keeps it",
  "src/components/NewMatchForm.tsx#0": "Enter here records the match (its handler is written after the blur line)",
  "src/components/FlightBoard.tsx#0": "Enter here renames the flight (its handler is written after the blur line)",
  "src/components/CoursePicker.tsx#0": "Enter here picks the highlighted course (its handler is written after the blur line)",
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") walk(p, out);
    } else if (/\.tsx$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
};

/** Every `onBlur` in a source text, with whether a key handler is written above it in the same element. */
function leavers(code: string): boolean[] {
  const found: boolean[] = [];
  let at = code.indexOf("onBlur=");
  while (at !== -1) {
    // The element it is on begins at the last tag opened before it.
    const before = code.slice(0, at);
    const opened = [...before.matchAll(/<[A-Za-z][A-Za-z0-9.]*[\s\n]/g)].pop();
    const element = opened ? before.slice(opened.index) : "";
    found.push(element.includes("onKeyDown="));
    at = code.indexOf("onBlur=", at + 1);
  }
  return found;
}

describe("the sweep", () => {
  it("CONTROL: it tells a box that takes a key from one that does not", () => {
    expect(leavers("<input\n  value={x}\n  onKeyDown={leaveOnEnter}\n  onBlur={save}\n/>")).toEqual([true]);
    expect(leavers("<input\n  value={x}\n  onBlur={save}\n/>")).toEqual([false]);
    // A key handler on the element BEFORE is not this element's.
    expect(leavers("<input onKeyDown={a} />\n<input\n  onBlur={save}\n/>")).toEqual([false]);
    expect(leavers("<input onBlur={a} />\n<select onKeyDown={k} onBlur={b} />")).toEqual([false, true]);
  });

  const files = walk("src");
  const every = files.flatMap((file) => leavers(readSource(file)).map((takesKey, n) => ({ id: `${file}#${n}`, takesKey })));

  it("CONTROL: it finds the boxes — the bracket's margin among them", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(every.length).toBeGreaterThanOrEqual(16);
    expect(every.find((x) => x.id === "src/components/BracketClient.tsx#0")?.takesKey, "the knockout margin").toBe(true);
  });

  it("every box that acts when it is left takes a key press, or says why Enter is not for it", () => {
    const silent = every.filter((x) => !x.takesKey && !(x.id in ENTER_IS_NOT_FOR_IT)).map((x) => x.id);
    expect(silent, "give the box onKeyDown={leaveOnEnter} above its onBlur (src/lib/leave-on-enter.ts), or add it to the list with the reason").toEqual([]);
  });

  it("the list holds only what is still true", () => {
    for (const id of Object.keys(ENTER_IS_NOT_FOR_IT)) {
      const now = every.find((x) => x.id === id);
      expect(now, `${id} is excused and is not there any more`).toBeTruthy();
      expect(now?.takesKey, `${id} takes a key press now: take it off the list`).toBe(false);
    }
  });
});

describe("leaveOnEnter", () => {
  const press = (key: string) => {
    let left = 0;
    leaveOnEnter({ key, currentTarget: { blur: () => left++ } } as never);
    return left;
  };

  it("leaves the box on Enter, and on nothing else", () => {
    expect(press("Enter")).toBe(1);
    for (const key of ["Tab", "a", "1", "Escape", " ", "ArrowDown"]) expect(press(key), key).toBe(0);
  });
});
