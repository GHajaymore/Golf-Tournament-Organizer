import { prisma } from "@/lib/db";

/**
 * The group a one-off match goes out in.
 *
 * `Match.groupId` is NOT NULL and carries a real foreign key to `Group`, so
 * every match needs a group to belong to — `teams.ts` says the same thing at
 * its own `match.create`. Both actions below used to write `groupId: ""`, and
 * because no Group can ever have an empty id (they are all `@default(cuid())`)
 * Postgres rejected the insert every single time. A Single Match Stage could be
 * added and configured, and its match could never be made; the play-off for
 * third behaved the same way. Neither feature had ever worked against a real
 * database.
 *
 * Find-or-create by name, so re-running against the same round reuses the group
 * rather than accumulating one per attempt. It is a real group because that is
 * what it is: a final is two players going out together.
 *
 * Shared since the league week draw became a third caller; it lived private
 * to `tournament.ts` until then.
 *
 * The CARRIER a derived match is filed under — found or created by its ROUND.
 *
 * IT USED TO BE FOUND BY NAME, and the name was the whole identity. Both
 * callers built `<format> — Round <n>` from `stage.position + 1`, and this
 * function's previous comment explained at length that renumbering it "would
 * stop matching the flight already in an existing tournament and quietly
 * create a second one beside it, splitting a club's matches". That reasoning
 * was right, the danger was real, and it was guarding the wrong door.
 *
 * What actually renamed these rows was `regenerateGroupsAndSchedule`, which
 * reused Group rows by POSITION from an unfiltered list and renamed them in
 * place. Grow the field past a carrier's position, press Generate flights, and
 * the carrier became flight "C" with two players in it — and the next generate
 * could no longer find it. Exactly the split described above, by a route the
 * comment never mentioned. Measured against real rows on 2026-09-15.
 *
 * So the round is the key now, and `Group.stageId` is where it lives.
 *
 * THE FALLBACK IS NOT BELT AND BRACES — IT IS THE MIGRATION. Every carrier
 * created before that column exists has `stageId` NULL, so a lookup by round
 * alone finds nothing, creates a second row beside it, and ships the bug as
 * the fix. The name lookup is tried second and the row it finds is ADOPTED:
 * its `stageId` is set, and from then on it is found by round like any other.
 *
 * That is deliberately how the backfill happens — one row at a time, at the
 * moment the app is already writing to that round, using the key the app
 * already trusted. A bulk UPDATE was considered and refused: the development
 * database contains ZERO carriers (nobody has ever pressed the button here),
 * so a mass rewrite could not be judged against a real catalogue before it ran
 * — which is how 33 course cards were lost in August. `scripts/report-carrier-groups.mjs`
 * reports what is out there, read-only, so the bulk question can be answered
 * with a number rather than a guess.
 *
 * The NAME is now only a label, which is why it may safely come from
 * `roundLabel` one day; it is left as it is here because changing it is no
 * longer urgent and an unnecessary rename is an unnecessary risk.
 */
export async function matchCarrierGroup(eventId: string, stageId: string, name: string): Promise<string> {
  const byRound = await prisma.group.findFirst({
    where: { eventId, stageId, isCarrier: true },
    select: { id: true },
  });
  if (byRound) return byRound.id;

  /**
   * A carrier made before the columns existed, found the only way it can be.
   *
   * It has `isCarrier` false and `stageId` null, which is indistinguishable
   * from a flight by column — that IS the defect, and the name is the only
   * evidence left. So the old lookup runs once more and the row it finds is
   * adopted onto both axes.
   *
   * Narrowed to a row that claims neither, so this can never take a real
   * per-round flight or a carrier already belonging to another round.
   */
  const byName = await prisma.group.findFirst({
    where: { eventId, name, stageId: null, isCarrier: false },
    select: { id: true },
  });
  if (byName) {
    await prisma.group.update({ where: { id: byName.id }, data: { stageId, isCarrier: true } });
    return byName.id;
  }

  const maxPos = await prisma.group.aggregate({ where: { eventId }, _max: { position: true } });
  const group = await prisma.group.create({
    data: { eventId, stageId, isCarrier: true, name, position: (maxPos._max.position ?? -1) + 1 },
  });
  return group.id;
}
