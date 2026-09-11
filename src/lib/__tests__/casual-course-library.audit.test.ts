import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { libraryOrganizationFor, organizationIdsFor } from "@/lib/services/organization";
import { readSource } from "./source";

/**
 * "WHERE ARE YOU PLAYING?" HAD NO REACHABLE ANSWER.
 *
 * `/match/new` asks it, says underneath "needed before any score can go down
 * — the card decides pars, stroke index and every shot given", and keeps
 * "Start the round" disabled until it is answered. Walked on 2026-09-11,
 * typing a real course produced:
 *
 *     None of your courses match that. Try fewer letters, or add the
 *     course to your library first.
 *
 * The course was in the catalogue — 2,184 rows, Blue Ash Golf Course among
 * them.
 *
 * WHAT WAS MEASURED AND WHAT WAS READ, kept apart on purpose, because the
 * first explanation was wrong and stayed plausible for a while.
 *
 * MEASURED, on an account whose access to an event came from an Account row
 * and not an organization membership: `inLibrary` was computed against the
 * EVENT's club, which owned the course, while the list the picker shows is
 * built from MEMBERSHIPS, of which that account has none. So the hit was
 * marked already-held and filtered out, and the list that supposedly held it
 * was empty. Held by nobody, shown by nothing. Then, once that was fixed, the
 * pick still did nothing: the import bounced with "already in your course
 * library" — `ok: false` with the course's id attached — and the picker threw
 * the id away.
 *
 * READ OFF THE CODE, not observed: for somebody genuinely new, with no club
 * and no event, `searchCourseDirectory` never got as far as any of that.
 * It asked `requireOrganizerOrg`, which wants an `admin` role and a resolvable
 * `eventId` and refuses that person on both counts. `NewMatchForm` had
 * reasoned this out where it switched the search on — "somebody who has just
 * signed up to play their mate on Sunday belongs to none, so requiring a
 * course while offering only a list that is empty for a new user would be a
 * wall rather than a question" — and the search it turned on for that person
 * was the one screen that refused them.
 *
 * Three things had to be true and only the first was obvious: the search has
 * to answer, the pick has to have somewhere to put the course, and the two
 * have to be asking about the same library.
 */

const MARK = "zz-course-library";
const made: { orgs: string[]; events: string[]; users: string[] } = { orgs: [], events: [], users: [] };

async function makeUser(email: string, name: string) {
  const u = await prisma.user.create({ data: { email, name } });
  made.users.push(u.id);
  return u;
}

async function makeOrg(name: string, ownerId: string, role: string) {
  const org = await prisma.organization.create({
    data: { name, kind: "club", members: { create: { userId: ownerId, role } } },
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
  /**
   * BY THE MARK, not by what this run happens to have collected.
   *
   * A teardown only runs when the process lives long enough to reach it, and
   * `audit-guards` makes this structural for exactly that reason: every row
   * carries the mark so that no row needs another to be findable.
   *
   * It matters more than usual here, because half the organizations under
   * test are created by the FUNCTION rather than by this file —
   * `libraryOrganizationFor` makes a personal one on demand, named after the
   * person. So the display names carry the mark too, and that is the only
   * reason those are collectable at all.
   */
  const marked = await prisma.organization.findMany({
    where: { name: { startsWith: MARK } },
    select: { id: true },
  });
  const ids = [...new Set([...marked.map((o) => o.id), ...made.orgs])];

  await prisma.course.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.event.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.event.deleteMany({ where: { id: { in: made.events } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
});

describe("where a course a casual golfer picks is put", () => {
  it("gives somebody with no club a library of their own", async () => {
    const email = `${MARK}-solo@example.invalid`;
    await makeUser(email, `${MARK} Wren Calloway`);

    const orgId = await libraryOrganizationFor({ email, name: `${MARK} Wren Calloway`, eventId: "", role: "player" });

    expect(orgId).toBeTruthy();
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { kind: true },
    });
    // Their own, not a club's. `createMatch` puts the round here too, so the
    // round and the course it is played on end up in the same place.
    expect(org?.kind).toBe("personal");
  });

  it("gives them the SAME one the next time, rather than one per round", async () => {
    const email = `${MARK}-twice@example.invalid`;
    await makeUser(email, `${MARK} Bly Kessinger`);
    const who = { email, name: `${MARK} Bly Kessinger`, eventId: "", role: "player" };

    const first = await libraryOrganizationFor(who);
    const second = await libraryOrganizationFor(who);

    /**
     * The point of the whole fix: a casual golfer's second round finds the
     * course waiting. A fresh organization each time would re-ask "where are
     * you playing" forever and quietly accumulate an organization per round.
     */
    expect(second).toBe(first);
  });

  it("still curates the club's library for an organizer running a tournament", async () => {
    const email = `${MARK}-admin@example.invalid`;
    const user = await makeUser(email, `${MARK} Club Secretary`);
    const org = await makeOrg(`${MARK} Golf Club`, user.id, "owner");
    const ev = await makeEvent(org.id, `${MARK} Club Medal`);

    const orgId = await libraryOrganizationFor({
      email,
      name: `${MARK} Club Secretary`,
      eventId: ev.id,
      role: "admin",
    });

    // Unchanged behaviour for every caller that already had an answer.
    expect(orgId).toBe(org.id);
  });

  it("does not let a PLAYER write into the club whose tournament they are in", async () => {
    /**
     * The role is checked as well as the event, and this is why. A player in
     * somebody's tournament has that tournament's id on their session; taking
     * the event's organization from that alone would let picking a venue add
     * a course to a club they have no standing in.
     */
    const owner = await makeUser(`${MARK}-owner2@example.invalid`, `${MARK} Owner`);
    const org = await makeOrg(`${MARK} Second Club`, owner.id, "owner");
    const ev = await makeEvent(org.id, `${MARK} Open`);

    const email = `${MARK}-guest@example.invalid`;
    await makeUser(email, `${MARK} Visiting Player`);

    const orgId = await libraryOrganizationFor({
      email,
      name: `${MARK} Visiting Player`,
      eventId: ev.id,
      role: "player",
    });

    expect(orgId).not.toBe(org.id);
    const kind = await prisma.organization.findUnique({ where: { id: orgId }, select: { kind: true } });
    expect(kind?.kind).toBe("personal");
  });

  it("falls back to the person when the session names an event that is gone", async () => {
    // `requireOrganizerOrg` threw "Event not found" here. A stale event id on
    // a session is not a reason to refuse somebody a round.
    const email = `${MARK}-stale@example.invalid`;
    await makeUser(email, `${MARK} Stale Session`);

    const orgId = await libraryOrganizationFor({
      email,
      name: `${MARK} Stale Session`,
      eventId: "no-such-event-id",
      role: "admin",
    });

    const kind = await prisma.organization.findUnique({ where: { id: orgId }, select: { kind: true } });
    expect(kind?.kind).toBe("personal");
  });
});

/**
 * And the OTHER half, which is what kept the wall up after the guard was
 * fixed.
 *
 * `inLibrary` exists for one job — stop the picker offering "Add to library"
 * for a course already in the list above it — so it has to ask the question
 * that list asked. The list is built from the caller's MEMBERSHIPS, at
 * `/match/new` and everywhere else. The decoration was asking the EVENT's
 * organization.
 *
 * Measured, not reasoned about: with the guard fixed, the search returned
 * Blue Ash with `inLibrary: true`, the picker filtered it out, and `options`
 * — scoped to memberships, of which there were none — was empty. Marked as
 * already held, and held by nobody. The wall looked identical.
 */
describe("which library a search result is compared against", () => {
  it("asks the scope the picker's own list is built from", () => {
    const src = readSource("src/app/actions/courses.ts");
    const fn = src.slice(
      src.indexOf("export async function searchCourseDirectory"),
      src.indexOf("export interface DirectoryImportResult"),
    );
    expect(fn).toMatch(/organizationIdsFor\(session\.email\)/);
  });

  it("does not hide a hit because some OTHER library holds it", () => {
    /**
     * Tried the other way first, and it was worse.
     *
     * The import writes to `libraryOrganizationFor`, which for an organizer
     * whose access comes from an Account row is the EVENT's club — not one of
     * their memberships. Widening `inLibrary` to cover that made the hit
     * vanish as already-held, from a person whose visible list does not
     * contain it and never will. Held by a library they cannot see.
     *
     * Measured on 2026-09-11: the wall came straight back, differently
     * worded. So `inLibrary` answers only the question it is for — "is this
     * already in the list above" — and a course that turns out to exist
     * elsewhere is handled where it surfaces, by taking the id the import
     * hands back.
     */
    const src = readSource("src/app/actions/courses.ts");
    const fn = src.slice(
      src.indexOf("export async function searchCourseDirectory"),
      src.indexOf("export interface DirectoryImportResult"),
    );
    expect(fn).not.toMatch(/prisma\.event\.findUnique/);
  });

  it("takes the course id the server returns even when nothing was imported", () => {
    /**
     * "Already in your course library" is `ok: false` — correct, nothing was
     * added — WITH the existing course's id attached. Requiring `ok` threw it
     * away, and the click became a dead control on the one field the form
     * will not let you past: no venue chosen, no message, field still empty.
     *
     * The caller asked for a venue, not for an import.
     */
    const picker = readSource("src/components/CoursePicker.tsx");
    expect(picker).toMatch(/if \(res\.courseId\) \{/);
    expect(picker).not.toMatch(/if \(res\.ok && res\.courseId\)/);
  });

  it("shows the name of a course it took from the directory", () => {
    /**
     * `options` is a server prop fixed at page load, so a course picked out of
     * the directory is never in it — imported a moment ago, or living in a
     * library this reader cannot see. `chosen` was therefore null and the box
     * went blank: venue set, form satisfied, and the one field the screen will
     * not let you past looking untouched.
     *
     * Measured on /match/new on 2026-09-11 — the blocker underneath had
     * already advanced to the next question while the box still read "Type to
     * find a course". Nothing was broken except what the reader could see,
     * which is the half that decides whether they try again.
     */
    const picker = readSource("src/components/CoursePicker.tsx");
    expect(picker).toMatch(/setTakenFromDirectory\(\{ id: res\.courseId, name: hit\.name \}\)/);
    // And the fallback is USED, not merely stored.
    expect(picker).toMatch(/takenFromDirectory\.id === value \? takenFromDirectory : null/);
  });

  it("is the same scope /match/new builds its picker from", () => {
    // One question, two readers. If the page ever stops using memberships this
    // goes red rather than the picker quietly disagreeing again.
    const page = readSource("src", "app", "match", "new", "page.tsx");
    expect(page).toMatch(/organizationMember\.findMany/);
    expect(page).toMatch(/organizationId: \{ in: memberships\.map/);
  });

  it("reports nothing held for somebody who holds nothing", async () => {
    const email = `${MARK}-nolibrary@example.invalid`;
    await makeUser(email, `${MARK} No Club`);
    expect(await organizationIdsFor(email)).toEqual([]);
  });
});

/**
 * AND THE PICK HAS TO RESOLVE WITHOUT SPENDING ANYTHING.
 *
 * `importCourseFromDirectory` needs two things, and the fix above only
 * supplies one of them. The other is the course itself, through
 * `fetchDirectoryCourse` — and if that had to ask the remote API, every
 * casual golfer's first round would spend one of the 500 daily requests, and
 * would simply fail on a machine with no key configured. "The course
 * directory didn't answer" is a refusal a new user can do nothing about, in
 * the same place as the one this PR removes.
 *
 * It reads the catalogue first. Asserted rather than assumed, because it is
 * the difference between the wall being down and being moved one click along
 * — and because the picker only ever offers catalogue rows (`localOnly`), so
 * every hit it shows must resolve this way.
 */
describe("what picking a directory course costs", () => {
  /**
   * This one proves the id RESOLVES, not that it resolved locally — it passes
   * with the local read deleted, because a machine with an API key configured
   * simply fetches it instead. Measured by mutating, and left in with its name
   * corrected rather than dressed up: "the pick finds its course" is worth
   * pinning on its own, and the test below is what pins WHERE from.
   */
  it("turns a hit the picker offered into the course it names", async () => {
    const row = await prisma.courseCatalog.findFirst({ select: { id: true, name: true } });
    if (!row) {
      // A dev database with an empty catalogue proves nothing either way;
      // failing here would be a false alarm about the code.
      expect(true).toBe(true);
      return;
    }

    const { fetchDirectoryCourse } = await import("@/lib/services/course-directory");
    const course = await fetchDirectoryCourse(row.id);

    expect(course?.name).toBe(row.name);
  });

  it("is the same lookup the picker's own hits carry ids for", () => {
    // `searchDirectory(q, true)` returns catalogue rows, whose `id` IS the
    // `courseCatalog` id — so the branch above is the one that runs.
    const src = readSource("src/lib/services/course-directory.ts");
    const fn = src.slice(
      src.indexOf("export async function fetchDirectoryCourse"),
      src.indexOf("export async function fetchLiveDirectoryCourse"),
    );
    const local = fn.indexOf("courseCatalog.findUnique");
    const remote = fn.indexOf("getJson");
    /**
     * Both present, and the local read FIRST.
     *
     * Asserted as two positive indexes rather than `local < remote`, which is
     * satisfied by -1 — deleting the local read entirely would have passed
     * the ordering check while breaking the very thing it pins. Caught by
     * mutating it.
     */
    expect(local).toBeGreaterThanOrEqual(0);
    expect(remote).toBeGreaterThanOrEqual(0);
    expect(local).toBeLessThan(remote);
  });
});

/**
 * The quota, which is the one thing that must NOT get easier.
 *
 * A `"use server"` export is a public HTTP endpoint. The remote directory
 * lookup spends a shared allowance — 500 requests a day for the whole app —
 * so it keeps the organizer check it had. `localOnly` reads stored rows, a
 * public list of golf courses and nobody's data, and is what the quick-round
 * picker asks for.
 */
describe("what the directory search still refuses", () => {
  it("keeps the remote lookup behind the organizer check", () => {
    const src = readSource("src/app/actions/courses.ts");
    const fn = src.slice(
      src.indexOf("export async function searchCourseDirectory"),
      src.indexOf("export interface DirectoryImportResult"),
    );
    expect(fn).toMatch(/if \(!localOnly && session\.role !== "admin"\)/);
  });

  it("still refuses a caller with no session at all", () => {
    const src = readSource("src/app/actions/courses.ts");
    for (const name of ["searchCourseDirectory", "importCourseFromDirectory"]) {
      const i = src.indexOf(`export async function ${name}`);
      const fn = src.slice(i, i + 700);
      expect(fn).toMatch(/const session = await getSession\(\);/);
      expect(fn).toMatch(/if \(!session\) throw new Error\("Not authenticated"\);/);
    }
  });

  it("sends the picker at the local catalogue rather than the paid one", () => {
    // `searchCourseDirectory(q, true)`. Dropping the second argument would
    // send every keystroke of every quick round at the paid endpoint.
    const picker = readSource("src/components/CoursePicker.tsx");
    expect(picker).toMatch(/searchCourseDirectory\(q, true\)/);
  });
});
