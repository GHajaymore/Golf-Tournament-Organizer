import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { primaryOrganizationFor } from "@/lib/services/organization";
import { readSource } from "./source";

/**
 * WHICH CLUB A SESSION MAY READ, WHEN THERE IS NO TOURNAMENT TO ASK.
 *
 * Club settings and the member list used to resolve their organization through
 * the open event, which made them unreachable before a club's first
 * tournament. `primaryOrganizationFor` is what replaced that, and it is now
 * the door to a club's branding, its handicap policy, its money default and
 * its whole roster.
 *
 * SO THE SAFETY PROPERTY IS WORTH STATING PLAINLY: the fallback half of this
 * function reads `organizationsForOrganizer`, which returns only organizations
 * this person OWNS or ADMINISTERS — so membership of the returned club is
 * itself the authorization, and it is a narrower test than the role check, not
 * a looser one.
 *
 * The event half has no role check of its own, deliberately, because with a
 * tournament open the ordinary console guard is the right one and every
 * existing caller was already making it. That makes this a guard somebody must
 * remember to call — the shape CLAUDE.md says will be forgotten — so the last
 * test pins the one caller that must make it. `libraryOrganizationFor`, five
 * lines below it in the same file, carries its own `role === "admin"` check
 * for exactly this reason; the difference between them is not an oversight and
 * is asserted here so it stays deliberate.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ORGDOOR";
const OWNER = `${TAG}-owner@example.invalid`.toLowerCase();
const STRANGER = `${TAG}-stranger@example.invalid`.toLowerCase();
const NOBODY = `${TAG}-nobody@example.invalid`.toLowerCase();

let ownersClub = "";
let strangersClub = "";
let strangersEvent = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { in: [OWNER, STRANGER, NOBODY] } } });
}

async function clubOwnedBy(name: string, email: string) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: `${TAG} ${email}` },
    select: { id: true },
  });
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${name}`, kind: "club" },
    select: { id: true },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "owner" },
  });
  return org.id;
}

beforeAll(async () => {
  await scrub();
  ownersClub = await clubOwnedBy("owners club", OWNER);
  strangersClub = await clubOwnedBy("strangers club", STRANGER);
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} strangers open`,
      organizationId: strangersClub,
      // Every scalar Event requires and gives no default. Blank rather than
      // invented: nothing here reads them, and a fixture that looks like a
      // real tournament is a fixture somebody will mistake for one.
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      // Unique, so it is the one that cannot be blank — marked like every
      // other row this file writes, so `scrub` is not the only thing that can
      // identify it.
      shareToken: `${TAG}-share`,
    },
    select: { id: true },
  });
  strangersEvent = ev.id;
  // Somebody with an account and no club at all — a player invited to a
  // tournament, which is the commonest session in the product.
  await prisma.user.create({ data: { email: NOBODY, name: `${TAG} nobody` } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("with no tournament open", () => {
  it("answers with the club this person actually runs", () => {
    return expect(primaryOrganizationFor({ email: OWNER, eventId: "" })).resolves.toBe(ownersClub);
  });

  it("never answers with somebody else's club", async () => {
    /**
     * THE WHOLE SAFETY PROPERTY OF THE FALLBACK. A wrong answer here is not a
     * cosmetic fault: the caller goes on to render that club's roster —
     * names, emails, phone numbers, handicaps — and to write its branding and
     * handicap policy.
     */
    expect(await primaryOrganizationFor({ email: OWNER, eventId: "" })).not.toBe(strangersClub);
    expect(await primaryOrganizationFor({ email: STRANGER, eventId: "" })).not.toBe(ownersClub);
  });

  it("answers null for somebody who runs no club, rather than inventing one", async () => {
    /**
     * Null is a real state and must stay one. Creating a tenant as a side
     * effect of rendering a page is how orphan organizations get made — the
     * reason `orgSetupFactsFor` returns null too — and the caller sends them
     * to `/choose`, which is the screen for exactly this person.
     */
    expect(await primaryOrganizationFor({ email: NOBODY, eventId: "" })).toBeNull();
    expect(await primaryOrganizationFor({ email: `${TAG}-never-signed-up@example.invalid`, eventId: "" })).toBeNull();
  });
});

describe("with a tournament open", () => {
  it("prefers that tournament's club, so switching tournament switches club", async () => {
    // The behaviour every existing caller had before the fallback existed, and
    // the reason this is not a behaviour change for anybody who has a
    // tournament — which is every organizer after their first day.
    expect(await primaryOrganizationFor({ email: STRANGER, eventId: strangersEvent })).toBe(strangersClub);
  });

  it("does NOT check the role itself — the caller must", async () => {
    /**
     * ASSERTED AS THE UNSAFE ANSWER, on purpose, because it is true and
     * writing it down is the only thing that keeps it deliberate.
     *
     * An email that owns nothing at all still gets the stranger's club back
     * when a stranger's event id is on the session. That is safe ONLY because
     * `requireOrgScreen` refuses first — see the next test — and it is why a
     * third caller written later cannot use this function without making that
     * check.
     *
     * If this ever stops being true, the fix is to move the role check INTO
     * this function (the shape CLAUDE.md prefers, and what
     * `libraryOrganizationFor` already does) and delete this test, not to
     * weaken the one below.
     */
    expect(await primaryOrganizationFor({ email: NOBODY, eventId: strangersEvent })).toBe(strangersClub);
  });
});

describe("the door that does check", () => {
  it("refuses on the role BEFORE it resolves an organization", () => {
    /**
     * ORDER IS THE ASSERTION. Resolving first and checking second would still
     * be correct today, and would stop being correct the moment somebody
     * returns early or logs what was resolved. The refusal comes first.
     */
    const src = readSource("src", "lib", "page-helpers.ts");
    const fn = src.slice(src.indexOf("export async function requireOrgScreen"));
    const check = fn.indexOf("canAccessScreen(session.viewRole, key)");
    const resolve = fn.indexOf("primaryOrganizationFor(session)");
    expect(check, "requireOrgScreen no longer checks the role").toBeGreaterThan(-1);
    expect(resolve, "requireOrgScreen no longer resolves an organization").toBeGreaterThan(-1);
    expect(check).toBeLessThan(resolve);
    // And the check is only skipped where there is no event to judge by.
    expect(fn).toMatch(/if \(session\.eventId && !canAccessScreen/);
  });

  it("sends somebody with no club to /choose rather than rendering an empty one", () => {
    const src = readSource("src", "lib", "page-helpers.ts");
    const fn = src.slice(src.indexOf("export async function requireOrgScreen"));
    expect(fn).toMatch(/if \(!organizationId\) redirect\("\/choose"\)/);
  });

  it("is the door both club screens use", () => {
    /**
     * Pinned because the point of the change was that these two stop reading
     * `organizationIdForEvent`. A screen that went back to it would work — and
     * would quietly become unreachable again for a club with no tournament,
     * which is the fault this whole thread of work exists to fix.
     */
    for (const page of [
      ["src", "app", "(app)", "roster", "page.tsx"],
      ["src", "app", "(app)", "organization", "page.tsx"],
    ]) {
      const src = readSource(...page);
      expect(src, page.join("/")).toMatch(/requireOrgScreen\(/);
      expect(src, `${page.join("/")} still resolves its club from the open event`).not.toMatch(
        /organizationIdForEvent\(session\.eventId\)/,
      );
    }
  });
});
