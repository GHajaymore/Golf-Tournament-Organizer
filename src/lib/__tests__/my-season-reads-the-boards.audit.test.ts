import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The board is `unstable_cache`d, which throws outside a Next request; the
// identity runs the real builder, which is the code the page reads.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));
import { mySeasonFor, type MySeason, type SeasonEvent } from "@/lib/services/my-season";
import { eventReport } from "@/lib/services/event-report";
// A plain .mjs fixture, shared with the browser spec so the two read the same season.
import { seedMySeason, teardownMySeason, PEOPLE } from "../../../e2e/my-season-fixture.mjs";

/**
 * A MEMBER'S SEASON SAYS WHAT EACH TOURNAMENT'S OWN BOARD SAYS (2026-10-24).
 *
 * `e2e/my-season-fixture.mjs` holds every state the page has to word — a
 * shared place, a Stableford, a side, a round scored by hand, results held, a
 * tournament entered and not played, a waiting list, one she missed and one
 * from last season — worked out by hand in its header. This holds the service
 * to two things, separately:
 *
 *   the RULES     a place shared on the card is "T2"; a best-ball side of
 *                 Ula's birdies is 66; nothing held, last season's or not
 *                 entered reaches the page — values worked from the fixture,
 *                 not read back from the code;
 *   the READERS   every figure equals the final report's own row for her, so
 *                 the page and the report cannot become two opinions.
 *
 * And the controls, which are what make the absences mean anything: Oswin's
 * page DOES carry the prize and the place hers must not, and the stranger's
 * page is empty for the reason it should be, not because nothing loads.
 *
 *   npx vitest run --config vitest.audit.config.ts my-season-reads-the-boards
 */

const MARK = "zz-audit-myseason";
type Seeded = Awaited<ReturnType<typeof seedMySeason>>;
let seeded: Seeded;
let hers: MySeason;
let his: MySeason;
let strangers: MySeason;

beforeAll(async () => {
  seeded = await seedMySeason(MARK);
  hers = await mySeasonFor(seeded.emails.fenella, seeded.events.spring.id);
  his = await mySeasonFor(seeded.emails.oswin, seeded.events.spring.id);
  strangers = await mySeasonFor(seeded.emails.stranger, seeded.events.spring.id);
});
afterAll(async () => {
  await teardownMySeason(MARK);
});

const line = (season: MySeason, key: keyof Seeded["events"]): SeasonEvent | undefined =>
  season.events.find((e) => e.eventId === seeded.events[key].id);

/** The report's row for a player or side, by the name it prints. */
async function reportRow(key: keyof Seeded["events"], name: string) {
  const report = await eventReport(seeded.events[key].id);
  expect(report, `${key}: the report did not load`).not.toBeNull();
  const row = report!.rows.find((r) => r.name === name || r.name.startsWith(`${name} (`));
  expect(row, `${key}: no report row for ${name}`).toBeTruthy();
  return { row: row!, columns: report!.columns };
}

const figure = (e: SeasonEvent | undefined, label: string) =>
  e && (e.result.kind === "place" || e.result.kind === "side") ? e.result.figures.find((f) => f.label === label)?.value : undefined;

describe("which tournaments are her season", () => {
  it("is the club's season, on the club's day", () => {
    // The window opened sixty days ago: the season is the year it opened in,
    // and written "2026–27" when it runs across the new year.
    const key = Number(seeded.seasonOpened.slice(0, 4));
    const wraps = seeded.seasonEndsOn < seeded.seasonStartsOn;
    expect(hers.season?.key).toBe(key);
    expect(hers.season?.label).toBe(wraps ? `${key}–${String((key + 1) % 100).padStart(2, "0")}` : String(key));
    expect(hers.clubName).toBe(`${MARK} Golf Club`);
  });

  it("lists every tournament she has a row in this season, and nothing else", () => {
    const keys = (["spring", "summer", "pairs", "shield", "autumn", "winter", "foursomes", "captain", "last"] as const).filter((k) => line(hers, k));
    expect(keys.sort()).toEqual(["autumn", "foursomes", "pairs", "shield", "spring", "summer", "winter"]);
  });

  it("CONTROL: the two left out are really there to leave out", () => {
    // Oswin is in both — so their absence from her page is the rule, not a missing row.
    expect(line(his, "captain"), "the captain's prize is on his season").toBeTruthy();
    expect(line(his, "last"), "last season's medal is on nobody's season").toBeUndefined();
  });
});

describe("her place in each, as its board gives it", () => {
  it("shares second at the Spring Medal, with the report's own figures", async () => {
    const e = line(hers, "spring");
    expect(e?.result.kind).toBe("place");
    // Pip returned her exact card off her exact handicap: they share second.
    expect(e?.result.kind === "place" && e.result.place).toBe("T2");
    expect(e?.result.kind === "place" && e.result.state).toBe("Final");
    const { row, columns } = await reportRow("spring", PEOPLE.fenella);
    expect(row.place).toBe("T2");
    expect(figure(e, "Gross")).toBe(row.cells[columns.indexOf("Gross")]);
    expect(figure(e, "Net")).toBe(row.cells[columns.indexOf("Net")]);
    // Six bogeys on par 72.
    expect(figure(e, "Gross")).toBe("78");
  });

  it("wins the Summer Stableford on points", async () => {
    const e = line(hers, "summer");
    expect(e?.result.kind === "place" && e.result.place).toBe("1");
    const { row, columns } = await reportRow("summer", PEOPLE.fenella);
    expect(figure(e, "Points")).toBe(row.cells[columns.indexOf("Points")]);
    expect(figure(e, "Gross")).toBe("76");
    expect(e?.honour).toBe("Champion");
  });

  it("says the Pairs Better Ball as her SIDE's", async () => {
    const e = line(hers, "pairs");
    expect(e?.result.kind).toBe("side");
    const side = `${PEOPLE.fenella} & ${PEOPLE.ula}`;
    expect(e?.result.kind === "side" && e.result.side).toBe(side);
    expect(e?.result.kind === "side" && e.result.place).toBe("1");
    // Ula's birdies on 1–6, a 4 everywhere else: the better ball is 66.
    expect(figure(e, "Gross")).toBe("66");
    const { row, columns } = await reportRow("pairs", side);
    expect(row.place).toBe("1");
    expect(figure(e, "Gross")).toBe(row.cells[columns.indexOf("Gross")]);
  });

  it("gives a round scored by hand no place", () => {
    expect(line(hers, "shield")?.result.kind).toBe("manual");
    expect(line(hers, "shield")?.rounds).toBe(1);
  });

  it("shows nothing of a tournament whose results are held", () => {
    const e = line(hers, "autumn");
    expect(e?.result.kind).toBe("held");
    expect(e?.prizes).toEqual([]);
    expect(e?.honour).toBe("");
  });

  it("never calls somebody waiting, or yet to play, not entered", () => {
    expect(line(hers, "winter")?.result).toEqual({ kind: "entry", note: "Entered · nothing played yet" });
    expect(line(hers, "foursomes")?.result).toEqual({ kind: "entry", note: "On the waiting list" });
  });
});

describe("the season in numbers", () => {
  it("counts what she held a place in, and what she played", () => {
    // Six with a place (the waiting list is not one); five rounds with holes on them.
    expect(hers.tournaments).toBe(6);
    expect(hers.rounds).toBe(5);
    // Best net, the longest drive and the Stableford title — not the held $40.
    expect(hers.wins).toBe(3);
  });

  it("takes her bests from her own complete cards, over eighteen holes", () => {
    expect(hers.bestHoles).toBe(18);
    const best = Object.fromEntries(hers.bests.map((b) => [b.label, String(b.value)]));
    // 76 at the Stableford — not the side's 66, not the held 70.
    expect(best["Best gross"]).toBe("76");
    expect(best["Best net"]).toBe(figure(line(hers, "spring"), "Net"));
    expect(best["Best points"]).toBe(figure(line(hers, "summer"), "Points"));
  });

  it("prices only her own prize, once the tournament is over", () => {
    const spring = line(hers, "spring");
    expect(spring?.prizes.map((p) => p.what)).toEqual(["Best net"]);
    expect(spring?.prizes[0]?.amount).toMatch(/25/);
    expect(line(hers, "summer")?.prizes).toEqual([{ what: "Longest drive, 12th", amount: "" }]);
  });
});

describe("another member's season never reaches hers", () => {
  it("CONTROL: Oswin's page carries his own place and prizes", () => {
    const spring = line(his, "spring");
    expect(spring?.result.kind === "place" && spring.result.place).toBe("1");
    expect(spring?.prizes.map((p) => p.what).sort()).toEqual(["Nearest the pin, 7th", "Winner"]);
  });

  it("and none of it is on hers", () => {
    const all = JSON.stringify(hers);
    for (const theirs of ["Winner", "Nearest the pin", "Captains prize", PEOPLE.oswin]) {
      expect(all, `${theirs} is on Fenella's season`).not.toContain(theirs);
    }
  });

  it("a member with no entries has an empty season, at a club that has one", () => {
    expect(strangers.clubName).toBe(`${MARK} Golf Club`);
    expect(strangers.season).not.toBeNull();
    expect(strangers.events).toEqual([]);
    expect(strangers.tournaments).toBe(0);
  });
});
