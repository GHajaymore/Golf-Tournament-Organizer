import { prisma } from "@/lib/db";
import { clubToday } from "@/lib/domain/club-clock";
import { TITLE_MAX } from "@/lib/domain/typed-limits";
import {
  NAME_HOLDING_STATUSES,
  NAME_TAKEN_RACE,
  freeName,
  nameClash,
  nameTakenRefusal,
  type NameDoor,
} from "@/lib/domain/tournament-name";

/**
 * THE ONE QUESTION EVERY DOOR ASKS before a name comes into play: is it free in this club?
 * The rule is `domain/tournament-name.ts`; this reads the club's tournaments for it.
 *
 * Every argument is REQUIRED, so a new door is listed by the compiler the day the rule grows:
 * the club, the name, the tournament itself (null when it is new) and which door it is.
 * Returns the refusal in words, or null when the name may be used.
 */
export async function tournamentNameRefusal(input: {
  organizationId: string;
  name: string;
  selfId: string | null;
  door: NameDoor;
}): Promise<string | null> {
  const others = await prisma.event.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: [...NAME_HOLDING_STATUSES] },
      shape: { not: "match" },
      ...(input.selfId ? { id: { not: input.selfId } } : {}),
    },
    select: { id: true, name: true, status: true, shape: true },
  });
  const holder = nameClash({ name: input.name, selfId: input.selfId, others });
  if (!holder) return null;
  const suggestion = await freeTournamentName({ organizationId: input.organizationId, name: input.name, selfId: input.selfId });
  return nameTakenRefusal({ wanted: input.name, holder, suggestion, door: input.door });
}

/**
 * A name of the club's that nobody uses — the year, or "(2)" — for the refusal to offer, and
 * for the two doors that NAME a tournament themselves when the organizer left the box empty
 * ("New Tournament", "… (copy)"), where there is nobody to refuse and so the free one is used.
 */
export async function freeTournamentName(input: { organizationId: string; name: string; selfId: string | null }): Promise<string> {
  const [rows, org] = await Promise.all([
    prisma.event.findMany({
      where: { organizationId: input.organizationId, ...(input.selfId ? { id: { not: input.selfId } } : {}) },
      select: { name: true },
    }),
    prisma.organization.findUnique({ where: { id: input.organizationId }, select: { timeZone: true } }),
  ]);
  return freeName({
    name: input.name,
    taken: rows.map((r) => r.name),
    // The club's year, not the server's: on New Year's Eve in Auckland it is already next year.
    year: clubToday(org?.timeZone).slice(0, 4),
    max: TITLE_MAX,
  });
}

/**
 * The name as given where it is free, or a free one. Only for a name the APP chose.
 */
export async function nameOrFree(input: { organizationId: string; name: string; selfId: string | null }): Promise<string> {
  const refused = await tournamentNameRefusal({ ...input, door: "create" });
  return refused ? freeTournamentName(input) : input.name;
}

/**
 * Whether an error is the database's backstop (`Event_name_in_play_key`, migration A036)
 * refusing a name — two presses in the same instant, both of which passed the check above.
 */
export function isNameInPlayViolation(e: unknown): boolean {
  const err = e as { code?: string; meta?: unknown; message?: string } | null;
  if (!err) return false;
  const said = `${err.message ?? ""} ${JSON.stringify(err.meta ?? {})}`;
  if (said.includes("Event_name_in_play_key")) return true;
  // Prisma names the fields of an index it does not model by the index's own expression.
  return err.code === "P2002" && /lower\(btrim\(regexp_replace/.test(said);
}

/**
 * Runs a write that brings a name into play, and turns the backstop's refusal into the same
 * plain words the check gives — never a 500.
 */
export async function withNameBackstop<T>(
  write: () => Promise<T>,
  input: { organizationId: string; name: string; selfId: string | null; door: NameDoor },
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await write() };
  } catch (e) {
    if (!isNameInPlayViolation(e)) throw e;
    return { ok: false, error: (await tournamentNameRefusal(input)) ?? NAME_TAKEN_RACE };
  }
}
