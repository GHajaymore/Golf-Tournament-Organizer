import "server-only";
import { prisma } from "../db";
import { publicName, withholdNames } from "../domain/report-settings";

/**
 * WHAT A SIGNED-OUT PAGE IS HANDED (2026-10-24): its data with every player
 * whose entry says "Don't show my name on public pages" written "Player (name
 * withheld)" (`withholdNames`, over `publicName`'s rule). The public board, the
 * public report and both share cards are given their data through this, after
 * it is built and before it is drawn — so a section added later is covered
 * without knowing the rule exists. The field and the staff see the names.
 */
export async function publicCopy<T>(eventId: string, value: T): Promise<T> {
  const players = await prisma.player.findMany({ where: { eventId, publicNameWithheld: true }, select: { name: true, publicNameWithheld: true } });
  // `publicName` is the one reader of the flag: a name it would not print is withheld everywhere.
  return withholdNames(value, players.filter((p) => publicName(p) !== p.name).map((p) => p.name));
}
