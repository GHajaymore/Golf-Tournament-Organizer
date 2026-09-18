"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendStaffInviteEmail } from "@/lib/email";
import { isCurrencyCode } from "@/lib/domain/money-format";
import { isSupportedLocale } from "@/lib/domain/locale";
import { isCommunityVoice, isOrgKind, orgProfile } from "@/lib/domain/org-profile";
import { clubExistsQuestion } from "@/lib/domain/org-name-match";
import { otherOrganizationNamed } from "@/lib/services/organization";
import { refusalFor } from "@/lib/services/limits";
import {
  isThemeKey, hexToHsl, isAppearance, DEFAULT_CLUB_THEME, SECONDARY_PRESETS, DEFAULT_APPEARANCE, pairVerdict, type Appearance,
} from "@/lib/themes";
import { checkLogoUrl } from "@/lib/services/logo-check";
import { organizationAccess } from "@/lib/services/org-access";
import { isBrandDisplay } from "@/lib/brand";

export interface OrgResult {
  ok: boolean;
  error?: string;
  /** Saved, but something about it is worth telling the organizer — currently
   *  only used when a logo URL couldn't be reached from our server. */
  warning?: string;
}

/**
 * The organization that owns the tournament currently being managed, plus
 * whether this person may change its settings.
 *
 * Organization settings sit above a single tournament, so editing them
 * requires being an owner/admin of the ORGANIZATION — not merely an organizer
 * of one of its events. The rule itself lives in services/org-access.ts, which
 * explains at length why "not a member" was the wrong reading; this file and
 * settings.ts held identical copies of it and one of them was a club takeover.
 */
async function currentOrganization() {
  return organizationAccess(await getSession());
}

/**
 * The roles a club can give somebody.
 *
 * "guest" is the one that grants LESS than nothing else does: somebody
 * entered for one event who is not a member of the club — a charity day
 * entrant, a league substitute filling in for an absent pair, a sponsor at
 * the quiz night. `ORG_GUEST_ROLES` in `access.ts` is what keeps them out
 * of the club's other tournaments, and this is the only way to give it.
 *
 * Deliberately generic. It was going to be a charity flag; a substitute in
 * a Thursday league is the same person to the app — in for one night, not
 * a member — and two flags meaning one thing drift apart.
 */
const ORG_ROLES = ["owner", "admin", "member", "guest"] as const;
const cleanOrgRole = (r: string) => (ORG_ROLES.includes(r as (typeof ORG_ROLES)[number]) ? r : "member");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True once the organization has an owner other than this member — the same
 *  guard the per-event access screen uses, applied one level up. Losing the
 *  last owner would strand the tenant and its billing. */
async function hasOtherOwner(organizationId: string, memberId: string): Promise<boolean> {
  return (
    (await prisma.organizationMember.count({
      where: { organizationId, role: "owner", id: { not: memberId } },
    })) > 0
  );
}

/**
 * Add someone to the organization's staff.
 *
 * Staff only — players are never organization members, so a club's seat count
 * can't grow with the size of its fields. A User row is created if this email
 * has never signed in; they claim it with a password on first login.
 */
export async function addOrganizationMember(email: string, name: string, roleInput: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can manage staff." };

  /**
   * ONLY A SEAT-CONSUMING ROLE IS CHECKED AGAINST THE SEAT LIMIT.
   *
   * `staffSeatCount` counts owners and admins — a Member is a staff pool with
   * no rights of its own, and a Guest is somebody in for one event. Charging a
   * seat for either would be wrong in the direction that loses trust, and for
   * Guest it would be absurd: a charity day is a hundred of them, and a club
   * at its cap could not add the field it just took entries from.
   */
  const role = cleanOrgRole(roleInput);
  if (role === "owner" || role === "admin") {
    const refusal = await refusalFor(org.organizationId, "staffSeats");
    if (refusal) return { ok: false, error: refusal };
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };

  const user = await prisma.user.upsert({
    where: { email: cleanEmail },
    update: name.trim() ? { name: name.trim() } : {},
    create: { email: cleanEmail, name: name.trim() },
  });

  /**
   * Whether this is a NEW membership, checked before the upsert writes one.
   *
   * The upsert cannot tell us afterwards, and the difference matters: being
   * given access is news, having your role changed from member to admin is
   * not. Emailing on every save would turn a correction into a second
   * invitation and train people to ignore the first.
   */
  const existingMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.organizationId, userId: user.id } },
    select: { id: true },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.organizationId, userId: user.id } },
    update: { role: role },
    create: { organizationId: org.organizationId, userId: user.id, role: role },
  });

  if (!existingMembership) {
    /**
     * Awaited but never allowed to fail the action.
     *
     * `sendStaffInviteEmail` swallows its own errors by design, so this cannot
     * throw — but it is awaited rather than left dangling because a server
     * action's work must finish before the response, and a floating promise in
     * a serverless function is one the runtime may kill mid-send.
     *
     * The membership is already written at this point. That ordering is
     * deliberate: an invitation that fails to send leaves a person with access
     * and no notification, which an organizer can fix by telling them. A
     * membership that fails to write because an email bounced would leave the
     * organizer believing they had added someone they had not.
     */
    const club = await prisma.organization.findUnique({
      where: { id: org.organizationId },
      select: { name: true },
    });
    await sendStaffInviteEmail(cleanEmail, {
      organizationName: club?.name ?? "",
      organizationId: org.organizationId,
      role: role,
      hasPassword: Boolean(user.password),
      toName: user.name ?? "",
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setOrganizationMemberRole(memberId: string, role: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can manage staff." };

  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: org.organizationId },
  });
  if (!member) return { ok: false, error: "Staff member not found." };

  // Sanitised, not trusted: this is a public endpoint and an unknown string
  // would otherwise be stored as a role nothing in the app understands.
  const next = cleanOrgRole(role);
  if (member.role === "owner" && next !== "owner" && !(await hasOtherOwner(org.organizationId, memberId))) {
    return { ok: false, error: "This is the only owner — make someone else an owner first." };
  }

  await prisma.organizationMember.update({ where: { id: memberId }, data: { role: next } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeOrganizationMember(memberId: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can manage staff." };

  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: org.organizationId },
  });
  if (!member) return { ok: false, error: "Staff member not found." };

  if (member.role === "owner" && !(await hasOtherOwner(org.organizationId, memberId))) {
    return { ok: false, error: "This is the only owner — make someone else an owner before removing them." };
  }

  await prisma.organizationMember.delete({ where: { id: memberId } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveOrganizationBranding(
  name: string,
  shortName: string,
  logoUrl: string,
  /** Where the club is — prefills new courses and scopes a course search. */
  location: { city?: string; region?: string; country?: string } = {},
  /** How the name renders beside the logo. Checked against a closed list. */
  brandDisplay = "short",
): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can change these settings." };

  const cleanName = name.trim();
  if (!cleanName) return { ok: false, error: "Enter an organization name." };

  /**
   * THE OTHER PLACE A CLUB GETS ITS NAME, and the one Ajay pointed at: setup
   * happens AFTER login, so the second secretary of a Thursday league has
   * already signed up and is sitting on this screen typing the league's name
   * into their own brand new tenant.
   *
   * A WARNING rather than the question `createEvent` asks. The difference is
   * what is about to happen: there the tenant does not exist yet and the
   * answer changes whether a second one is made, so it is worth stopping for.
   * Here it exists either way and they are naming their own — stopping the
   * save would just be in the way. So the name is saved and they are told, in
   * the same words, on the channel this action already has for exactly this.
   */
  const clash = await otherOrganizationNamed(cleanName, org.organizationId, {
    // The town they are typing IN THIS SAVE, not the one on the row — this is
    // the screen where a club fills its location in for the first time, and
    // reading the stored value would scope the check by an empty string.
    city: (location.city ?? "").trim(),
    region: (location.region ?? "").trim(),
    country: (location.country ?? "").trim(),
  });

  const cleanLogo = logoUrl.trim();

  // Only hit the network when the URL actually changed — renaming the club
  // shouldn't cost an outbound request.
  let warning: string | undefined;
  const current = await prisma.organization.findUnique({
    where: { id: org.organizationId },
    select: { logoUrl: true },
  });
  if (cleanLogo !== current?.logoUrl) {
    const check = await checkLogoUrl(cleanLogo);
    if (!check.ok) return { ok: false, error: check.error };
    warning = check.warning;
  }

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: {
      name: cleanName,
      shortName: shortName.trim(),
      logoUrl: cleanLogo,
      city: (location.city ?? "").trim().slice(0, 80),
      region: (location.region ?? "").trim().slice(0, 80),
      country: (location.country ?? "").trim().slice(0, 80),
      brandDisplay: isBrandDisplay(brandDisplay) ? brandDisplay : "short",
    },
  });

  revalidatePath("/", "layout");
  /**
   * The logo's warning still wins when there is one: a logo that will not load
   * is about the thing they just did, and a namesake three towns away is not.
   */
  return {
    ok: true,
    warning:
      warning ??
      (clash
        ? clubExistsQuestion({
            name: clash.name,
            label: orgProfile(clash.kind, clash.country, clash.communityNoun).label,
            where: clash.where,
            runBy: clash.runBy,
          })
        : undefined),
  };
}

/**
 * Set the club's whole theme: both colours and light/dark appearance.
 *
 * Every field is checked separately and against a closed list. This is a
 * "use server" export, so the picker's own constraints mean nothing here —
 * whatever arrives is arbitrary caller input, and one of these values ends up
 * in a stylesheet.
 *
 * A club's own colour is allowed, but only its hue and saturation survive: the
 * ramp built from it fixes lightness, which is what keeps an open colour field
 * readable. The hex is stored, never emitted.
 */
export async function saveOrganizationTheme(
  themeKey: string,
  themeHex = "",
  secondaryKey = DEFAULT_CLUB_THEME.secondaryKey,
  secondaryHex = "",
  appearance = DEFAULT_APPEARANCE as string,
): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can change branding." };

  // "custom" is a legitimate key that isn't in the preset list, so it is
  // checked separately rather than widening isThemeKey and letting an unknown
  // preset name through.
  if (themeKey === "custom") {
    if (!hexToHsl(themeHex)) {
      return { ok: false, error: "Enter a colour like #1B4D3E, or pick one of the presets." };
    }
  } else if (!isThemeKey(themeKey)) {
    return { ok: false, error: "Unknown theme." };
  }

  if (secondaryKey === "custom") {
    if (!hexToHsl(secondaryHex)) {
      return { ok: false, error: "Enter a second colour like #1B4D3E, or pick one of the presets." };
    }
  } else if (!SECONDARY_PRESETS.some((p) => p.key === secondaryKey)) {
    return { ok: false, error: "Unknown second colour." };
  }

  if (!isAppearance(appearance)) return { ok: false, error: "Unknown appearance." };

  // The same rule the picker enforces, because the picker's gate means nothing
  // here: a second colour indistinguishable from the accent erases the
  // information it carries on every leaderboard.
  const pair = pairVerdict({
    accentKey: themeKey,
    accentHex: themeHex,
    secondaryKey,
    secondaryHex,
    appearance: appearance as Appearance,
  });
  if (pair.kind === "indistinct") return { ok: false, error: pair.message };

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: {
      themeKey,
      themeHex: themeKey === "custom" ? themeHex.trim() : "",
      themeSecondaryKey: secondaryKey,
      themeSecondaryHex: secondaryKey === "custom" ? secondaryHex.trim() : "",
      themeAppearance: appearance,
      // The club has now chosen, whatever it chose — INCLUDING the stock
      // colours. That is the whole point of recording the act rather than
      // comparing the result: `themeKey === DEFAULT_THEME` cannot tell a club
      // that deliberately picked the default from one that has never opened
      // this screen, and the checklist was reading exactly that comparison.
      // Set on every save, not only the first, so it also answers "when did
      // they last touch their branding".
      themeSetAt: new Date(),
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The club's currency.
 *
 * One setting, beside the theme, for the same reason: it belongs to the club
 * and is read by every screen that shows an amount. `Organization.currency`
 * has existed since the money work and nothing could set it — so a club
 * outside the United States had a column saying GBP by default of nobody, and
 * saw dollars everywhere.
 *
 * The ISO CODE, not a symbol. "$" cannot say which dollar, and carries
 * nothing about minor units — amounts are stored in minor units and the yen
 * has none, so a club in Tokyo reading every prize at a hundredth of its
 * value would assume they had typed it wrong rather than suspect the app.
 *
 * `currencySymbol` is left alone and no longer read for display: it is a free
 * text column that predates this, and rewriting it from a code would be a
 * second source of the same truth.
 */
export async function saveOrganizationCurrency(currency: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can change this." };

  const code = (currency ?? "").trim().toUpperCase();
  if (!isCurrencyCode(code)) {
    return { ok: false, error: "Pick a currency from the list." };
  }

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { currency: code },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * How this club writes a date and a number.
 *
 * Beside the currency and validated the same way — through `isSupportedLocale`
 * rather than a shape test, because `Intl.DateTimeFormat` THROWS on a
 * malformed tag. An unchecked value would not mis-format a date, it would
 * break every screen that shows one, for the club that had just set it.
 */
export async function saveOrganizationLocale(locale: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can change this." };

  const tag = (locale ?? "").trim();
  if (!isSupportedLocale(tag)) {
    return { ok: false, error: "Pick a region from the list." };
  }

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { locale: tag },
  });
  // The layout resolves this once and hands it to every screen through
  // CurrencyProvider, so the whole tree has to re-render — the same reason the
  // currency above revalidates the layout rather than a path.
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * What this outfit calls ITSELF.
 *
 * The country is only ever a good guess — the same outfit is a society in
 * Britain and a golf league in the United States — so `orgProfile` reads
 * `country` for a default. This is the outfit's own answer and it beats the
 * guess. Ajay's framing: the country as the default, the organizer as the
 * authority.
 *
 * EMPTY IS A REAL ANSWER and must stay settable, which is why this does not
 * simply reject the blank. "Follow the country" is the state every row was in
 * before the column existed, and an organizer who picks a word and then
 * changes their mind has to be able to get back to it. `isCommunityVoice`
 * refuses anything else, so the column holds a known key or nothing at all.
 *
 * Validated the same way as the currency and the locale rather than trusted:
 * a `"use server"` export is a public HTTP endpoint and TypeScript types are
 * erased at runtime, so this will be called with whatever the caller likes.
 */
/**
 * SAY WHAT THIS OUTFIT ACTUALLY IS.
 *
 * `Organization.kind` was written once, when the organization was created, and
 * updated NOWHERE. Whatever it was at birth it stayed for ever — and an
 * organization is created lazily, defaulting to `personal`, for anybody whose
 * tenant came from a casual round or a first tournament rather than from the
 * sign-up question. Measured on 2026-09-17 in the development database: three
 * of six organizations were `personal`, including two belonging to somebody
 * plainly running a club.
 *
 * WHAT THAT COSTS, measured rather than assumed — the first version of this
 * comment overstated it, and a comment that overstates a consequence is the
 * same defect as a warning nobody can act on:
 *
 *   the WORDS, everywhere. Sidebar, settings, tab titles: an outing.
 *   what SETUP ASKS FOR — a members list (`sharedRoster`), a home course
 *   (`ownsCourse`).
 *   what MONEY DEFAULTS TO — `money-mode.ts` reads `ledger` to choose between
 *   split and none.
 *
 * The Members screen itself is present for every kind, so a personal tenant is
 * not locked out of a roster. What it does not get is the setup step that asks
 * for one, or the words of the outfit it actually is.
 *
 * MOVING TO `personal` IS STILL THE DIRECTION THAT TAKES SOMETHING AWAY: the
 * setup checklist stops asking for the members list, and the screens stop
 * calling it shared. Nothing is deleted. So it asks first and names the
 * number, in the same shape as the same-name warning — a question with a way
 * through it, not a refusal.
 */
export async function saveOrganizationKind(
  kind: string,
  /** "Yes, hide the roster" — only meaningful when moving to `personal`. */
  confirmHidingRoster?: boolean,
): Promise<OrgResult & { hidesRoster?: number }> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can change this." };

  const value = (kind ?? "").trim();
  // Sanitised, not trusted: a public endpoint, and this value decides what
  // whole screens do rather than merely what they are called.
  if (!isOrgKind(value)) return { ok: false, error: "Pick one of the listed kinds." };

  const current = await prisma.organization.findUnique({
    where: { id: org.organizationId },
    // The country and the outfit's own word come along so the profile is
    // resolved WHOLE — `the-outfit-is-resolved-whole.test.ts` refuses a
    // one-argument `orgProfile(kind)` and caught this being written that way.
    // `sharedRoster` happens not to vary by country, but a rule that holds
    // "except where I checked" is the rule that gets forgotten next time.
    select: { kind: true, country: true, communityNoun: true },
  });
  if (current?.kind === value) return { ok: true };

  const next = orgProfile(value, current?.country, current?.communityNoun);
  if (!next.sharedRoster && !confirmHidingRoster) {
    const members = await prisma.member.count({ where: { organizationId: org.organizationId } });
    if (members > 0) {
      return {
        ok: false,
        hidesRoster: members,
        error:
          /**
           * SAYS WHAT ACTUALLY HAPPENS. This read "the list stops being
           * reachable", which is not true — the Members screen is there for
           * every kind — and a warning that overstates its consequence is the
           * one people learn to click past.
           */
          `Your members list has ${members} ${members === 1 ? "person" : "people"} on it. ` +
          `A personal account treats it as your own list of players rather than the outfit's ` +
          `shared roster, and setup stops asking you to keep it up. Nothing is deleted, and it ` +
          `reads as a shared roster again if you switch back.`,
      };
    }
  }

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { kind: value },
  });
  // The layout resolves the profile once and hands it to eleven components
  // through OrgProfileProvider, so the whole tree has to re-render: this
  // changes the words in the sidebar and which screens are in it.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveOrganizationNoun(noun: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only an organization owner or admin can change this." };

  const value = (noun ?? "").trim();
  if (value !== "" && !isCommunityVoice(value)) {
    return { ok: false, error: "Pick one of the listed words." };
  }

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { communityNoun: value },
  });
  // Same reason as the two above: the layout resolves the profile once and
  // hands it to eleven components through OrgProfileProvider, so the tree has
  // to re-render rather than one path.
  revalidatePath("/", "layout");
  return { ok: true };
}
