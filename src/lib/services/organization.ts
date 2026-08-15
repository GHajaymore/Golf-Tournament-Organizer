import "server-only";
import { brandLines, brandMonogram, isBrandDisplay } from "@/lib/brand";
import { prisma } from "../db";
import { DEFAULT_PLAN, planFor } from "../plans";
import {
  DEFAULT_THEME, DEFAULT_APPEARANCE, FAIRWAY, isAppearance, type ClubTheme,
} from "../themes";
import { cleanSettings } from "../tournament-settings";
import { generateShareToken } from "../codes";
import { newOrganizationName } from "../org-naming";

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
 *   3. a newly created organization, named `orgName` when the organizer gave
 *      one, else after the person (the behaviour before that field existed)
 *
 * `orgName` only ever names a *new* organization. An organizer who already
 * owns a club falls into case 1 and keeps that club untouched — typing a
 * different name on a later event must never rename it.
 */
export async function organizationForNewEvent(
  email: string,
  displayName: string,
  orgName?: string,
): Promise<string> {
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

  // The membership is created unconditionally, and the User along with it if
  // this email has never signed in — the same thing addOrganizationMember does
  // for staff it invites, claimed with a password on first login.
  //
  // It used to be `...(user ? { members: ... } : {})`, which left a brand new
  // organization with NOBODY in it. An ownerless club then fell to the
  // `session.role === "admin" && !membership` fallback for its administration,
  // which is exactly the reading S1 turned into a takeover. Every organization
  // this app creates now has an owner from the moment it exists.
  const owner =
    user ??
    (await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: displayName || email },
    }));

  const org = await prisma.organization.create({
    data: {
      name: newOrganizationName(orgName, displayName, email),
      kind: "personal",
      subscription: { create: { plan: DEFAULT_PLAN, status: "active" } },
      members: { create: { userId: owner.id, role: "owner" } },
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
      defaultMaxPerMatch: true,
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

  // Not a member of TournamentSettings — it is a scoring rule, so it rides
  // alongside rather than through cleanSettings().
  return { ...settings, maxPerMatch: org?.defaultMaxPerMatch ?? 0, shareToken: generateShareToken() };
}

export interface EventBrand {
  name: string;
  /** Second line, when the club asked for both names. Empty otherwise. */
  secondary: string;
  /** Initials for the fallback mark. */
  monogram: string;
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
          brandDisplay: true,
          logoUrl: true,
          subscription: { select: { plan: true } },
        },
      },
    },
  });
  const org = event?.organization;
  if (!org) return null;
  const lines = brandLines(org.name, org.shortName, isBrandDisplay(org.brandDisplay) ? org.brandDisplay : "short");
  if (!lines.primary && !org.logoUrl) return null;
  return {
    name: lines.primary,
    secondary: lines.secondary,
    monogram: brandMonogram(org.name, org.shortName),
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
 * The whole theme for whichever organization owns this event.
 *
 * Separate from brandForEvent because a theme applies even when a club has set
 * no name or logo — brandForEvent returns null in that case, and a club that
 * picked a colour should still see it.
 *
 * Each field falls back on its own. A club that set a colour years ago and
 * never touched appearance gets its colour on the default ground, rather than
 * one unset field dropping the whole theme back to stock.
 */
export async function themeForEvent(eventId: string): Promise<ClubTheme> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      organization: {
        select: {
          themeKey: true, themeHex: true,
          themeSecondaryKey: true, themeSecondaryHex: true, themeAppearance: true,
        },
      },
    },
  });
  const org = event?.organization;
  const appearance = org?.themeAppearance ?? "";
  return {
    accentKey: org?.themeKey ?? DEFAULT_THEME,
    accentHex: org?.themeHex ?? "",
    secondaryKey: org?.themeSecondaryKey ?? FAIRWAY.key,
    secondaryHex: org?.themeSecondaryHex ?? "",
    appearance: isAppearance(appearance) ? appearance : DEFAULT_APPEARANCE,
  };
}
