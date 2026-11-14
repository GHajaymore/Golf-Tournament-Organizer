import { prisma } from "@/lib/db";
import { deployWindowFor, onToday, type ClubTournament, type DeployWindow } from "@/lib/domain/deploy-window";
import { clubToday } from "@/lib/domain/club-clock";
import { launchState } from "@/lib/services/signins-switch";
import { signInAllowList } from "@/lib/sign-in-gate";
import { isOwner } from "@/lib/owner";

/**
 * The deploy window, read from the database: whether accounts are live, every club's zone, the
 * tournaments that might be on today somewhere — a round dated within a day either side of the
 * server's, or dates that take that in — and, before launch, which clubs are pilot clubs. The rule
 * itself is `domain/deploy-window.ts`. READ-ONLY: `findMany`s and the launch switch's row, no write.
 *
 * Statuses: only a completed tournament is over. The three setting-up statuses
 * read as one (G1), and every one not completed is counted.
 */
export async function currentDeployWindow(at: Date = new Date()): Promise<DeployWindow> {
  // The one answer every held page asks. A switch row that cannot be read keeps "held" — the safe
  // reading for the front door, but here, after launch, it LOWERS the freeze to pilot clubs only
  // until the row can be read again (the reason then begins "sign-ins are held").
  const launch = await launchState();
  // REAL CLUBS ONLY (2026-10-24). The demo club has a tournament "on today" every day of the year,
  // and a freeze that counted it would never lift: it is in neither query (docs/claude/demo-club.md).
  const [clubs, tournaments, pilots] = await Promise.all([
    prisma.organization.findMany({ where: { isDemo: false }, select: { timeZone: true }, distinct: ["timeZone"] }),
    tournamentsNearToday(at),
    launch === "held" ? pilotClubIds() : Promise.resolve(new Set<string>()),
  ]);
  return deployWindowFor(
    launch,
    at,
    clubs.map((c) => c.timeZone),
    tournaments,
    pilots,
  );
}

/**
 * Every real club's tournament that might be on today somewhere: a round dated within a day either
 * side of `at` in UTC, or dates that take that in. Whether one IS on today is `onToday`, by its own
 * club's clock. Asked by the deploy window and by the event-day backup (`aTournamentIsOnToday`).
 */
export async function tournamentsNearToday(at: Date): Promise<ClubTournament[]> {
  // The UTC day either side: every club's own day falls inside it (no zone is more than 14 hours from UTC).
  const day = (offset: number) => clubToday("UTC", new Date(at.getTime() + offset * 24 * 60 * 60 * 1000));
  const days = [day(-1), day(0), day(1)];
  const events = await prisma.event.findMany({
    where: {
      organization: { isDemo: false },
      // Every tournament not finished, set up or live (G1, 2026-10-31): the three
      // pre-launch statuses read as one, and one being played before launch (a
      // card is allowed once results exist) is a day in play. Holding a deploy
      // for a draft dated today costs an hour; deploying under a field costs more.
      status: { notIn: ["completed"] },
      OR: [
        { stages: { some: { playedOn: { in: days } } } },
        { startOn: { not: "", lte: days[2] }, OR: [{ endOn: { gte: days[0] } }, { endOn: "", startOn: { gte: days[0] } }] },
      ],
    },
    select: {
      organizationId: true,
      startOn: true,
      endOn: true,
      organization: { select: { timeZone: true } },
      stages: { where: { playedOn: { in: days } }, select: { playedOn: true } },
    },
  });
  return events.map((e) => ({
    clubId: e.organizationId,
    timeZone: e.organization.timeZone,
    startOn: e.startOn,
    endOn: e.endOn,
    playedOn: e.stages.map((s) => s.playedOn),
  }));
}

/**
 * IS ANY REAL CLUB PLAYING TODAY, by its own clock? The event-day backup's question (B21): on such
 * a day the hourly trigger takes a copy every hour, so a lost database costs an hour of a field's
 * cards, not a day. Every real club counts, pilot or not, before launch or after — the freeze's
 * pilot rule is about deploys, and a backup costs a field nothing.
 */
export async function aTournamentIsOnToday(at: Date): Promise<boolean> {
  return (await tournamentsNearToday(at)).some((t) => onToday(t, at));
}

/**
 * THE PILOT CLUBS (Ajay, 2026-11-06): every real club at which somebody let in by name
 * (`SIGNIN_ALLOW_EMAILS`, through `signInAllowList` — never parsed again here) is STAFF. An owner on
 * `OWNER_EMAILS` is taken off that list first: by the ruling the owners' own clubs do not count before
 * launch — a test, or a real event played by round code — and an
 * owner who also put their address on the allow-list must not freeze every deploy with them.
 *
 * Staff is the app's own reading of it, as the staff-seat count has it (`holdsSeat` in
 * `services/limits.ts`): a Commissioner or Admin of the club (`OrganizationMember` owner | admin), or
 * an Organizer or helper on one of its tournaments not archived (`Account` admin | assistant). Ids only; the
 * answer never names a club or a person.
 */
export async function pilotClubIds(): Promise<Set<string>> {
  const people = signInAllowList().filter((email) => !isOwner(email));
  if (!people.length) return new Set();
  const byEmail = people.map((email) => ({ email: { equals: email, mode: "insensitive" as const } }));
  const [members, accounts] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { role: { in: ["owner", "admin"] }, organization: { isDemo: false }, user: { OR: byEmail } },
      select: { organizationId: true },
    }),
    prisma.account.findMany({
      // Not on an archived tournament, as `holdsSeat` counts it: a club somebody once ran is not one they run.
      where: { role: { in: ["admin", "assistant"] }, event: { archivedAt: null, organization: { isDemo: false } }, OR: byEmail },
      select: { event: { select: { organizationId: true } } },
    }),
  ]);
  return new Set([...members.map((m) => m.organizationId), ...accounts.map((a) => a.event.organizationId)]);
}
