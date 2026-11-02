import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * A MEMBER ENTERED IN A TOURNAMENT CARRIES HER GENDER IN WITH HER.
 *
 * Found 2026-10-23 running a club knockout of 129 the way a secretary would:
 * the members' spreadsheet (with a Gender column) went onto the roster — 105
 * men, 24 women — and then onto Entries through Import CSV. The entry import
 * matched every row to its member and created 129 entries with NO gender, so
 * every lady stood on "White (tournament's)", on the men's rating, instead of
 * the course's ladies' set. Adding the same members from the roster carried
 * it; the entry import, adding one by hand, the public entry form and a casual
 * round did not.
 *
 * Nothing saw it, because the ladies' default (`ladiesTeeFor`, swept in
 * `the-organizer-decides-the-tees.test.ts`) was right: it was simply never
 * handed a woman. So this sweeps the DOORS: every write that creates a Player
 * for a club member (`memberId` in what it writes) also writes `gender`, and
 * the ones that have no member row of their own in hand ask `memberGender`.
 *
 * WHAT IT CANNOT SEE: that the gender written is the right one (the roster's
 * word, see `memberGender`), or what a screen prints for it — the knockout
 * walk of 2026-10-23 read the ladies' set back on Entries in a browser.
 */
function sources(dir = "src", out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      sources(rel, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Every `.player.create(` call in a file, as the text of the call. */
function playerCreates(code: string): string[] {
  const out: string[] = [];
  const needle = ".player.create(";
  let at = code.indexOf(needle);
  while (at >= 0) {
    let depth = 0;
    let i = at + needle.length;
    for (; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
    }
    out.push(code.slice(at, i));
    at = code.indexOf(needle, i);
  }
  return out;
}

const writesKey = (call: string, key: string) => new RegExp(`[{,\\s]${key}\\s*[:,}\\n]`).test(call);
const forAMember = (call: string) => writesKey(call, "memberId");
const writesGender = (call: string) => writesKey(call, "gender");

const files = sources();
const creates = files.flatMap((f) => playerCreates(readSource(f)).map((call) => ({ f, call })));

describe("a member entered in a tournament keeps her gender", () => {
  it("CONTROL: the sweep finds the doors, and tells a door that carries gender from one that drops it", () => {
    expect(files.length).toBeGreaterThan(400);
    // The entry import, adding by hand, the public form, a member entering
    // themselves, adding from the roster, and a casual round.
    const doors = creates.filter((c) => forAMember(c.call));
    expect(doors.length, "doors that create an entry for a member").toBeGreaterThanOrEqual(6);
    expect(new Set(doors.map((d) => d.f))).toEqual(
      new Set([
        "src/app/actions/enter.ts",
        "src/app/actions/match-setup.ts",
        "src/app/actions/register.ts",
        "src/app/actions/roster.ts",
        "src/app/actions/tournament.ts",
      ]),
    );
    expect(writesGender(".player.create({ data: { eventId, memberId, name, gender: await memberGender(memberId) } })")).toBe(true);
    expect(writesGender(".player.create({ data: { eventId, memberId, name,\n gender,\n } })")).toBe(true);
    expect(writesGender(".player.create({ data: { eventId, memberId, name, handicapType } })")).toBe(false);
    // `genderless` is not `gender`.
    expect(writesGender(".player.create({ data: { eventId, memberId, genderless: 1 } })")).toBe(false);
  });

  it("every door that creates an entry for a member writes her gender", () => {
    const dropped = creates
      .filter((c) => forAMember(c.call) && !writesGender(c.call))
      .map((c) => `${c.f}: ${c.call.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(dropped).toEqual([]);
  });

  it("the entry import reads the file's Gender column into the roster row it matches", () => {
    const code = readSource("src/app/actions/tournament.ts");
    const body = code.slice(code.indexOf("export async function importCsvSignups"), code.indexOf("export async function setInviteMessage"));
    expect(body).toMatch(/upsertMember\([\s\S]*?gender: cell\(table, cols, "gender"\)[\s\S]*?"staff"/);
    expect(body).toMatch(/gender: \(await memberGender\(memberId\)\)/);
  });
});
