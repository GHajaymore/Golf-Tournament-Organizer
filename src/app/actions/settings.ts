"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { cleanSettings, usesAccessCodes, type TournamentSettings } from "@/lib/tournament-settings";
import { generateAccessCode } from "@/lib/codes";

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

function refresh() {
  revalidatePath("/", "layout");
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
 * Issue Round Codes for every round of a tournament that doesn't have one.
 *
 * Codes are unique across all tournaments because redemption looks them up on
 * their own, so a collision is retried rather than thrown — with 27^8 codes
 * this effectively never fires, but "effectively never" is not "never" and a
 * unique-constraint crash mid-round would be a miserable way to find out.
 */
async function issueRoundCodes(eventId: string): Promise<void> {
  const stages = await prisma.stage.findMany({
    where: { eventId, accessCode: "" },
    select: { id: true },
  });

  for (const stage of stages) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateAccessCode();
      const taken = await prisma.stage.count({ where: { accessCode: code } });
      if (taken > 0) continue;
      try {
        await prisma.stage.update({ where: { id: stage.id }, data: { accessCode: code } });
        break;
      } catch {
        // Lost a race against a concurrent issue for the same code — try again.
      }
    }
  }
}

/** Withdraw every Round Code for a tournament. Turning code access off has to
 *  actually revoke the codes, or "off" would mean nothing. */
async function revokeRoundCodes(eventId: string): Promise<void> {
  await prisma.stage.updateMany({ where: { eventId }, data: { accessCode: "" } });
}

export async function saveTournamentSettings(input: Partial<TournamentSettings>): Promise<SettingsResult> {
  const eventId = await requireOrganizer();
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, error: "Tournament not found." };

  const next = cleanSettings({ ...event, ...input });
  const wasUsingCodes = usesAccessCodes(cleanSettings(event));
  const nowUsingCodes = usesAccessCodes(next);

  await prisma.event.update({ where: { id: eventId }, data: next });

  if (nowUsingCodes && !wasUsingCodes) await issueRoundCodes(eventId);
  if (!nowUsingCodes && wasUsingCodes) await revokeRoundCodes(eventId);

  refresh();
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
    refresh();
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

  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { organizationId: true },
  });
  if (!event) return { ok: false, error: "No organization found." };

  const user = await prisma.user.findUnique({ where: { email: session.email } });
  const membership = user
    ? await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: event.organizationId, userId: user.id } },
      })
    : null;
  const canEdit =
    membership?.role === "owner" ||
    membership?.role === "admin" ||
    (session.role === "admin" && !membership);
  if (!canEdit) return { ok: false, error: "Only an organization owner or admin can change house defaults." };

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

  refresh();
  return { ok: true };
}
