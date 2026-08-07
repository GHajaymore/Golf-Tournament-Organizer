import "server-only";
import { prisma } from "../db";
import { DEFAULT_PLAN, planFor } from "../plans";
import { DEFAULT_THEME } from "../themes";
import { cleanSettings } from "../tournament-settings";
import { generateShareToken } from "../codes";

/**
 * Resolve the organization a new tournament should belong to for this person,
 * creating their personal one on first use.
 *
 * Everyone gets an organization — an individual organizer's is `personal` —
 * so there is never an event without a billing tenant, and no code path needs
 * to handle that case.
 *
 * Preference order:
 *   1. an organization they already own or administer (their club, if any)
 *   2. their personal organization
 *   3. a newly created personal organization
 */
export async function organizationForNewEvent(email: string, displayName: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user.id, role: { in: ["owner", "admin"] } },
      include: { organization: true },
      // Prefer a real club over the personal fallback, then oldest first so
      // the choice is stable rather than shifting as rows are added.
      orderBy: [{ organization: { kind: "asc" } }, { createdAt: "asc" }],
    });
    if (membership) return membership.organizationId;
  }

  const org = await prisma.organization.create({
    data: {
      name: displayName.trim() || email,
      kind: "personal",
      subscription: { create: { plan: DEFAULT_PLAN, status: "active" } },
      ...(user ? { members: { create: { userId: user.id, role: "owner" } } } : {}),
    },
  });
  return org.id;
}

/**
 * The settings a new tournament starts with: the owning organization's house
 * defaults, plus a fresh share token.
 *
 * Returned as a flat object to spread into `event.create`. Copying rather than
 * pointing at the organization is the whole design — a club that changes its
 * house default next month must not silently rewrite the rules of an event
 * already being played.
 */
export async function settingsForNewEvent(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      defaultLeaderboardVisibility: true,
      defaultScoreEntryBy: true,
      defaultScoreEntryWindow: true,
      defaultVoiceEntry: true,
      defaultPlayerAccess: true,
      defaultScoreApproval: true,
    },
  });

  const settings = cleanSettings({
    leaderboardVisibility: org?.defaultLeaderboardVisibility,
    scoreEntryBy: org?.defaultScoreEntryBy,
    scoreEntryWindow: org?.defaultScoreEntryWindow,
    voiceEntry: org?.defaultVoiceEntry,
    playerAccess: org?.defaultPlayerAccess,
    scoreApproval: org?.defaultScoreApproval,
  });

  return { ...settings, shareToken: generateShareToken() };
}

export interface EventBrand {
  name: string;
  logoUrl: string;
  /** Whether to keep a "Powered by TourneyHQ" line alongside the club's mark.
   *  True on plans without white-labelling — that attribution is how other
   *  organizers discover the product. */
  showAttribution: boolean;
}

/**
 * Branding for whichever organization owns this event, for the console header
 * and anything printed or sent to players.
 *
 * Returns null when the club hasn't set a name/logo, so callers fall back to
 * TourneyHQ's own mark rather than rendering an empty header.
 */
export async function brandForEvent(eventId: string): Promise<EventBrand | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      organization: {
        select: {
          name: true,
          shortName: true,
          logoUrl: true,
          subscription: { select: { plan: true } },
        },
      },
    },
  });
  const org = event?.organization;
  if (!org) return null;
  const name = org.shortName || org.name;
  if (!name && !org.logoUrl) return null;
  return {
    name,
    logoUrl: org.logoUrl,
    showAttribution: !planFor(org.subscription?.plan).features.whiteLabel,
  };
}

/** The organizations a person owns, administers, or is staff in. */
export async function organizationsFor(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return [];
  return prisma.organizationMember.findMany({
    where: { userId: user.id },
    include: { organization: { include: { subscription: true, _count: { select: { events: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * The accent preset for whichever organization owns this event.
 *
 * Separate from brandForEvent because a theme applies even when a club has set
 * no name or logo — brandForEvent returns null in that case, and a club that
 * picked a colour should still see it.
 */
export async function themeForEvent(eventId: string): Promise<{ key: string; hex: string }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organization: { select: { themeKey: true, themeHex: true } } },
  });
  return {
    key: event?.organization.themeKey ?? DEFAULT_THEME,
    hex: event?.organization.themeHex ?? "",
  };
}
