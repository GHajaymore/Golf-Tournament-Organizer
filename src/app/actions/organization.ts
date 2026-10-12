"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendStaffInviteEmail } from "@/lib/email";
import { isCurrencyCode } from "@/lib/domain/money-format";
import { isSupportedLocale } from "@/lib/domain/locale";
import { clubClockInWords, isTimeZone } from "@/lib/domain/club-clock";
import { isCommunityVoice, isOrgKind, orgProfile } from "@/lib/domain/org-profile";
import { isGolfRegister } from "@/lib/domain/golf-terms";
import { clubExistsQuestion } from "@/lib/domain/org-name-match";
import { otherOrganizationNamed } from "@/lib/services/organization";
import { seatRefusalFor } from "@/lib/services/limits";
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
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can manage staff." };

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
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };
  if (role === "owner" || role === "admin") {
    // By person, so somebody already holding a seat is not refused one.
    const refusal = await seatRefusalFor(org.organizationId, cleanEmail);
    if (refusal) return { ok: false, error: refusal };
  }

  /**
   * A NAME TYPED HERE NAMES SOMEBODY NEW. IT DOES NOT RENAME ANYBODY
   * (2026-10-11).
   *
   * This upserted `{ name }` onto the account whenever a name was typed — so
   * inviting an address that already had an account renamed that person to
   * whatever the inviter wrote, in every club and tournament they belong to.
   * Anybody who runs a club could do it to anybody whose address they knew
   * (found by the every-action sweep: a stranger's invitation changed the
   * seeded club's member).
   *
   * An account's name is its owner's. The typed name is used when the account
   * is being made, or has no name on it yet — somebody entered by email alone
   * — and never to replace one.
   */
  const typedName = name.trim();
  const known = await prisma.user.findUnique({ where: { email: cleanEmail }, select: { id: true, name: true } });
  const user = known
    ? await prisma.user.update({
        where: { id: known.id },
        data: known.name.trim() || !typedName ? {} : { name: typedName },
      })
    : await prisma.user.create({ data: { email: cleanEmail, name: typedName } });

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

  /**
   * ADDED, NOT ASKED — AND NOT YET SEEN (Ajay, 2026-10-11).
   *
   * There is no acceptance step: the person is staff from this moment, exactly
   * as a member entered by the secretary is in the field at once. What the
   * inviter must not get in exchange for an address is the ACCOUNT behind it —
   * its name, and whether it has ever signed in. So a membership made by
   * somebody else is marked unseen, and the staff list shows the typed address
   * and "Invited — not opened yet" until the person next signs in or opens one
   * of the club's tournaments (`markStaffSeen`).
   *
   * Only on CREATE: changing a role must not hide a colleague again. And not
   * when somebody adds themselves, which is nobody else learning anything.
   */
  const adder = await getSession();
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.organizationId, userId: user.id } },
    update: { role: role },
    create: {
      organizationId: org.organizationId,
      userId: user.id,
      role: role,
      invitedUnseenAt: adder?.userId === user.id ? null : new Date(),
    },
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
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can manage staff." };

  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: org.organizationId },
    include: { user: { select: { email: true } } },
  });
  if (!member) return { ok: false, error: "Staff member not found." };

  // Sanitised, not trusted: this is a public endpoint and an unknown string
  // would otherwise be stored as a role nothing in the app understands.
  const next = cleanOrgRole(role);
  if (member.role === "owner" && next !== "owner" && !(await hasOtherOwner(org.organizationId, memberId))) {
    return { ok: false, error: "This is the only Commissioner — make someone else a Commissioner first." };
  }
  // Member or Guest to admin or owner takes a seat — the promotion that went
  // round the limit (see `seatRefusalFor`).
  const seatRoles = ["owner", "admin"];
  if (seatRoles.includes(next) && !seatRoles.includes(member.role)) {
    const refusal = await seatRefusalFor(org.organizationId, member.user.email);
    if (refusal) return { ok: false, error: refusal };
  }

  await prisma.organizationMember.update({ where: { id: memberId }, data: { role: next } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeOrganizationMember(memberId: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can manage staff." };

  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: org.organizationId },
  });
  if (!member) return { ok: false, error: "Staff member not found." };

  if (member.role === "owner" && !(await hasOtherOwner(org.organizationId, memberId))) {
    return { ok: false, error: "This is the only Commissioner — make someone else a Commissioner before removing them." };
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
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change these settings." };

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
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change branding." };

  // "custom" is a legitimate key that isn't in the preset list, so it is
  // checked separately rather than widening isThemeKey and letting an unknown
  // preset name through.
  if (themeKey === "custom") {
    if (!hexToHsl(themeHex)) {
      return { ok: false, error: "Enter a colour like #138808, or pick one of the presets." };
    }
  } else if (!isThemeKey(themeKey)) {
    return { ok: false, error: "Unknown theme." };
  }

  if (secondaryKey === "custom") {
    if (!hexToHsl(secondaryHex)) {
      return { ok: false, error: "Enter a second colour like #138808, or pick one of the presets." };
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
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change this." };

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
 * THE CLUB'S SEASON, as the two days that bound it.
 *
 * Stored as `mm-dd` because a season RECURS: a club opening on 1 April opens
 * on 1 April every year, and storing a full date would make next year a second
 * row somebody has to remember to add. The organizer picks both from a
 * calendar; the year they pick is the one thing thrown away.
 *
 * Both halves are optional and independent. "We open in April" is a complete
 * answer on its own — `seasonWindow` reads a missing end as the end of the
 * year — and clearing both returns the club to the calendar year.
 *
 * Anything that is not a month and a day is stored as "" rather than refused:
 * this decides how a list is GROUPED, and the fallback is the calendar year,
 * which is exactly what an unanswered question means.
 */
export async function saveOrganizationSeason(startsOn: string, endsOn: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change this." };

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { seasonStartsOn: monthDayOrBlank(startsOn), seasonEndsOn: monthDayOrBlank(endsOn) },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * `mm-dd` from a calendar picker's `yyyy-mm-dd`, or from `mm-dd` itself.
 *
 * A `"use server"` export is a public HTTP endpoint and will be called with
 * whatever the caller likes, so the shape is checked here rather than trusted
 * from the screen. Validated against the longest each month can be, so
 * "02-30" is refused and 29 February is not — the window has no year, and a
 * club whose season opens on the 29th opens on it in a leap year.
 */
function monthDayOrBlank(value: string): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(v);
  if (!m) return "";
  const month = Number(m[1]);
  const day = Number(m[2]);
  const longest = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > longest[month - 1]) return "";
  return `${m[1]}-${m[2]}`;
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
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change this." };

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
 * WHERE THE CLUB IS — the clock its deadlines and its "today" are read from.
 *
 * See `domain/club-clock.ts` for why a club has one. Validated through
 * `isTimeZone`, for the reason the locale is: `Intl` THROWS on a zone it does
 * not know, so an unchecked value would break every screen that asks what day
 * it is, for the club that had just set it. And a `"use server"` export is a
 * public endpoint — this is called with whatever the caller likes.
 *
 * Answers with the clock on the club's wall, so the screen can show the
 * organizer the one thing that reveals a wrong choice: the time.
 */
export async function saveOrganizationTimeZone(timeZone: string): Promise<OrgResult & { clock?: string }> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change this." };

  const zone = typeof timeZone === "string" ? timeZone.trim() : "";
  if (!isTimeZone(zone)) return { ok: false, error: "Pick a time zone from the list." };

  const saved = await prisma.organization.update({
    where: { id: org.organizationId },
    data: { timeZone: zone },
    select: { locale: true },
  });
  // Every screen that asks what day it is reads this, so the whole tree
  // re-renders — the same reason the locale revalidates the layout.
  revalidatePath("/", "layout");
  return { ok: true, clock: clubClockInWords(zone, saved.locale) };
}

/**
 * THE CLUB TAKES ITS ORGANIZER'S OWN ZONE, ONCE, IF IT HAS NONE.
 *
 * A club has to be in the right zone from its first minute without anybody
 * being asked a question about time zones — and the person setting it up is,
 * nearly always, standing in it. So the console offers the device's zone the
 * first time somebody who may change the setting opens it, and this takes it
 * ONLY while the club has none: it never overwrites an answer, the club's own
 * or an earlier adoption's. Club settings shows what was taken and changes it.
 *
 * Refused quietly for anybody else, and for anything that is not a zone.
 */
export async function adoptClubTimeZone(timeZone: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change this." };

  const zone = typeof timeZone === "string" ? timeZone.trim() : "";
  if (!isTimeZone(zone)) return { ok: false, error: "That is not a time zone." };

  // `updateMany` with the empty value in the WHERE, so two tabs opening at
  // once cannot both write and the second cannot replace the first.
  const taken = await prisma.organization.updateMany({
    where: { id: org.organizationId, timeZone: "" },
    data: { timeZone: zone },
  });
  if (taken.count > 0) revalidatePath("/", "layout");
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
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change this." };

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
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change this." };

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

/**
 * Which golf the app speaks to this club — "us", "uk", or "" to follow the
 * country (`golf-terms.ts`). The same shape and the same guard as the noun
 * above: the country is the default, the organizer is the authority, and it
 * changes words only.
 */
export async function saveOrganizationGolfTerms(terms: string): Promise<OrgResult> {
  const org = await currentOrganization();
  if (!org) return { ok: false, error: "No organization found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change this." };

  const value = (terms ?? "").trim().toLowerCase();
  if (value !== "" && !isGolfRegister(value)) {
    return { ok: false, error: "Pick one of the listed options." };
  }

  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { golfTerms: value },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * LEAVE A CLUB YOU WERE ADDED TO (Ajay, 2026-10-11).
 *
 * Staff are added, not asked: typing an address makes that person staff at
 * once, with no acceptance step. The other half of that bargain is that the
 * person can undo it themselves — until now only a Commissioner or Admin of
 * the club could remove anybody, so somebody added by mistake, or by a club
 * they had left, had no way out but to write to the people who added them.
 *
 * WHOSE membership is the session's, never an argument: the row is found by
 * the caller's own user id AND the club named, so the id handed in can choose
 * only among the caller's own clubs. The one refusal is the one
 * `removeOrganizationMember` makes: the last Commissioner cannot go, because a
 * club with no owner has nobody who can ever add one.
 *
 * It takes away the staff role and nothing else. A place in a tournament's
 * field is an entry, not a membership, and results stay the club's.
 */
export async function leaveOrganization(organizationId: unknown): Promise<OrgResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };
  if (typeof organizationId !== "string" || !organizationId) return { ok: false, error: "Choose the club to leave." };

  const mine = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: session.userId } },
    select: { id: true, role: true },
  });
  if (!mine) return { ok: false, error: "You are not on that club's staff." };

  if (mine.role === "owner" && !(await hasOtherOwner(organizationId, mine.id))) {
    return { ok: false, error: "You are this club's only Commissioner — make somebody else a Commissioner first." };
  }

  await prisma.organizationMember.delete({ where: { id: mine.id } });
  revalidatePath("/", "layout");
  return { ok: true };
}
