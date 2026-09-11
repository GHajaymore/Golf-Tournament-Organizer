import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { orgSetupFactsFor } from "@/lib/services/organization";
import { orgSetupState } from "@/lib/domain/org-setup";
import { readSource } from "./source";

/**
 * A LIVE TOURNAMENT TOLD ITS ORGANIZER TO CREATE THEIR FIRST TOURNAMENT.
 *
 * Read off Demo Cup on 2026-09-11 — 33 players, 47 results in, eight flights,
 * a bracket drawn — with this above it:
 *
 *     Setting up your outing
 *     1 of 3 done. Start with the tournament — the rest open up once you
 *     have one, and you can come back to them in any order.
 *       Name your outing        Opens once you have a tournament
 *       Decide how money works  Opens once you have a tournament
 *       Create your first tournament   Next
 *
 * `orgSetupFactsFor` chose an organization from the caller's MEMBERSHIPS —
 * owner or admin, club before personal, oldest first — and never looked at the
 * tournament on screen. So the checklist described one organization on a page
 * about another.
 *
 * The half that cannot be argued with is that it could not be completed by
 * following it. "Name your outing" links to `/organization`, which resolves
 * the EVENT's `organizationId` and names that club; the tick tracked the
 * membership-chosen one, so the step stayed undone however many times it was
 * actually done.
 *
 * It reproduces for anyone whose access to a tournament is an `Account` row
 * rather than an organization membership — an assistant the club invited by
 * email — and for anyone who owns two clubs, where the ordering picked the
 * older one whatever was open. Both got commoner the day a quick round started
 * creating a personal organization for whoever set it up.
 */

const MARK = "zz-setup-checklist";
const made: { orgs: string[]; events: string[] } = { orgs: [], events: [] };

async function makeUser(email: string, name: string) {
  return prisma.user.create({ data: { email, name } });
}

async function makeOrg(name: string, userId: string, extra: Record<string, unknown> = {}) {
  const org = await prisma.organization.create({
    data: { name, kind: "club", members: { create: { userId, role: "owner" } }, ...extra },
  });
  made.orgs.push(org.id);
  return org;
}

async function makeEvent(organizationId: string, name: string) {
  const ev = await prisma.event.create({
    data: {
      name,
      organizationId,
      dates: "2026-07-01",
      course: `${MARK} course`,
      city: "Nowhere",
      address: "1 Nowhere Lane",
      regDeadline: "2026-06-01",
      shareToken: `${MARK}-${Math.random().toString(36).slice(2, 10)}`,
    },
  });
  made.events.push(ev.id);
  return ev;
}

afterAll(async () => {
  // By the mark, per audit-guards: a teardown only runs when the process lives
  // long enough to reach it, so no row may depend on another to be findable.
  const marked = await prisma.organization.findMany({
    where: { name: { startsWith: MARK } },
    select: { id: true },
  });
  const ids = [...new Set([...marked.map((o) => o.id), ...made.orgs])];
  await prisma.event.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.event.deleteMany({ where: { id: { in: made.events } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
});

describe("which club the setup checklist is about", () => {
  it("is the one that owns the tournament on screen, not the one they joined first", async () => {
    /**
     * Two clubs, both owned. The OLDER is bare — no name of its own, no
     * events — and is the one the membership ordering picks. The tournament
     * open belongs to the other.
     */
    const email = `${MARK}-two@example.invalid`;
    const displayName = `${MARK} Two Clubs`;
    const user = await makeUser(email, displayName);

    // Named after the person, which is what `organizationWasNamed` calls unnamed.
    const bare = await makeOrg(displayName, user.id);
    const real = await makeOrg(`${MARK} Real Golf Club`, user.id, { moneyMode: "none" });
    const ev = await makeEvent(real.id, `${MARK} Club Medal`);

    const facts = await orgSetupFactsFor(email, displayName, ev.id);

    // The tournament's club: named, and holding the event we just made.
    expect(facts?.named).toBe(true);
    expect(facts?.eventCount).toBe(1);

    // And the control: asked with no tournament open, the old answer stands.
    const without = await orgSetupFactsFor(email, displayName);
    expect(without?.eventCount).toBe(0);
    expect(without?.named).toBe(false);
    expect(bare.id).toBeTruthy();
  });

  it("stops telling an organizer with a running tournament to create one", async () => {
    /**
     * The headline symptom, asserted through the state rather than the facts —
     * `eventCount === 0` is what `orgSetupState` turns into "Opens once you
     * have a tournament" on every OTHER step, so one wrong count blocks the
     * whole list.
     */
    const email = `${MARK}-live@example.invalid`;
    const displayName = `${MARK} Live Organizer`;
    const user = await makeUser(email, displayName);
    await makeOrg(displayName, user.id); // the bare personal-style club, created first
    const real = await makeOrg(`${MARK} Busy Club`, user.id, { moneyMode: "none" });
    const ev = await makeEvent(real.id, `${MARK} In Progress`);

    const state = orgSetupState((await orgSetupFactsFor(email, displayName, ev.id))!);

    const tournamentStep = state.remaining.find((s) => s.key === "tournament");
    expect(tournamentStep, "still asking for a first tournament").toBeUndefined();
    // And nothing else is walled off behind having one.
    expect(state.remaining.every((s) => !s.blocked)).toBe(true);
  });

  it("answers for somebody whose access is an Account rather than a membership", async () => {
    /**
     * The case that produced the screenshot. An assistant invited by email
     * belongs to no organization at all, so the membership query returns
     * nothing and the checklist used to come back null — or, once they had
     * played one casual round, described the personal organization that round
     * created.
     */
    const email = `${MARK}-account@example.invalid`;
    const displayName = `${MARK} Invited Assistant`;
    const owner = await makeUser(`${MARK}-owner@example.invalid`, `${MARK} Owner`);
    const club = await makeOrg(`${MARK} Host Club`, owner.id, { moneyMode: "none" });
    const ev = await makeEvent(club.id, `${MARK} Open`);
    await makeUser(email, displayName);

    const facts = await orgSetupFactsFor(email, displayName, ev.id);

    expect(facts).not.toBeNull();
    expect(facts?.eventCount).toBe(1);
    expect(facts?.named).toBe(true);

    // Without the tournament they still run nothing, and that is still right:
    // a person with no organization must not be shown a club setup checklist.
    expect(await orgSetupFactsFor(email, displayName)).toBeNull();
  });

  it("falls back rather than going blank on a stale tournament id", async () => {
    /**
     * Losing the checklist is a worse failure than choosing the organization
     * the old way, so an id that no longer resolves is not an answer.
     */
    const email = `${MARK}-stale@example.invalid`;
    const displayName = `${MARK} Stale`;
    const user = await makeUser(email, displayName);
    await makeOrg(`${MARK} Only Club`, user.id);

    const facts = await orgSetupFactsFor(email, displayName, "no-such-event-id");
    expect(facts).not.toBeNull();
    expect(facts?.eventCount).toBe(0);
  });

  it("counts the same things whichever way the club was chosen", async () => {
    /**
     * One reader for both paths. Two ways to answer "is this club set up" is
     * the defect this whole change is about, and splitting the counts is the
     * easy way to reintroduce it.
     */
    const email = `${MARK}-same@example.invalid`;
    const displayName = `${MARK} Same`;
    const user = await makeUser(email, displayName);
    const club = await makeOrg(`${MARK} Single Club`, user.id, { moneyMode: "none" });
    const ev = await makeEvent(club.id, `${MARK} Its Event`);

    const viaEvent = await orgSetupFactsFor(email, displayName, ev.id);
    const viaMembership = await orgSetupFactsFor(email, displayName);

    // Same club reached two ways — the facts must be identical.
    expect(viaEvent).toEqual(viaMembership);
  });
});

describe("who asks with a tournament and who does not", () => {
  it("is asked with one on the dashboard, where a tournament is open", () => {
    const page = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    expect(page).toMatch(/orgSetupFactsFor\(session\.email, session\.name, session\.eventId\)/);
  });

  it("is asked without one on the picker, where the point is that none is chosen", () => {
    /**
     * `/choose` is where a tournament has NOT been picked, so the membership
     * order is the right answer there — the checklist is about the club a new
     * tournament would land in, which is what `organizationForNewEvent`
     * decides. Passing the session's stale event id would describe whichever
     * tournament they last had open, on the screen for leaving it.
     */
    const page = readSource("src", "app", "choose", "page.tsx");
    expect(page).toMatch(/orgSetupFactsFor\(session\.email, session\.name\)/);
    expect(page).not.toMatch(/orgSetupFactsFor\(session\.email, session\.name, session\.eventId\)/);
  });
});
