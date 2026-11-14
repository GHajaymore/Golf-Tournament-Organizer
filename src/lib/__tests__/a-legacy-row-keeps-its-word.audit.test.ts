import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readVerbatim } from "./source";
import { isLaunched, openToMembers } from "@/lib/domain/lifecycle-state";

/**
 * A045 MOVES EVERY OLD SETTING-UP ROW TO `draft`, KEEPS ITS WORD, CHANGES NOTHING ELSE, AND
 * THEN REFUSES ANY STATUS BUT THE THREE (state machine PR 8, J14; proposal of 3 Nov, section
 * 4c, step 3; the QA Director's test plan, S1, S2 and S4).
 *
 * Production holds real tournaments, and some may still be stored in the old ladder's two
 * later words. The migration runs there once, by `prisma migrate deploy`, and cannot be
 * watched. So this runs ITS OWN TEXT — read from the folder, never retyped — against a
 * SCRATCH COPY of one throwaway club's rows, shaped as the table was before A045 (no
 * `legacyStatus`) and set to every status the old app could store. A copy, because from A045
 * the real table refuses those statuses (that is the point of the CHECK), and because a copy
 * means nothing the test does can reach another row of the development database. The copy is
 * a real table, so the race below can use two connections; it is dropped in `finally`.
 *
 *   - each old-word row is `draft` with its word, verbatim, in `legacyStatus`;
 *   - every other column of every row is what it was (a whole-row compare, `updatedAt`
 *     included), and no `draft`, `live` or `completed` row is touched;
 *   - `playerCountMode`, whose default is the same word, is untouched (section 4a's trap);
 *   - members see exactly the tournaments they saw: the OLD rule, written out here by hand,
 *     equals `openToMembers` on the moved row, row by row;
 *   - after it, the table refuses any status but draft, live and completed (S4) — and without
 *     the CHECK the same write goes in and reads as LAUNCHED;
 *   - a table holding a status nobody expected is not failed: each such row becomes `live`
 *     (what the old code read it as), or `completed` where `live` would share a name in play,
 *     its word kept, and the CHECK still goes on (Ajay, 14 Nov: the risk is a failed deploy);
 *   - a second run changes nothing; the reversal kept in its comment puts every row back, and
 *     leaves a moved row that has since been LAUNCHED launched;
 *   - a row a launch is writing at that moment is left to the launch (the re-check).
 */

const prisma = new PrismaClient();
const TAG = "zz-legacy-word";
const MIGRATION = "prisma/migrations/A045_old_setting_up_rows_keep_their_word/migration.sql";
const SCRATCH = `zz_legacy_word_event_${process.pid}`;
const CHECK_NAME = "Event_status_is_one_the_app_writes";

type Row = Record<string, unknown> & { id: string; name: string; status: string; legacyStatus: string; registrationOpen: boolean; playerCountMode: string };

let orgId = "";
const ids: Record<string, string> = {};

/** One tournament in each status the old app could store, with the other columns varied. */
const SEEDS: { key: string; status: string; registrationOpen: boolean; playerCountMode: string; configUnlocked: boolean; capacity: number }[] = [
  { key: "draft-shut", status: "draft", registrationOpen: false, playerCountMode: "registration", configUnlocked: false, capacity: 0 },
  { key: "draft-open", status: "draft", registrationOpen: true, playerCountMode: "manual", configUnlocked: true, capacity: 24 },
  { key: "entries-shut", status: "registration", registrationOpen: false, playerCountMode: "registration", configUnlocked: false, capacity: 40 },
  { key: "entries-open", status: "registration", registrationOpen: true, playerCountMode: "manual", configUnlocked: true, capacity: 12 },
  { key: "ready-shut", status: "ready", registrationOpen: false, playerCountMode: "registration", configUnlocked: true, capacity: 0 },
  { key: "ready-open", status: "ready", registrationOpen: true, playerCountMode: "registration", configUnlocked: false, capacity: 8 },
  { key: "live", status: "live", registrationOpen: false, playerCountMode: "registration", configUnlocked: false, capacity: 0 },
  { key: "completed", status: "completed", registrationOpen: true, playerCountMode: "manual", configUnlocked: false, capacity: 0 },
];
const OLD_ROWS = SEEDS.filter((s) => s.status === "registration" || s.status === "ready").length;

/** Split SQL into statements on `;`, never inside a `$$ … $$` body, comment lines out. */
function split(sql: string): string[] {
  const text = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const out: string[] = [];
  let cur = "";
  let inBody = false;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("$$", i)) {
      inBody = !inBody;
      cur += "$$";
      i++;
      continue;
    }
    if (text[i] === ";" && !inBody) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += text[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** The migration's statements, on the scratch table: its text with the one table name swapped. */
const onScratch = (sql: string) => sql.split(`"Event"`).join(`"${SCRATCH}"`);
const statements = () => split(readVerbatim(MIGRATION));
/** The reversal its comment keeps for Ops: the lines after "Reversal", comment marks off. */
function reversal(): string[] {
  const lines = readVerbatim(MIGRATION).split(/\r?\n/);
  const from = lines.findIndex((l) => /^-- Reversal/.test(l));
  const body: string[] = [];
  for (const l of lines.slice(from + 1)) {
    if (!/^--\s{2,}\S/.test(l)) break;
    body.push(l.replace(/^--\s+/, ""));
  }
  return split(body.join("\n"));
}

async function run(sql: string[]) {
  for (const s of sql) await prisma.$executeRawUnsafe(onScratch(s));
}

/** A scratch copy of the club's rows as the table was BEFORE A045, each in its seeded status. */
async function freshScratch(statusOf: Record<string, string> = Object.fromEntries(SEEDS.map((s) => [s.key, s.status]))) {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${SCRATCH}"`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${SCRATCH}" AS SELECT * FROM "Event" WHERE "organizationId" = $1`, orgId);
  await prisma.$executeRawUnsafe(`ALTER TABLE "${SCRATCH}" DROP COLUMN IF EXISTS "legacyStatus"`);
  for (const [key, status] of Object.entries(statusOf)) {
    await prisma.$executeRawUnsafe(`UPDATE "${SCRATCH}" SET "status" = $1 WHERE "id" = $2`, status, ids[key]);
  }
}
async function snapshot(): Promise<Map<string, Row>> {
  const rows = await prisma.$queryRawUnsafe<{ id: string; row: Row }[]>(
    `SELECT e."id", to_jsonb(e) AS row FROM "${SCRATCH}" e ORDER BY e."id"`,
  );
  return new Map(rows.map((r) => [r.id, r.row]));
}
async function hasCheck(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
    CHECK_NAME,
    `"${SCRATCH}"`,
  );
  return rows[0].n === 1;
}
/** Write one status to one scratch row; the error's words if the table refuses it. */
async function write(status: string, key: string): Promise<string> {
  try {
    await prisma.$executeRawUnsafe(`UPDATE "${SCRATCH}" SET "status" = $1 WHERE "id" = $2`, status, ids[key]);
    return "taken";
  } catch (e) {
    return String((e as Error).message);
  }
}

/** Who could see it BEFORE A045, by the rule as it stood (lifecycle-state.ts at 7d28ea10), by hand. */
function openBefore(r: Row): boolean {
  const launched = r.status === "live" || r.status === "completed";
  return launched || r.registrationOpen || r.status === "registration" || r.status === "ready";
}

async function cleanup() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${SCRATCH}"`);
  await prisma.event.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  // Made in the real table as drafts (the only setting-up word it takes); the old words are set
  // on the scratch copy, never here.
  for (const s of SEEDS) {
    const row = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} ${s.key}`,
        status: s.status === "registration" || s.status === "ready" ? "draft" : s.status,
        shape: "single",
        format: "stroke",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        registrationOpen: s.registrationOpen,
        playerCountMode: s.playerCountMode,
        configUnlocked: s.configUnlocked,
        capacity: s.capacity,
        shareToken: `${TAG}-${s.key}-${process.pid}`,
      },
      select: { id: true },
    });
    ids[s.key] = row.id;
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("A045, run as written, against a copy of one club holding every old status", () => {
  it("is four statements: the column if missing, an UPDATE naming the status alone, the other words mapped, and the guarded CHECK", () => {
    const [add, update, others, guard, ...rest] = statements();
    expect(rest, "the migration holds more than the statements this test runs").toEqual([]);
    expect(add).toMatch(/^ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "legacyStatus" TEXT NOT NULL DEFAULT ''$/);
    expect(update).toMatch(/^UPDATE "Event"/);
    expect(update, "the UPDATE reaches another column").not.toMatch(/playerCountMode/);
    expect(update).toMatch(/WHERE "status" IN \('registration', 'ready'\)$/);
    expect(others).toMatch(/^UPDATE "Event" AS e/);
    expect(others, "the mapping reaches another column").not.toMatch(/playerCountMode|registrationOpen|registrationToken/);
    expect(others).toMatch(/WHERE e\."status" NOT IN \('draft', 'live', 'completed'\)$/);
    expect(guard).toMatch(/^DO \$\$/);
    expect(guard).toContain(`CHECK ("status" IN ('draft', 'live', 'completed'))`);
  });

  it("moves each old-word row to draft with its word kept, and changes nothing else on any row", async () => {
    await freshScratch();
    const before = await snapshot();
    expect(before.size).toBe(SEEDS.length);
    // Read back from the database rather than assumed: every old status is there, and no legacyStatus yet.
    expect([...before.values()].map((r) => r.status).sort()).toEqual(SEEDS.map((s) => s.status).sort());
    expect([...before.values()].every((r) => !("legacyStatus" in r)), "the copy already has the column").toBe(true);

    await run(statements());
    const after = await snapshot();

    for (const [id, was] of before) {
      const now = after.get(id)!;
      const old = was.status === "registration" || was.status === "ready";
      const expected: Row = old ? { ...was, status: "draft", legacyStatus: was.status } : { ...was, legacyStatus: "" };
      expect(now, `${was.name}: a column other than status and legacyStatus moved`).toEqual(expected);
      expect(openToMembers(now), `${was.name}: members ${openBefore(was) ? "lost" : "gained"} it`).toBe(openBefore(was));
    }
    expect([...after.values()].filter((r) => r.legacyStatus !== "").length).toBe(OLD_ROWS);
    const modes = (m: Map<string, Row>) => [...m.values()].map((r) => r.playerCountMode).sort();
    expect(modes(after), "playerCountMode moved").toEqual(modes(before));
    // The control on the compare: a moved row read WITHOUT its word is closed to members — what a
    // migration that dropped the word would do, and what the row-by-row compare above would catch.
    expect(openToMembers({ ...after.get(ids["entries-shut"])!, legacyStatus: "" })).toBe(false);
    expect(openBefore(before.get(ids["entries-shut"])!)).toBe(true);
  });

  it("then refuses any status but draft, live and completed (S4) — without the CHECK the old word goes in, as LAUNCHED", async () => {
    // Without the guard: the column and the move only. An old word written afterwards is taken,
    // and the app would read that tournament as launched.
    await freshScratch();
    const [add, update] = statements();
    await run([add, update]);
    expect(await hasCheck()).toBe(false);
    expect(await write("registration", "draft-shut"), "the unguarded table refused it").toBe("taken");
    // The danger the CHECK closes: from this PR an old word reads as LAUNCHED (setup locked, no Launch).
    expect(isLaunched("registration"), "the old word no longer reads as launched: re-read risk 1").toBe(true);

    // With the migration as written: refused, for both old words and an invented one.
    await freshScratch();
    await run(statements());
    expect(await hasCheck(), "the CHECK was not added on a table holding only the five old words").toBe(true);
    for (const bad of ["registration", "ready", "active"]) {
      expect(await write(bad, "draft-shut"), bad).toMatch(new RegExp(CHECK_NAME));
    }
    // CONTROL: the three words the app writes are all still taken.
    for (const good of ["live", "completed", "draft"]) expect(await write(good, "draft-shut"), good).toBe("taken");
  });

  it("never fails a table holding a status nobody expected: each such row becomes live, its word kept, and the CHECK still goes on", async () => {
    // Words the app never wrote, as a fixture, a script or a hand might have left them.
    const strays: Record<string, string> = { live: "active", completed: "complete", "draft-open": "LIVE " };
    await freshScratch({ ...Object.fromEntries(SEEDS.map((s) => [s.key, s.status])), ...strays });
    const before = await snapshot();
    // Read back, not assumed: the strays really are in the copy.
    for (const [key, word] of Object.entries(strays)) expect(before.get(ids[key])!.status).toBe(word);

    await run(statements());
    const after = await snapshot();

    expect(await hasCheck(), "the CHECK was left out: a stray status still blocks it").toBe(true);
    for (const [key, word] of Object.entries(strays)) {
      const was = before.get(ids[key])!;
      // The old code read every one of these as launched and unfinished (isLaunched: not on the
      // three-word pre-launch list; isFinished: exactly "completed"), so: live, word kept.
      expect(after.get(ids[key]), `${key} ("${word}")`).toEqual({ ...was, status: "live", legacyStatus: word });
    }
    expect([...after.values()].filter((r) => !["draft", "live", "completed"].includes(r.status))).toEqual([]);
    expect(after.get(ids["ready-open"])).toMatchObject({ status: "draft", legacyStatus: "ready" });
    // And the table now refuses the stray word it was handed.
    expect(await write("active", "draft-shut")).toMatch(new RegExp(CHECK_NAME));
  });

  it("makes a stray that would share a name in play completed, so the A036 name index cannot refuse the deploy", async () => {
    // One stray named like a draft of its club; two strays named like each other.
    const strays: Record<string, string> = { live: "active", completed: "active", "draft-open": "started" };
    const [first, second] = ["completed", "draft-open"].sort((a, b) => (ids[a] < ids[b] ? -1 : 1));
    async function shaped() {
      await freshScratch({ ...Object.fromEntries(SEEDS.map((s) => [s.key, s.status])), ...strays });
      await prisma.$executeRawUnsafe(`UPDATE "${SCRATCH}" SET "name" = $1 WHERE "id" = $2`, `${TAG}   DRAFT-SHUT`, ids.live);
      await prisma.$executeRawUnsafe(`UPDATE "${SCRATCH}" SET "name" = $1 WHERE "id" IN ($2, $3)`, `${TAG} twin`, ids[first], ids[second]);
      // A036's index, as written, on the copy.
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "${SCRATCH}_name_in_play" ON "${SCRATCH}" ("organizationId", lower(btrim(regexp_replace("name", '\\s+', ' ', 'g')))) WHERE "status" IN ('draft', 'registration', 'ready', 'live') AND "shape" <> 'match'`,
      );
    }
    const [add, update] = statements();

    // CONTROL: the plain rule (every stray to live) is refused by the index on this very table —
    // the deploy that fails partway.
    await shaped();
    await run([add, update]);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "${SCRATCH}" SET "status" = 'live' WHERE "status" NOT IN ('draft', 'live', 'completed')`),
    ).rejects.toThrow(/unique|duplicate|23505/i);

    await shaped();
    const before = await snapshot();
    await run(statements());
    const after = await snapshot();
    expect(await hasCheck()).toBe(true);
    expect(after.get(ids.live), "a stray beside a draft of its name").toEqual({ ...before.get(ids.live)!, status: "completed", legacyStatus: "active" });
    expect(after.get(ids[first]), "the earlier of two strays of one name").toEqual({ ...before.get(ids[first])!, status: "live", legacyStatus: strays[first] });
    expect(after.get(ids[second]), "the later of two strays of one name").toEqual({ ...before.get(ids[second])!, status: "completed", legacyStatus: strays[second] });
  });

  it("is safe to run twice: the second run changes nothing and adds no second CHECK", async () => {
    await freshScratch();
    await run(statements());
    const once = await snapshot();
    await run(statements());
    expect(await snapshot()).toEqual(once);
    expect(await hasCheck()).toBe(true);
  });

  it("is undone by the reversal its comment keeps: every row back in its old status", async () => {
    await freshScratch();
    const before = await snapshot();
    await run(statements());
    const back = reversal();
    expect(back.map((s) => s.split(/\s+/).slice(0, 3).join(" "))).toEqual(["ALTER TABLE \"Event\"", "UPDATE \"Event\" SET", "ALTER TABLE \"Event\""]);
    await run(back);
    const restored = await snapshot();
    expect(restored, "the reversal did not put every row back exactly").toEqual(before);
    expect(await hasCheck()).toBe(false);
  });

  it("never un-launches: a moved row launched since the migration stays live through the reversal", async () => {
    await freshScratch();
    await run(statements());
    // Launched after the move: `live`, its old word still in legacyStatus.
    await prisma.$executeRawUnsafe(`UPDATE "${SCRATCH}" SET "status" = 'live' WHERE "id" = $1`, ids["entries-shut"]);
    expect((await snapshot()).get(ids["entries-shut"])).toMatchObject({ status: "live", legacyStatus: "registration" });
    await run(reversal());
    const back = await snapshot();
    expect(back.get(ids["entries-shut"])!.status, "the reversal set a launched tournament back to its old word").toBe("live");
    // CONTROL: the moved rows still in setting up DO go back.
    expect(back.get(ids["ready-open"])!.status).toBe("ready");
    expect(back.get(ids["entries-open"])!.status).toBe("registration");
  });

  it("leaves a row to a launch that is writing it at that moment (the re-check, READ COMMITTED)", async () => {
    // A launch holds the row's lock and writes `live`; the migration's UPDATE starts on another
    // connection and must wait; the launch commits; the UPDATE re-reads the row, finds it no longer
    // in an old word, and skips it.
    await freshScratch();
    const [add, update] = statements();
    await run([add]);
    let committedAt = 0;
    let migrated: Promise<{ n: number; at: number }> | null = null;
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "${SCRATCH}" SET "status" = 'live' WHERE "id" = $1`, ids["entries-shut"]);
        // `.then` SENDS it: a Prisma query is lazy and would otherwise wait for its own await.
        migrated = prisma.$executeRawUnsafe(onScratch(update)).then((n) => ({ n, at: Date.now() }));
        // Long enough for the UPDATE to reach the locked row and wait on it.
        await new Promise((r) => setTimeout(r, 750));
        committedAt = Date.now();
      },
      { timeout: 20_000 },
    );
    const done = await migrated!;
    // The control: it really did wait for the launch, so what follows is the re-check's answer.
    expect(done.at, "the UPDATE did not wait on the launch's lock").toBeGreaterThanOrEqual(committedAt);
    expect(done.n, "rows moved: the other three old-word rows, not the launched one").toBe(OLD_ROWS - 1);
    const after = await snapshot();
    expect(after.get(ids["entries-shut"])).toMatchObject({ status: "live", legacyStatus: "" });
  });
});
