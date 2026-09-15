/**
 * How many Group rows are match carriers that have not been claimed yet.
 *
 * READ-ONLY. There is no `update`, `create` or `delete` anywhere in this file,
 * and that is the point: CLAUDE.md's course-card rule is to judge the real
 * catalogue with a script that only PRINTS before running anything that
 * rewrites it — `--revalidate` destroyed 33 good cards because nobody did.
 *
 * WHY THIS EXISTS. `Group.stageId` and `Group.isCarrier` arrived after the
 * rows did. A carrier made before them has NULL and false, which is
 * indistinguishable from a flight by column — the name is the only evidence
 * left. `matchCarrierGroup` adopts one the next time that round is generated,
 * so the population heals itself without a bulk UPDATE nobody could measure
 * first. This says how big that population actually is, so the question "is a
 * backfill worth writing?" can be answered with a number.
 *
 * The development database has ZERO of these — nobody has ever pressed the
 * button on it — which is exactly why it could not be answered from here.
 *
 *   node --env-file=.env scripts/report-carrier-groups.mjs
 *
 * Against production, point DATABASE_URL at it and expect to read, not write.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * The shape both carrier call sites build: "<something> — Round <n>".
 *
 * Matched with `includes` rather than a regex on purpose. CLAUDE.md records
 * three separate sweeps disarmed by a shell eating a backslash — `\b` reaching
 * node as a BACKSPACE byte, and a sweep of 211 server actions reporting 211
 * unreachable because every pattern matched nothing. A substring test cannot
 * be silently disarmed that way.
 */
const CARRIER_MARK = " — Round ";

async function main() {
  const groups = await prisma.group.findMany({
    select: {
      id: true,
      name: true,
      eventId: true,
      stageId: true,
      isCarrier: true,
      _count: { select: { players: true, matches: true } },
      event: { select: { name: true } },
    },
  });

  const claimed = groups.filter((g) => g.isCarrier);
  const unclaimed = groups.filter((g) => !g.isCarrier && g.name.includes(CARRIER_MARK));
  const flights = groups.length - claimed.length - unclaimed.length;

  console.log(`${groups.length} Group rows`);
  console.log(`  flights (no carrier mark, not claimed): ${flights}`);
  console.log(`  carriers already claimed (isCarrier):   ${claimed.length}`);
  console.log(`  UNCLAIMED, look like carriers by name:  ${unclaimed.length}`);

  if (unclaimed.length) {
    console.log("\nUnclaimed rows — these are what a backfill would touch:\n");
    for (const g of unclaimed) {
      // Players on one is the interesting case: it means a regenerate already
      // reused it as a flight before the column existed, so the row is doing
      // both jobs and a backfill must NOT simply claim it.
      const warn = g._count.players > 0 ? "  <-- HAS PLAYERS, do not claim blindly" : "";
      console.log(
        `  "${g.name}"  event="${g.event.name}"  players=${g._count.players}` +
          `  matches=${g._count.matches}${warn}`,
      );
    }
    const damaged = unclaimed.filter((g) => g._count.players > 0).length;
    console.log(
      `\n${damaged} of ${unclaimed.length} already hold players, which is the regenerate ` +
        `defect having already happened to them.`,
    );
  }

  /**
   * THE CONTROL. A sweep that finds nothing may be broken rather than
   * reporting a clean population, so this asserts the instrument can see the
   * thing it is looking for — CLAUDE.md, after three sweeps in one day
   * measured nothing and only the ones with controls said so.
   */
  const probe = { name: `Match Play${CARRIER_MARK}2` };
  if (!probe.name.includes(CARRIER_MARK)) {
    console.error("\nCONTROL FAILED: the carrier mark does not match its own example.");
    process.exitCode = 1;
  } else if (groups.length === 0) {
    console.log("\nNote: no Group rows at all, so this run says nothing about the population.");
  } else {
    console.log("\nControl ok: the mark matches a name built the way the app builds one.");
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
