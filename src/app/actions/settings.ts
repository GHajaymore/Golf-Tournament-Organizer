"use server";
import { revalidatePath } from "next/cache";
import { boardChanged } from "@/lib/services/board-refresh";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { cleanSettings, usesAccessCodes, type TournamentSettings } from "@/lib/tournament-settings";
import { lockoutRefusal, revokesCodes } from "@/lib/domain/access-lockout";
import { generateAccessCode } from "@/lib/codes";
import { ensureRoundCodes, revokeRoundCodes } from "@/lib/services/round-codes";
import { organizationAccess } from "@/lib/services/org-access";

/**
 * Tournament settings and the organization defaults new tournaments copy.
 *
 * Changing a tournament's settings is an organizer action; changing the club's
 * house defaults sits one level up and needs organization admin.
 */

export interface SettingsResult {
  ok: boolean;
  error?: string;
}

/**
 * Everything on this screen changed — and so did the public board.
 *
 * `revalidatePath` clears the router cache; it does NOT touch the per-event
 * board entry, which is an `unstable_cache` keyed and tagged separately.
 * Without this, a change here waits out the board's sixty-second backstop
 * before a spectator sees it.
 *
 * The event comes from the SESSION, because every action in this file
 * already operates on the caller's own tournament.
 */
async function refresh() {
  revalidatePath("/", "layout");
  const session = await getSession();
  if (session?.eventId) boardChanged(session.eventId);
}

/** Organizer of the tournament currently open. Assistants don't reshape the
 *  rules of an event — that's the same line Event setup already draws. */
async function requireOrganizer(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin") throw new Error("Organizer access required");
  return session.eventId;
}

/**
 * Both halves of the Round Code rule live in `services/round-codes.ts` now.
 *
 * They were private to this file, which is how the rule came to be enforced
 * only here — and this file only ever runs when somebody saves the settings
 * screen. The four places that CREATE a round could not call them, so a round
 * added to a code-using tournament got no code. See that file's header.
 */
export async function saveTournamentSettings(input: Partial<TournamentSettings>): Promise<SettingsResult> {
  const eventId = await requireOrganizer();
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, error: "Tournament not found." };

  const next = cleanSettings({ ...event, ...input });
  const wasUsingCodes = usesAccessCodes(cleanSettings(event));
  const nowUsingCodes = usesAccessCodes(next);

  /**
   * TURNING ROUND CODES OFF CAN LOCK A FIELD OUT OF ITS OWN ROUND.
   *
   * Entries may be made without an email address on a tournament that signs
   * players in by Round Code — `entryNeedsEmail` decides that, and the society
   * and charity templates ship exactly that setting. Those players are
   * perfectly well identified: `createPlaySession` signs
   * `stageId:playerId:expiry:code` and never reads an address. What they do
   * not have is an `Account`, because `syncPlayerAccount` returns early on a
   * blank address.
   *
   * So this one dropdown does three things at once: `revokeRoundCodes` below
   * blanks every stage's code, `getPlaySession` then refuses a session whose
   * stage has no code — signing out players who are out on the course — and
   * email sign-in cannot let them back in, because they have no address.
   *
   * BEFORE THE UPDATE, not after. Everything below this line is the change
   * itself; refusing afterwards would mean the settings had already been
   * written and the codes already revoked.
   *
   * Counted rather than trusted from the client: this is a `"use server"`
   * export and the count has to come from the rows. Only entrants still IN the
   * field — a withdrawn player has no card to be locked out of.
   */
  const strandedCount = revokesCodes({ wasUsingCodes, nowUsingCodes })
    ? await prisma.player.count({ where: { eventId, email: "", status: { not: "withdrawn" } } })
    : 0;
  const refusal = lockoutRefusal({ wasUsingCodes, nowUsingCodes, strandedCount });
  if (refusal) return { ok: false, error: refusal };

  await prisma.event.update({ where: { id: eventId }, data: next });

  /**
   * A STATE, NOT A TRANSITION.
   *
   * This read `nowUsingCodes && !wasUsingCodes`, which is right about the
   * moment the dropdown changes and wrong about every other moment: a round
   * added later, or a tournament created with codes already on, never sees a
   * transition and so never gets a code. `ensureRoundCodes` only fills blanks,
   * so asking it unconditionally costs one query on the common path and heals
   * a tournament that has fallen behind. See its header for the measurement.
   *
   * Revocation stays a transition, and must: it BLANKS codes, so running it
   * whenever codes are off would re-revoke on every unrelated save — harmless
   * today and exactly the kind of write that stops being harmless once
   * anything else reads those rows.
   */
  if (nowUsingCodes) await ensureRoundCodes(eventId);
  if (!nowUsingCodes && wasUsingCodes) await revokeRoundCodes(eventId);

  await refresh();
  return { ok: true };
}

/**
 * Replace one round's code.
 *
 * Wanted when a code leaks beyond the field, or for a league that prefers a
 * fresh code each week — reissuing immediately kills the old one.
 */
export async function regenerateRoundCode(stageId: string): Promise<SettingsResult> {
  const eventId = await requireOrganizer();
  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId } });
  if (!stage) return { ok: false, error: "Round not found." };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateAccessCode();
    if ((await prisma.stage.count({ where: { accessCode: code } })) > 0) continue;
    await prisma.stage.update({ where: { id: stageId }, data: { accessCode: code } });
    await refresh();
    return { ok: true };
  }
  return { ok: false, error: "Couldn't generate a new code. Try again." };
}

/**
 * The club's house defaults for future tournaments.
 *
 * Explicitly does not touch existing tournaments: an organizer part-way
 * through a season must not find the rules changed under them because someone
 * adjusted a club preference.
 */
export async function saveOrganizationDefaults(input: Partial<TournamentSettings>): Promise<SettingsResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  // House defaults belong to the club, so this is the club's rule — the same
  // one the organization actions use, from one place. The copy that used to
  // live here ended `|| (session.role === "admin" && !membership)`, which
  // handed every guest organizer of a single event the keys to the tenant.
  const access = await organizationAccess(session);
  if (!access) return { ok: false, error: "No organization found." };
  if (!access.canEdit) {
    return { ok: false, error: "Only an organization owner or admin can change house defaults." };
  }
  const event = { organizationId: access.organizationId };

  const org = await prisma.organization.findUnique({ where: { id: event.organizationId } });
  if (!org) return { ok: false, error: "No organization found." };

  const current: Partial<TournamentSettings> = {
    leaderboardVisibility: org.defaultLeaderboardVisibility as TournamentSettings["leaderboardVisibility"],
    scoreEntryBy: org.defaultScoreEntryBy as TournamentSettings["scoreEntryBy"],
    scoreEntryWindow: org.defaultScoreEntryWindow as TournamentSettings["scoreEntryWindow"],
    voiceEntry: org.defaultVoiceEntry,
    playerAccess: org.defaultPlayerAccess as TournamentSettings["playerAccess"],
    scoreApproval: org.defaultScoreApproval as TournamentSettings["scoreApproval"],
  };
  const next = cleanSettings({ ...current, ...input });

  await prisma.organization.update({
    where: { id: event.organizationId },
    data: {
      defaultLeaderboardVisibility: next.leaderboardVisibility,
      defaultScoreEntryBy: next.scoreEntryBy,
      defaultScoreEntryWindow: next.scoreEntryWindow,
      defaultVoiceEntry: next.voiceEntry,
      defaultPlayerAccess: next.playerAccess,
      defaultScoreApproval: next.scoreApproval,
    },
  });

  await refresh();
  return { ok: true };
}
