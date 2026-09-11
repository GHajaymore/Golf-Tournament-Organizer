/**
 * Give every tournament entry the roster identity it should have had.
 *
 * The identity of a person here is `Member.id` inside an organization, not
 * their email address — `createPlaySession` has always signed
 * `stageId:playerId`, and entries may now be made with no address at all. The
 * link that carries that identity is `Player.memberId`, and the schema is
 * honest about why it is nullable: "Optional only so that entries made before
 * the roster existed remain valid; every path that creates a player now goes
 * through a Member."
 *
 * Every path creates it TODAY. Nothing has ever gone back for the rows written
 * before that, and those entries are identified by a credential or by nothing
 * at all. This is the going-back.
 *
 * REPORTS AND CHANGES NOTHING BY DEFAULT. Read the report, look at the
 * refusals BY NAME, then re-run with --apply. That order is not ceremony: the
 * course-card pass that skipped it destroyed 33 good cards, and this file is
 * shaped so the safe order is the easy one.
 *
 *   npx tsx scripts/repair-player-identity.ts
 *   npx tsx scripts/repair-player-identity.ts --apply
 *   npx tsx scripts/repair-player-identity.ts --org <organizationId>
 *
 * IDEMPOTENT. An entry that gains a link is "already linked" on every later
 * run. Running it twice is how you finish the job rather than a risk: two
 * address-less entries for one person nobody has on the roster both plan a
 * CREATE on the first pass, because a member invented for one is deliberately
 * not visible to the other — the second pass links the second entry to the
 * member the first made. See `planRepair`.
 *
 * The decision is in `domain/identity-repair.ts` and the IO in
 * `services/identity-repair.ts`; this file is the CLI and nothing else, so
 * what it does can be proved against real rows by the audit suite rather than
 * by running it and looking.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { loadRepair, applyRepair } from "../src/lib/services/identity-repair";

const APPLY = process.argv.includes("--apply");
const ORG_FLAG = process.argv.indexOf("--org");
const ONLY_ORG = ORG_FLAG > -1 ? process.argv[ORG_FLAG + 1] : undefined;

async function main() {
  const loaded = await loadRepair(ONLY_ORG);
  const { plan, byId } = loaded;

  const prisma = new PrismaClient();
  const orgName = new Map(
    (await prisma.organization.findMany({ select: { id: true, name: true } })).map((o) => [o.id, o.name]),
  );
  await prisma.$disconnect();

  console.log(`\nEntries: ${loaded.players}   Roster members: ${loaded.members}`);
  console.log(`  already linked      ${plan.ok.length}`);
  console.log(`  link to a member    ${plan.link.length}`);
  console.log(`  create a member     ${plan.create.length}`);
  console.log(`  cannot decide       ${plan.ambiguous.length}`);

  /**
   * BY NAME, not by count. "A rule that clears a large slice is wrong about
   * golf, not right about the data" — the same instinct, and the only way to
   * notice a repair about to invent forty members for one person typed forty
   * different ways.
   */
  if (plan.link.length) {
    console.log("\n--- would link ---");
    for (const o of plan.link) {
      if (o.kind !== "link") continue;
      const p = byId.get(o.player.id)!;
      console.log(`  ${p.name}  (${p.event.name})  -> member ${o.memberId}  matched on ${o.matchedOn}`);
    }
  }
  if (plan.create.length) {
    console.log("\n--- would create a roster member ---");
    for (const o of plan.create) {
      const p = byId.get(o.player.id)!;
      console.log(
        `  ${p.name}  <${p.email || "no address"}>  (${p.event.name} · ${orgName.get(p.event.organizationId) ?? "?"})`,
      );
    }
  }
  if (plan.ambiguous.length) {
    console.log("\n--- CANNOT DECIDE, left alone ---");
    for (const o of plan.ambiguous) {
      if (o.kind !== "ambiguous") continue;
      const p = byId.get(o.player.id)!;
      console.log(`  ${p.name}  (${p.event.name}): ${o.reason}`);
    }
  }

  if (!APPLY) {
    console.log(
      plan.link.length + plan.create.length === 0
        ? "\nNothing to do.\n"
        : "\nReport only. Re-run with --apply to make these changes.\n",
    );
    return;
  }

  const done = await applyRepair(loaded);
  console.log(`\nLinked ${done.linked}. Created ${done.created} roster member(s).`);
  if (done.ambiguous) {
    console.log(`${done.ambiguous} entr${done.ambiguous === 1 ? "y" : "ies"} left for a human — see above.`);
  }
  console.log("Re-run without --apply to confirm, and again to pick up anything a created member now matches.\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
