import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { STATUS_META } from "@/lib/format";
import { PRE_LAUNCH_STATUSES, isLaunched } from "@/lib/domain/lifecycle-state";

/**
 * A TOURNAMENT'S STATUS IS ONE OF THE FIVE THE APP KNOWS.
 *
 * The verification estate seeded `status: "active"`, which the app never
 * writes. Nothing failed, because the one function most code asks —
 * `isLaunched` — answers "launched" for it: the test is NOT being on the
 * pre-launch list, and an invented status is not on any list. So the fixture
 * behaved like a live tournament everywhere that mattered, and differed
 * everywhere that read the status itself:
 *
 *   - `STATUS_META` has no entry, and the lookup falls back to DRAFT, so every
 *     screen in the e2e suite showed "Draft" on a tournament with cards in it;
 *   - `nextLifecycleAction` returned null rather than "Complete tournament",
 *     so the dashboard offered no way to finish and no test has ever pressed
 *     that control from the main fixture;
 *   - the live dot never appeared.
 *
 * This is the divergence `lifecycle-state.ts` predicts in its own words — the
 * two lists "agree today because the two sets happen to cover every status,
 * and they would diverge the moment a sixth is added". A sixth had been added,
 * in the fixtures, and nothing was looking.
 */

const LEGAL = new Set([...PRE_LAUNCH_STATUSES, "live", "completed"]);

describe("the statuses the app knows", () => {
  it("are labelled and listed by the same set", () => {
    /**
     * The code half. `STATUS_META` is what a screen prints and
     * `PRE_LAUNCH_STATUSES` is what decides whether a tournament has launched;
     * a status in one and not the other is either unprintable or unclassified,
     * and both fail quietly rather than loudly.
     */
    expect(new Set(Object.keys(STATUS_META))).toEqual(LEGAL);
  });

  it("classify every one of them the way the labels imply", () => {
    // The control on the set above: a list that agreed with itself but put
    // "live" on the pre-launch side would satisfy the first cell exactly.
    for (const s of PRE_LAUNCH_STATUSES) expect(isLaunched(s), `${s} reads as launched`).toBe(false);
    for (const s of ["live", "completed"]) expect(isLaunched(s), `${s} reads as unlaunched`).toBe(true);
  });
});

/**
 * The fixture half, scoped to `e2e/` and `scripts/`.
 *
 * WRITTEN TWICE, and the first version is the reason this paragraph is here.
 * It searched for any `status: "..."` in those directories and reported
 * sixteen violations — every one of them a PLAYER ("confirmed"), a SCORECARD
 * ("entered", "certified", "approved", "disputed") or a subscription. Four
 * models share the field name, and a sweep that cannot tell them apart is
 * noise somebody turns off.
 *
 * So it reads a window after each `prisma.event.create(` / `.update(` instead,
 * and takes the first `status:` inside it. That is a heuristic, which is why
 * the cell below it asserts the window actually finds the fixture's own —
 * a window too narrow would report a clean sweep of nothing.
 */
const EVENT_WRITE = /prisma\.event\.(?:create|update)\(/g;

/**
 * Every status handed to an EVENT write in this file.
 *
 * Depth-aware, and it has to be. A window of text after the call also contains
 * the nested `players: { create: [...] }`, whose rows carry a `status` of their
 * own — `scripts/load-board.mjs` seeds an event with no status at all (so it
 * takes the default) and thirty players who are "confirmed", and a flat search
 * reported that as the tournament's. So this walks braces from `data: {` and
 * takes only a `status` that is a DIRECT property of it.
 */
function seededStatuses(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(EVENT_WRITE)) {
    const from = body.indexOf("data: {", m.index ?? 0);
    if (from === -1) continue;

    let depth = 0;
    let i = from + "data:".length;
    for (; i < body.length; i += 1) {
      const c = body[i];
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) break;
      } else if (depth === 1 && body.startsWith("status:", i)) {
        const status = body.slice(i, i + 40).match(/^status: "([a-z-]+)"/);
        if (status) out.push(status[1]);
      }
    }
  }
  return out;
}
function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else if (/\.(ts|mjs)$/.test(entry)) out.push(full.slice(process.cwd().length + 1));
  }
  return out;
}

const FIXTURE_FILES = [
  ...filesUnder(join(process.cwd(), "e2e")),
  ...filesUnder(join(process.cwd(), "scripts")),
];

describe("no fixture invents a tournament status", () => {
  it("has fixture files to search", () => {
    // The control. A sweep over nothing reports nothing wrong.
    expect(FIXTURE_FILES.length).toBeGreaterThan(10);
  });

  it("actually finds the statuses it is meant to judge", () => {
    /**
     * THE CONTROL, and the one that keeps this file honest. A window too
     * narrow, a renamed call or a `readSource` returning nothing would all
     * produce a clean sweep of nothing at all — the failure CLAUDE.md records
     * three sweeps having shipped with.
     *
     * The main fixture seeds exactly one tournament, and it is live.
     */
    const fixture = seededStatuses(readSource(join("e2e", "fixture.mjs")));
    expect(fixture, "the sweep can no longer see the fixture's own event").toEqual(["live"]);
  });

  it("gives every seeded tournament a status the app writes", () => {
    const offenders: string[] = [];
    for (const file of FIXTURE_FILES) {
      // Comments stripped, or the paragraph explaining this rule in
      // `fixture.mjs` is itself reported as a violation — the `readSource`
      // trap, which this repo has paid for twice.
      for (const status of seededStatuses(readSource(file))) {
        if (!LEGAL.has(status)) offenders.push(`${file}: "${status}"`);
      }
    }
    expect(
      offenders,
      `a seeded tournament has a status the app never writes, so it renders with the Draft label ` +
        `and offers no way to complete: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("does not mistake another model's status for a tournament's", () => {
    /**
     * The mirror control, against the first version of this sweep — which
     * reported sixteen violations, every one a player or a scorecard. Those
     * words are still all over these files and must stay invisible here.
     */
    const sample = [
      'await prisma.player.create({ data: { status: "confirmed" } });',
      'await prisma.scorecard.create({ data: { status: "disputed" } });',
    ].join("\n");
    expect(seededStatuses(sample)).toEqual([]);

    // And it does see an event write, so the cell above is not passing because
    // the matcher finds nothing anywhere.
    expect(seededStatuses('await prisma.event.create({ data: { status: "live" } });')).toEqual(["live"]);
    expect(LEGAL.has("active")).toBe(false);

    // The nested case, which is what made the first version of this sweep
    // report sixteen violations: an event seeded with a field of players.
    const nested =
      'await prisma.event.create({ data: { name: "x", players: { create: [{ status: "confirmed" }] } } });';
    expect(seededStatuses(nested), "a nested player's status read as the tournament's").toEqual([]);
  });
});
