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
 * WHICH ORGANIZATION — and the answer depends on whether a tournament is open.
 *
 * With one open it is that tournament's club, full stop. `eventId` is the
 * whole of the question, because every screen the checklist LINKS TO already
 * works that way: `/organization` resolves the event's `organizationId` and
 * edits that club's name, branding and money mode.
 *
 * It used to answer from the caller's memberships instead — owner or admin, a
 * club ahead of the personal fallback, oldest first — and that produced a
 * checklist about one organization on a page about another. Two failures, and
 * the second is the one that cannot be argued with:
 *
 *   - It could not be completed by following it. "Name your outing" links to
 *     `/organization`, which names the EVENT's club; the tick tracked the
 *     membership-chosen one, so the step stayed undone however many times it
 *     was done.
 *   - It described a club with no tournaments over a tournament in progress.
 *     Read off Demo Cup on 2026-09-11 — 33 players, 47 results, a bracket —
 *     with "1 of 3 done. Start with the tournament" above it and the club
 *     screens marked "Opens once you have a tournament".
 *
 * That reproduces for anyone whose access to the tournament is an `Account`
 * row rather than an organization membership — an assistant the club invited
 * by email — and equally for anyone who owns two clubs, where the ordering
 * picked the older one regardless of which tournament was on screen. Both got
 * commoner the day a quick round started creating a personal organization.
 *
 * Without an open tournament — `/choose`, where the whole point is that one
 * has not been picked — the membership order is still the right answer, and
 * is kept: the checklist is then about the organization a new tournament
 * would land in, which is what `organizationForNewEvent` decides.
 *
 * The facts are COUNTS, never rows. Nothing downstream needs to know what a
 * member is, only whether there are any, and counting in the database beats
 * loading a club's whole roster to check it is not empty.
 */
export async function orgSetupFactsFor(
  email: string,
  displayName: string,
  /** The tournament currently open, when there is one. */
  eventId?: string,
): Promise<OrgSetupFacts | null> {
  if (eventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
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
    // A stale event id falls through to the membership answer rather than
    // returning null: losing the checklist is a worse failure than choosing
    // the organization the old way.
    if (event) return factsFrom(event.organization, displayName, email);
  }

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

  return factsFrom(membership.organization, displayName, email);
}

/**
 * The same counts whichever way the organization was chosen.
 *
 * One reader, so the two paths above cannot answer "is this club set up"
 * differently — which is the defect the `eventId` branch exists to fix, and
 * would be an easy way to reintroduce.
 */
function factsFrom(
  org: {
    name: string;
    kind: string;
    moneyMode: string;
    _count: { roster: number; events: number; courses: number };
  },
  displayName: string,
  email: string,
): OrgSetupFacts {
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
 * Every organization this person belongs to — THE SCOPE OF WHAT THEY MAY BE
 * OFFERED.
 *
 * Their own memberships, whatever the role. A member of a club is offered that
 * club's courses and that club's member list even though they run nothing, and
 * that is the point: `/match/new` has always scoped both pickers this way, and
 * this is that scope named once so the other readers ask the same question.
 *
 * It exists because a casual round belongs to the person rather than to any
 * club. Scoping to the EVENT's organization asks a personal one, which has no
 * courses and no roster — so a secretary setting up a Sunday fourball at their
 * own club found the venue picker empty of their course and every member they
 * picked recorded as a guest.
 *
 * Reading a club's lists is a convenience, not the club taking the round over.
 * A golf course is a physical place and a member's handicap is the club's own
 * number; offering either is what the memory calls the wedge — "friendly
 * rounds pick players from the club member list with their stored handicaps".
 *
 * IDS ONLY, and this is the whole of its authority. It decides what may be
 * offered to pick FROM; it decides nothing about what may be changed, and
 * every write still goes through its own check. Narrowing by role would be
 * wrong here for the same reason widening it elsewhere would be: the question
 * is "whose lists am I entitled to see", not "what may I administer".
 */
export async function organizationIdsFor(email: string): Promise<string[]> {
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

/**
 * THE LIBRARY A COURSE THIS PERSON PICKS BELONGS IN.
 *
 * `courses.ts` has one answer to "which club am I curating" —
 * `requireOrganizerOrg`, the club that owns the tournament I have open. That
 * is right for every screen in the console and is no answer at all for the one
 * flow that has neither a tournament nor a club.
 *
 * `NewMatchForm` says so itself, where it switches the directory search on:
 * "the club's library is read from the organizations this person belongs to,
 * and somebody who has just signed up to play their mate on Sunday belongs to
 * none — so requiring a course while offering only a list that is empty for a
 * new user would be a wall rather than a question."
 *
 * It was a wall. The search switched on for exactly that person asked
 * `requireOrganizerOrg`, which refuses them twice over — not an `admin`, and
 * no `eventId` — so the lookup threw and the picker fell through to its last
 * line: "None of your courses match that. Try fewer letters, or add the course
 * to your library first." Advice about a library that does not exist, on a
 * field whose own hint reads "needed before any score can go down", above a
 * button that stays disabled for good.
 *
 * Walked on 2026-09-11 with a fresh account: a new user could not start a
 * quick round at all, which is the whole of the free tier.
 *
 * So: the tournament's club when this person is actually running one, and
 * their OWN organization otherwise — the same personal organization
 * `createMatch` already puts the round into, so their second round finds the
 * course waiting in "your courses" rather than asking again.
 *
 * Here rather than in the action because it is the sort of thing that is only
 * provable against real rows, and because a second caller must not be able to
 * answer it differently. Compare `organizationIdsFor` directly above: that one
 * says whose lists may be READ, this one says where a new row is WRITTEN, and
 * conflating them is how a player's pick would land in their club's library.
 */
/**
 * THE CLUB THIS PERSON RUNS, WITHOUT ASKING WHICH TOURNAMENT IS OPEN.
 *
 * The club's own screens — Members, Season standings, Club settings — resolved
 * their organization through the active EVENT: `organizationIdForEvent(
 * session.eventId)`. So the roster that outlives every tournament, the
 * branding that goes on every scorecard and the handicap policy the whole club
 * plays under were all reachable only by first having a tournament to stand
 * in. The org setup rail said so in its own words: "Opens once you have a
 * tournament — your society's own screens live inside one."
 *
 * That is the wrong way round for a club. A secretary's first act is to set
 * the club up; inventing a tournament in order to reach the members list is
 * the app making them do the second thing first.
 *
 * PREFERS THE OPEN TOURNAMENT'S CLUB, so nothing changes for an organizer who
 * has one — switching tournament still switches which club these screens show,
 * which is what every existing caller does today. Only when there is no
 * tournament does it fall back to the organization this person actually runs,
 * in the same order `organizationsForOrganizer` offers them, so "which club"
 * gets one answer across the app.
 *
 * Null when they run none. That is a real state — somebody invited as a player
 * has no club of their own — and the caller sends them somewhere useful rather
 * than inventing a tenant for them.
 */
export async function primaryOrganizationFor(session: {
  email: string;
  eventId: string;
}): Promise<string | null> {
  if (session.eventId) {
    const event = await prisma.event.findUnique({
      where: { id: session.eventId },
      select: { organizationId: true },
    });
    if (event) return event.organizationId;
  }
  const owned = await organizationsForOrganizer(session.email);
  return owned[0]?.id ?? null;
}

export async function libraryOrganizationFor(session: {
  email: string;
  name: string;
  eventId: string;
  role: string;
}): Promise<string> {
  const event = session.eventId
    ? await prisma.event.findUnique({
        where: { id: session.eventId },
        select: { organizationId: true },
      })
    : null;
  /**
   * Unchanged for every caller that already had an answer: an organizer with a
   * tournament open still curates that tournament's club library, and the role
   * is checked as well as the event so a PLAYER in somebody's tournament
   * cannot write a course into that club by picking a venue.
   */
  if (event && session.role === "admin") return event.organizationId;
  return personalOrganizationFor(session.email, session.name);
}
