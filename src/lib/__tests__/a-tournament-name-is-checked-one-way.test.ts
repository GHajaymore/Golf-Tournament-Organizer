import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import {
  NAME_HOLDING_STATUSES,
  freeName,
  holdsItsName,
  isUnnamed,
  nameClash,
  nameKey,
  nameTakenRefusal,
  tellApart,
} from "@/lib/domain/tournament-name";
import { EVENT_STATUSES } from "@/lib/domain/phase-gate";
import { readVerbatim } from "./source";

/**
 * ONE NAME IN PLAY PER CLUB (Ajay, 2026-11-01: "year may not solve. what if they run same
 * tournament twice a year?").
 *
 * The rule: no two of a club's tournaments still in play — draft, registration, ready, live —
 * share a name, compared without case and with spaces collapsed. Completed ones may share a
 * name with anything and are told apart on a list by their date. ONE function holds it
 * (`domain/tournament-name.ts`, asked through `tournamentNameRefusal`), every door calls it, and
 * the sweeps below refuse a second copy of the comparison and a door that skips it.
 */

const t = (id: string, name: string, status = "live", shape = "single") => ({ id, name, status, shape });

describe("the rule", () => {
  it("compares names without case, and with runs of spaces collapsed and the ends trimmed", () => {
    expect(nameKey("  Spring   Medal ")).toBe("spring medal");
    expect(nameKey("SPRING MEDAL")).toBe(nameKey("spring medal"));
    expect(nameKey("Spring\tMedal")).toBe("spring medal");
    // Different words stay different: a punctuation mark is part of the name.
    expect(nameKey("Spring Medal.")).not.toBe(nameKey("Spring Medal"));
  });

  it("holds a name in every step before launch and live, and never once completed", () => {
    for (const s of ["draft", "registration", "ready", "live"]) expect(holdsItsName({ status: s, shape: "single" }), s).toBe(true);
    expect(holdsItsName({ status: "completed", shape: "single" })).toBe(false);
    // Every status the app can write is one or the other, and the list is the index's four words.
    expect(EVENT_STATUSES.filter((s) => !holdsItsName({ status: s, shape: "series" }))).toEqual(["completed"]);
    expect([...NAME_HOLDING_STATUSES].sort()).toEqual(["draft", "live", "ready", "registration"]);
  });

  it("never counts a casual round, which is named after whoever is in it", () => {
    expect(holdsItsName({ status: "live", shape: "match" })).toBe(false);
    expect(nameClash({ name: "Alex v Sam", selfId: null, others: [t("a", "Alex v Sam", "live", "match")] })).toBeNull();
  });

  it("finds the in-play tournament holding a name, whatever its case or spacing", () => {
    const others = [t("old", "Spring Medal", "completed"), t("now", "Spring  medal ", "draft")];
    expect(nameClash({ name: "SPRING MEDAL", selfId: null, others })?.id).toBe("now");
  });

  it("lets completed tournaments share a name with each other and with one in play", () => {
    const shelf = [t("y1", "Spring Medal", "completed"), t("y2", "Spring Medal", "completed")];
    expect(nameClash({ name: "Spring Medal", selfId: null, others: shelf })).toBeNull();
    // Renaming a completed one: the caller asks only for a tournament that holds its name.
    expect(nameClash({ name: "Spring Medal", selfId: "y1", others: [...shelf, t("now", "Spring Medal", "live")] })?.id).toBe("now");
  });

  it("never clashes a tournament with itself (a rename that keeps the name)", () => {
    expect(nameClash({ name: "spring medal", selfId: "now", others: [t("now", "Spring Medal", "live")] })).toBeNull();
  });

  it("refuses reopening while another in play holds the name, and lets it back when it is free", () => {
    // The reopened one is `selfId`; the other is this year's, live.
    const reopened = t("y1", "Spring Medal", "completed");
    expect(nameClash({ name: reopened.name, selfId: reopened.id, others: [reopened, t("y2", "Spring Medal", "live")] })?.id).toBe("y2");
    expect(nameClash({ name: reopened.name, selfId: reopened.id, others: [reopened, t("y2", "Spring Medal", "completed")] })).toBeNull();
  });

  it("offers a free name — the year first, then (2) — without the name already on the shelf", () => {
    expect(freeName({ name: "Spring Medal", taken: ["Spring Medal"], year: "2026", max: 100 })).toBe("Spring Medal 2026");
    expect(freeName({ name: "Spring Medal 2026", taken: ["spring medal 2026"], year: "2026", max: 100 })).toBe("Spring Medal 2026 (2)");
    expect(freeName({ name: "Spring Medal", taken: ["Spring Medal", "spring medal 2026", "Spring Medal (2)"], year: "2026", max: 100 })).toBe("Spring Medal (3)");
    // Within the name's limit, by shortening the name and never the number.
    const long = "x".repeat(100);
    const free = freeName({ name: long, taken: [long], year: "2026", max: 100 });
    expect(free.length).toBeLessThanOrEqual(100);
    expect(free.endsWith(" 2026")).toBe(true);
  });

  it("still knows the app's placeholder when it was made free, and never mistakes a chosen name for it", () => {
    for (const n of ["", "New Tournament", " new  tournament ", "New Tournament 2026", "New Tournament (3)"]) expect(isUnnamed(n), n).toBe(true);
    for (const n of ["New Tournament Cup", "New Tournament (copy)", "Spring Medal"]) expect(isUnnamed(n), n).toBe(false);
  });

  it("says which tournament holds the name, how to fix it, and a free name", () => {
    const words = nameTakenRefusal({ wanted: "spring medal", holder: { name: "Spring Medal", status: "draft" }, suggestion: "Spring Medal 2026", door: "create" });
    expect(words).toContain("“Spring Medal” (setting up)");
    expect(words).toContain("“Spring Medal 2026” is free");
    expect(words).toMatch(/rename or complete/);
    const reopen = nameTakenRefusal({ wanted: "Spring Medal", holder: { name: "Spring Medal", status: "live" }, suggestion: "Spring Medal (2)", door: "reopen" });
    expect(reopen).toMatch(/can’t be reopened under its name/);
    expect(reopen).toContain("(live)");
    expect(reopen).toMatch(/Rename this one first/);
  });
});

describe("telling apart the tournaments that share a name", () => {
  const row = (id: string, name: string, startOn: string, at: string, extra: Partial<{ organizationId: string; dates: string; endOn: string }> = {}) => ({
    id,
    organizationId: extra.organizationId ?? "club",
    name,
    startOn,
    endOn: extra.endOn ?? "",
    dates: extra.dates ?? "",
    createdAt: new Date(at),
    organization: { timeZone: "Europe/London", locale: "en-GB" },
  });

  it("writes nothing beside a name nobody else on the list uses", () => {
    expect(tellApart([row("a", "Spring Medal", "2025-04-12", "2025-01-01T12:00:00Z"), row("b", "Autumn Cup", "2025-04-12", "2025-01-02T12:00:00Z")]).size).toBe(0);
  });

  it("tells two of one name apart by their dates, written the club's way", () => {
    const told = tellApart([
      row("y1", "Spring Medal", "2025-04-12", "2025-01-01T12:00:00Z"),
      row("y2", "spring medal", "2026-04-11", "2026-01-01T12:00:00Z"),
    ]);
    expect(told.get("y1")).toBe("12 Apr 2025");
    expect(told.get("y2")).toBe("11 Apr 2026");
  });

  it("numbers twins of one club that share the date too, in the order the club made them", () => {
    const told = tellApart([
      row("second", "Spring Medal", "2026-04-11", "2026-02-01T12:00:00Z"),
      row("first", "Spring Medal", "2026-04-11", "2026-01-01T12:00:00Z"),
    ]);
    expect(told.get("first")).toBe("11 Apr 2026 · #1");
    expect(told.get("second")).toBe("11 Apr 2026 · #2");
    // Another club's Spring Medal on the same day is not counted among them.
    const two = tellApart([
      row("ours", "Spring Medal", "2026-04-11", "2026-01-01T12:00:00Z"),
      row("theirs", "Spring Medal", "2026-04-11", "2026-02-01T12:00:00Z", { organizationId: "elsewhere" }),
    ]);
    expect([two.get("ours"), two.get("theirs")]).toEqual(["11 Apr 2026", "11 Apr 2026"]);
  });

  it("says the day it was created, at the club, where it has no dates", () => {
    // 23:30 on 31 Dec in London is the 31st; the server's clock is not asked.
    const told = tellApart([row("a", "Medal", "", "2025-12-31T23:30:00Z"), row("b", "Medal", "", "2026-03-01T12:00:00Z")]);
    expect(told.get("a")).toBe("created 31 Dec 2025");
    // In Auckland the same instant is already the 1st of January.
    const nz = tellApart([
      { ...row("a", "Medal", "", "2025-12-31T23:30:00Z"), organization: { timeZone: "Pacific/Auckland", locale: "en-GB" } },
      row("b", "Medal", "", "2026-03-01T12:00:00Z"),
    ]);
    expect(nz.get("a")).toBe("created 1 Jan 2026");
  });

  it("keeps the dates an older row's organizer typed, where it has no calendar dates", () => {
    const told = tellApart([row("a", "Medal", "", "2024-01-01T12:00:00Z", { dates: "May 2024" }), row("b", "Medal", "2026-05-02", "2026-01-01T12:00:00Z")]);
    expect(told.get("a")).toBe("May 2024");
  });
});

/* ── The sweeps ───────────────────────────────────────────────────────────────────────────── */

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      sources(rel, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** A tournament's name normalised by hand — the comparison this file says is asked one way. */
const HAND_KEY = /\b(?:ev|event|e|t|tournament|source|existing)\.name\.(?:trim\(\)\.)?toLowerCase\(\)/;

/**
 * Files that create a tournament without the name check, each with its reason.
 */
const CREATES_WITHOUT_THE_CHECK: Record<string, string> = {
  // A casual round is outside the rule (`holdsItsName`): named after whoever is in it.
  "src/app/actions/match-setup.ts": "casual round",
  // The invented demo club, rebuilt from nothing each time with two fixed, different names.
  "src/lib/services/demo-club.ts": "the demo club",
};

describe("the sweeps", () => {
  it("CONTROL: the sweep sees a tournament name normalised by hand, and not a player's", () => {
    expect(HAND_KEY.test("const key = ev.name.trim().toLowerCase();")).toBe(true);
    expect(HAND_KEY.test("if (event.name.toLowerCase() === wanted) return;")).toBe(true);
    expect(HAND_KEY.test("const key = nameKey(ev.name);")).toBe(false);
    expect(HAND_KEY.test("const key = p.name.toLowerCase();")).toBe(false);
  });

  it("no tournament name is normalised outside the rule", () => {
    const files = sources("src");
    expect(files.length).toBeGreaterThan(200);
    const strays = files.filter((f) => !f.endsWith("domain/tournament-name.ts") && HAND_KEY.test(readSource(f)));
    expect(strays, "compare tournament names through nameKey / nameClash in domain/tournament-name.ts").toEqual([]);
  });

  it("CONTROL: the door sweep sees a create that skips the check", () => {
    const bare = "export async function makeOne() { await prisma.event.create({ data: { name } }); }";
    expect(createsWithoutTheCheck(bare)).toBe(true);
    expect(createsWithoutTheCheck("const made = await withNameBackstop(() => prisma.event.create({ data: { name } }), door);")).toBe(false);
  });

  it("every file that creates a tournament creates it through the name's backstop, or says why not", () => {
    const strays = sources("src")
      .filter((f) => !CREATES_WITHOUT_THE_CHECK[f])
      .filter((f) => createsWithoutTheCheck(readSource(f)));
    expect(strays, "call tournamentNameRefusal and create through withNameBackstop (services/tournament-name.ts)").toEqual([]);
  });

  it("every door a name comes into play through asks the one function", () => {
    const actions = readSource("src/app/actions/tournament.ts");
    for (const door of ["createEvent", "cloneEvent", "saveEvent", "setEventStatus"]) {
      const body = functionBody(actions, door);
      expect(body, `${door} not found`).not.toBe("");
      expect(body, `${door} does not ask tournamentNameRefusal`).toMatch(/tournamentNameRefusal\(/);
      expect(body, `${door} does not write through withNameBackstop`).toMatch(/withNameBackstop\(/);
    }
  });

  it("the database's backstop says what the rule says", () => {
    const sql = readVerbatim("prisma/migrations/A036_a_name_in_play_is_the_clubs_once/migration.sql");
    const listed = [...sql.matchAll(/"status" IN \(([^)]*)\)/g)].map((m) => m[1].replace(/'/g, "").split(/,\s*/).sort());
    expect(listed.length).toBe(2);
    for (const l of listed) expect(l).toEqual([...NAME_HOLDING_STATUSES].sort());
    expect(sql).toMatch(/"shape" <> 'match'/);
    expect(sql).toMatch(/lower\(btrim\(regexp_replace\("name", '\\s\+', ' ', 'g'\)\)\)/);
  });
});

function createsWithoutTheCheck(src: string): boolean {
  return /\bevent\.create\(/.test(src) && !/withNameBackstop\(/.test(src);
}

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}
