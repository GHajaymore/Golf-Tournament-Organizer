import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY DOOR TO A COPY ASKS FOR THE FIRST DAY (setup sequencing audit, item 8,
 * 5 Nov).
 *
 * "Copy last event" gave the copy its dates (`copiedCalendar` moves the entry
 * window and every round by the same distance); "Start from" a past tournament,
 * on /choose and in the switcher, called the same `cloneEvent` with a name and
 * nothing else, so the copy had no dates anywhere and the secretary dated it
 * field by field, which is what Copy last event was built to stop.
 *
 * One rule: a component that calls `cloneEvent` hands it the day (third
 * argument). Swept over every component, with a control proving the sweep can
 * see a call that does not.
 */

/** The arguments of each `cloneEvent(` call in `code`, split at top-level commas. */
function cloneEventCalls(code: string): string[][] {
  const out: string[][] = [];
  let from = 0;
  for (;;) {
    const at = code.indexOf("cloneEvent(", from);
    if (at === -1) return out;
    let depth = 1;
    let i = at + "cloneEvent(".length;
    const args: string[] = [];
    let cur = "";
    for (; i < code.length && depth > 0; i += 1) {
      const c = code[i];
      if ("([{".includes(c)) depth += 1;
      else if (")]}".includes(c)) depth -= 1;
      if (depth === 0) break;
      if (c === "," && depth === 1) { args.push(cur.trim()); cur = ""; } else cur += c;
    }
    if (cur.trim()) args.push(cur.trim());
    out.push(args);
    from = i;
  }
}

function components(dir = join("src", "components")): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx$/.test(e.name))
    .map((e) => join(dir, e.name));
}

describe("every door to a copy asks for the first day", () => {
  it("CONTROL: the sweep sees a call without the day", () => {
    expect(cloneEventCalls("await cloneEvent(copyFrom.id, name)")).toEqual([["copyFrom.id", "name"]]);
    expect(cloneEventCalls("cloneEvent(a, b, { startOn, endOn })")[0]).toHaveLength(3);
  });

  it("hands the day to every cloneEvent call in a component", () => {
    const seen: string[] = [];
    for (const file of components()) {
      const calls = cloneEventCalls(readSource(file)).filter((a) => a.length > 0);
      for (const args of calls) {
        seen.push(file);
        expect(args.length, `${file} copies a tournament without asking for its first day`).toBeGreaterThanOrEqual(3);
      }
    }
    // Three doors today: Copy last event, Start from on /choose, the switcher.
    expect(new Set(seen).size, "a door to a copy has gone, or the sweep reads nothing").toBeGreaterThanOrEqual(3);
  });
});
