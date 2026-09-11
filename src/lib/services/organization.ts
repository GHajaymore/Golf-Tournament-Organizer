import "server-only";
import { DEFAULT_CURRENCY } from "@/lib/domain/money-format";
import { brandLines, brandMonogram, isBrandDisplay } from "@/lib/brand";
import { prisma } from "../db";
import { DEFAULT_PLAN, planFor } from "../plans";
import {
  DEFAULT_THEME, DEFAULT_APPEARANCE, DEFAULT_CLUB_THEME, isAppearance, type ClubTheme,
} from "../themes";
import { cleanSettings } from "../tournament-settings";
import { generateShareToken } from "../codes";
import { newOrganizationName, organizationWasNamed } from "../org-naming";
import type { OrgKind } from "../domain/org-profile";
import type { OrgSetupFacts } from "../domain/org-setup";
import { logoSrc } from "../domain/logo-upload";

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
 * `orgName` names an organization that has never BEEN named — a new one at
 * case 3, or one still carrying the name sign-up derived from the person at
 * cases 1 and 2. An organizer who already named their club keeps it untouched:
 * typing something different on a later event must never rename it, and
 * `organizationWasNamed` is what tells the two apart. See `nameIfStillUnnamed`.
 *
 * This paragraph used to read "`orgName` only ever names a *new* organization",
 * which was true of the code and made the field useless: sign-up creates an
 * organization and a membership, so every signed-up organizer resolved at case
 * 1 or 2 and case 3 was unreachable for them. The box on the first-tournament
 * form did nothing at all.
 */
/**
 * The organizations this person may create a tournament in.
 *
 * ASKED WHEN THERE IS MORE THAN ONE, and that is the whole of the change.
 * `organizationForNewEvent` picks a single membership ordered by kind and then
 * age, and kinds sort alphabetically — so "club" always beats "community" and
 * "personal". Somebody who runs a club AND a society got the club every time,
 * was never asked, and had no way to say otherwise.
 *
 * Demonstrated on 2026-09-09: an owner of both created a tournament from the
 * charity-day template and it landed in the club, with nothing on the screen
 * saying a choice had been made.
 *
 * The consequences are not cosmetic. The event draws its field from that
 * organization's roster, inherits its settings and currency, counts against
 * its plan allowance, appears in its tournament list, and offers its champion
 * to its honours board. The society's staff cannot see it and the club's
 * staff can — which is a charity day's players landing inside a club's data
 * boundary because of an alphabetical sort.
 *
 * Owners and admins only, the same bar `organizationForNewEvent` applies:
 * being a member of a club you merely play in is not permission to create the
 * club's tournaments.
 */
export async function organizationsForOrganizer(
  email: string,
): Promise<Array<{ id: string; name: string; kind: string; plan: string }>> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return [];
  const rows = await prisma.organizationMember.findMany({
    where: { userId: user.id, role: { in: ["owner", "admin"] } },
    /**
     * The PLAN comes with each one, because the screen that asks which
     * organization also warns about what its plan keeps.
     *
     * Carried here rather than fetched separately so the two cannot disagree:
     * a picker offering three clubs and a retention warning read from a fourth
     * source is the shape that tells a paying club its results may be dropped.
     */
    select: {
      createdAt: true,
      organization: {
        // The plan lives on the SUBSCRIPTION row, and an organization need not
        // have one — no row is the free plan, which is what `planForOrganization`
        // says and the only place that rule may be stated.
        select: { id: true, name: true, kind: true, subscription: { select: { plan: true } } },
      },
    },
    // The same order the default follows, so the list's first entry IS the one
    // that would have been chosen silently.
    orderBy: [{ organization: { kind: "asc" } }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.organization.id,
    name: r.organization.name,
    kind: r.organization.kind,
    plan: r.organization.subscription?.plan ?? DEFAULT_PLAN,
  }));
}

/**
 * Take the name the organizer typed, if this organization has never had one.
 *
 * "Who's running this?" on the first tournament was a box that did nothing for
 * every organizer who had signed up — which is all of them. Sign-up creates an
 * organization and a membership, so `organizationForNewEvent` always found one
 * at step 1 or 2 and returned it, and `orgName` only ever reached step 3, the
 * create. Walked on 2026-09-10: signed up as a society, typed "Zz Heathland
 * Society" into that field, created the tournament, and the organization was
 * still called "Zz Secretary" — under a checklist whose first row is "Name
 * your society".
 *
 * The condition is exactly the one the SCREEN uses to decide whether to ask:
 * `organizationWasNamed`. Asking and doing now read the same rule from the
 * same function, so a field that appears is a field that works.
 *
 * OWNER, not owner-or-admin, and this is the whole of why the check is
 * repeated here rather than inherited from the resolver. An admin added to
 * somebody else's still-unnamed organization would otherwise rename it by
 * typing in a box on their own first tournament. Choosing where a tournament
 * goes and renaming the tenant are different powers.
 *
 * Silent when it declines. There is nothing an organizer could do about it and
 * the name is settable afterwards on the organization's own screen, which the
 * sentence under the field already says.
 */
async function nameIfStillUnnamed(
  organizationId: string,
  userId: string,
  orgName: string | undefined,
  displayName: string,
  email: string,
): Promise<void> {
  const wanted = (orgName ?? "").trim();
  if (!wanted) return;

  const owner = await prisma.organizationMember.findFirst({
    where: { organizationId, userId, role: "owner" },
    select: { id: true },
  });
  if (!owner) return;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (!org || organizationWasNamed(org.name, displayName, email)) return;

  await prisma.organization.update({ where: { id: organizationId }, data: { name: wanted } });
}

export async function organizationForNewEvent(
  email: string,
  displayName: string,
  orgName?: string,
  /**
   * The organization the organizer PICKED, when the screen asked.
   *
   * Never trusted. It arrives from a form, so it is re-read against this
   * person's own owner/admin memberships before it is used — an id belonging
   * to somebody else's club would otherwise create an event inside it, which
   * is the whole of a takeover.
   *
   * Absent, or not theirs, falls through to the preference order below, which
   * is exactly what every caller got before the question existed.
   */
  preferredOrganizationId?: string | null,
): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const wanted = (preferredOrganizationId ?? "").trim();
    if (wanted) {
      const chosen = await prisma.organizationMember.findFirst({
        where: { userId: user.id, organizationId: wanted, role: { in: ["owner", "admin"] } },
        select: { organizationId: true },
      });
      if (chosen) {
        await nameIfStillUnnamed(chosen.organizationId, user.id, orgName, displayName, email);
        return chosen.organizationId;
      }
    }

    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user.id, role: { in: ["owner", "admin"] } },
      include: { organization: true },
      // Prefer a real club over the personal fallback, then oldest first so
      // the choice is stable rather than shifting as rows are added.
      orderBy: [{ organization: { kind: "asc" } }, { createdAt: "asc" }],
    });
    if (membership) {
      // BOTH return paths, deliberately. The picker appears only when somebody
      // runs more than one organization, so a new secretary comes through the
      // branch below and a club-and-society organizer through the one above —
      // and the field is offered on whichever they see.
      await nameIfStillUnnamed(membership.organizationId, user.id, orgName, displayName, email);
      return membership.organizationId;
    }
  }

  return createOrganizationWithOwner({ email, displayName, orgName });
}

/**
 * Create an organization and the person who owns it. THE one place that does.
 *
 * Two callers now — a first tournament created before anyone signed up for an
 * organization, and `signUp`, which creates one at the front door — and they
 * must not drift. Three things have to be true of every organization in this
 * database and none of them are enforced by the schema:
 *
 *   - it has a Subscription, because `planFor` and every limit check assume one
 *     exists rather than treating "no subscription" as a separate case;
 *   - it has an OWNER from the moment it exists. It used to be
 *     `...(user ? { members: ... } : {})`, which left a brand new organization
 *     with NOBODY in it. An ownerless club then fell to the
 *     `session.role === "admin" && !membership` fallback for its
 *     administration, which is exactly the reading S1 of the 2026-08-12 audit
 *     turned into a takeover;
 *   - its `kind` is one org-profile knows, so nothing has to resolve an
 *     unknown string.
 *
 * A second creation site that forgot any one of those would be invisible until
 * a real club hit it.
 *
 * The User is created if this email has never signed in — the same thing
 * `addOrganizationMember` does for staff it invites, claimed with a password on
 * first login.
 */
/**
 * The person's OWN organization — never a club they happen to run.
 *
 * A casual round is not the club's business. Somebody playing their mate on
 * Sunday is not running a competition for their members, and a club secretary
 * is the same person on Saturday as on Sunday: `organizationForNewEvent`
 * prefers a real club over the personal fallback (kinds sort alphabetically,
 * so "club" beats "community" beats "personal"), which meant every quick round
 * a secretary set up was created INSIDE their club.
 *
 * `match-setup.ts` said it did the opposite — "returns the person's own
 * personal organization … somebody playing their mate on Sunday is not
 * starting a club" — and that sentence was true only for organizers who ran
 * nothing else. For everybody who runs a club it was exactly backwards, and
 * the club then carried the round: in its tournament picker, under its
 * branding and its theme, against its plan, in the counts its organizers read.
 *
 * OWNER ONLY, and personal only. An admin of somebody else's personal
 * organization must not have their Sunday fourball land in it, and a `club`
 * or `community` row is by definition the shared tenant this is avoiding.
 * Oldest first so the answer is stable rather than shifting as rows are added.
 *
 * Creates one on first use, exactly as the other resolver does. Everyone gets
 * an organization, so no code path has to handle an event without one.
 */
export async function personalOrganizationFor(
  email: string,
  displayName: string,
): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (user) {
    const own = await prisma.organizationMember.findFirst({
      where: { userId: user.id, role: "owner", organization: { kind: "personal" } },
      select: { organizationId: true },
      orderBy: { createdAt: "asc" },
    });
    if (own) return own.organizationId;
  }

  // No orgName: this one is the person's, and it is named after them.
  return createOrganizationWithOwner({ email, displayName, kind: "personal" });
}

export async function createOrganizationWithOwner(input: {
  email: string;
  displayName: string;
  /** Names the organization when given; otherwise it is named after the person. */
  orgName?: string;
  /** Defaults to `personal`, which is the schema default and what a lazily
   *  created organization has always been. */
  kind?: OrgKind;
}): Promise<string> {
  const owner = await prisma.user.upsert({
    where: { email: input.email },
    update: {},
    create: { email: input.email, name: input.displayName || input.email },
  });

  const org = await prisma.organization.create({
    data: {
      name: newOrganizationName(input.orgName, input.displayName, input.email),
      kind: input.kind ?? "personal",
      subscription: { create: { plan: DEFAULT_PLAN, status: "active" } },
      members: { create: { userId: owner.id, role: "owner" } },
    },
  });
  return org.id;
}

/**
 * The setup checklist for whichever organization this person runs, or null.
 *
 * Null when they run none — a player invited to somebody else's tournament has
 * no organization of their own and must not be shown a club setup checklist.
 * Deliberately not "create one so there is something to show": creating a
 * tenant as a side effect of rendering a page is how orphan organizations get
 * made, and `signUp` already creates one for anybody who is actually an
 * organizer.
 *
 * Which organization, when they run several: the same preference order
 * `organizationForNewEvent` uses — owner or admin, a real club ahead of the
 * personal fallback, oldest first — so the checklist is about the same
 * organization a new tournament would land in. Two different answers to "which
 * of my organizations is this page about" would be the usual defect.
 *
 * The facts are COUNTS, never rows. Nothing downstream needs to know what a
 * member is, only whether there are any, and counting in the database beats
 * loading a club's whole roster to check it is not empty.
 */
export async function orgSetupFactsFor(
  email: string,
  displayName: string,
): Promise<OrgSetupFacts | null> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return null;

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: user.id, role: { in: ["owner", "admin"] } },
    orderBy: [{ organization: { kind: "asc" } }, { createdAt: "asc" }],
    select: {
      organization: {
        select: {
          name: true,
          kind: true,
          moneyMode: true,
          _count: { select: { roster: true, events: true, courses: true } },
        },
      },
    },
  });
  if (!membership) return null;

  const org = membership.organization;
  return {
    kind: org.kind,
    // Not `!!org.name` — every organization has a name from birth, because
    // sign-up derives one from the person. See organizationWasNamed.
    named: organizationWasNamed(org.name, displayName, email),
    hasCourse: org._count.courses > 0,
    memberCount: org._count.roster,
    eventCount: org._count.events,
    moneyAnswered: org.moneyMode.trim() !== "",
  };
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
          // `id` is here only to build the logo's own URL — see logoSrc.
          id: true,
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
    /**
     * Converted HERE, where the brand is built, so no screen has to remember.
     *
     * A linked logo passes through unchanged; an uploaded one becomes a URL
     * pointing at `/api/logo/...` instead of the image itself, which keeps a
     * measured 81KB per render out of a board that reloads every 30 seconds.
     * Every consumer — the sidebar, the public board, the printed scorecard —
     * reads this one field, so doing it at the source is the difference
     * between one decision and six.
     */
    logoUrl: logoSrc(org.id, org.logoUrl),
    showAttribution: !planFor(org.subscription?.plan).features.whiteLabel,
  };
}

/**
 * The same brand, narrowed to what belongs at the head of a scorecard.
 *
 * A card wants a name, a logo and the second line if the club asked for both.
 * It must never carry `showAttribution` — a "Powered by TourneyHQ" line on a
 * club's own scorecard is our mark on their paper — and `monogram` is a sidebar
 * fallback that would put grey initials where a club simply has no logo. Every
 * screen that renders a card goes through here, so none of them can pass the
 * whole brand by accident.
 */
export async function cardBrand(
  eventId: string,
): Promise<{ name: string; logoUrl: string; secondary: string; homeCourseId: string } | null> {
  const brand = await brandForEvent(eventId);
  if (!brand) return null;
  // The club's own course, so a card can tell "our course" from "somebody
  // else's". At home the club's mark heads the card; away, the course leads
  // and the club is named beneath it. Read here rather than by each page, so
  // the two cards cannot disagree about which case they are in.
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organization: { select: { defaultCourseId: true } } },
  });
  return {
    name: brand.name,
    logoUrl: brand.logoUrl,
    secondary: brand.secondary,
    homeCourseId: event?.organization?.defaultCourseId ?? "",
  };
}

/**
 * Every organization whose COURSES this person should be offered.
 *
 * Their own memberships, whatever the role — a member of a club is offered
 * that club's courses even though they run nothing. `/match/new` has always
 * scoped its venue picker this way, and this is that scope, named and shared
 * so the card screen can ask the same question.
 *
 * It exists because a casual round belongs to the person rather than to any
 * club: scoping its library to the EVENT's organization asks a personal one
 * for its courses and gets none, so a secretary setting up a Sunday fourball
 * at their own course found the venue picker empty of it. Reading a club's
 * course list is a convenience and not the club taking the round over — a
 * golf course is a physical place, not club apparatus.
 *
 * Ids only. Nothing here decides what may be CHANGED; it decides what may be
 * offered to pick from, and every write still goes through its own check.
 */
export async function courseOrgIdsFor(email: string): Promise<string[]> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return [];
  const rows = await prisma.organizationMember.findMany({
    where: { userId: user.id },
    select: { organizationId: true },
  });
  return [...new Set(rows.map((r) => r.organizationId))];
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
/**
 * The club's currency, for every screen that writes an amount.
 *
 * Alongside the theme and the brand because it is the same kind of fact: one
 * decision belonging to the club, read by a dozen screens. Falls back to the
 * default rather than throwing — a money screen must not go down because an
 * event was deleted between the render and the read.
 */
export async function currencyForEvent(eventId: string): Promise<string> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organization: { select: { currency: true } } },
  });
  return event?.organization?.currency || DEFAULT_CURRENCY;
}

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
    // DEFAULT_CLUB_THEME, not a literal. This is the line that decides what a
    // club with no stored secondary actually sees, so a second copy of the
    // default here silently outranks the one everybody reads.
    secondaryKey: org?.themeSecondaryKey ?? DEFAULT_CLUB_THEME.secondaryKey,
    secondaryHex: org?.themeSecondaryHex ?? "",
    appearance: isAppearance(appearance) ? appearance : DEFAULT_APPEARANCE,
  };
}
