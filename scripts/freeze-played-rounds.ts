/**
 * Freeze the rounds that were played before the freeze existed.
 *
 * A round scored since `46_round_handicap` shipped freezes on its first
 * returned card. A round scored BEFORE it has cards and no frozen value, so it
 * is still resolved live — and a roster handicap edited next week silently
 * re-scores it. That is the one thing this feature exists to prevent, and every
 * round already in the database is in that state.
 *
 * It writes what the board is using RIGHT NOW, through the same
 * `freezeRoundHandicaps` a card save calls, so no number on any screen changes.
 * It only stops them changing later.
 *
 * Dry run by default — it prints what it would freeze and writes nothing:
 *
 *   npx tsx --require ./scripts/server-shim.cjs scripts/freeze-played-rounds.ts
 *   npx tsx --require ./scripts/server-shim.cjs scripts/freeze-played-rounds.ts --apply
 *
 * Safe to re-run: freezing is idempotent, and a round already frozen is left
 * exactly as it is.
 */
import { prisma } from "../src/lib/db";
import { freezeRoundHandicaps, roundHasReturnedCard } from "../src/lib/services/round-handicap";

const APPLY = process.argv.includes("--apply");

async function main() {
  const events = await prisma.event.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  let rounds = 0;
  let players = 0;

  for (const event of events) {
    const stages = await prisma.stage.findMany({
      where: { eventId: event.id },
      select: { id: true, position: true, type: true },
      orderBy: { position: "asc" },
    });

    for (const stage of stages) {
      if (!(await roundHasReturnedCard(event.id, stage.id))) continue;
      const unfrozen = await prisma.roundHandicap.count({
        where: { eventId: event.id, stageId: stage.id, frozen: { not: null } },
      });
      const field = await prisma.player.count({
        where: { eventId: event.id, status: "confirmed" },
      });
      if (unfrozen >= field && field > 0) continue;

      rounds += 1;
      if (APPLY) {
        const wrote = await freezeRoundHandicaps(event.id, stage.id);
        players += wrote;
        console.log(`froze  ${event.name} — round ${stage.position + 1} (${stage.type}): ${wrote} players`);
      } else {
        players += Math.max(0, field - unfrozen);
        console.log(
          `would  ${event.name} — round ${stage.position + 1} (${stage.type}): ${field - unfrozen} players`,
        );
      }
    }
  }

  console.log(
    `\n${APPLY ? "Froze" : "Would freeze"} ${players} player-rounds across ${rounds} rounds.` +
      (APPLY ? "" : "\nRe-run with --apply to write them."),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
