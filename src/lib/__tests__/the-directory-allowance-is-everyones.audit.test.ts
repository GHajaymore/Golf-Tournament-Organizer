import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE COURSE DIRECTORY'S DAILY ALLOWANCE IS EVERYBODY'S (2026-10-11).
 *
 * The live directory answers 500 requests a day for the WHOLE APP. A
 * `"use server"` export is callable by anyone signed in, and signing in costs
 * a sign-up — so each account gets a personal hourly budget, and over it the
 * app answers from its own stored catalogue instead.
 *
 * That was the rule for one door of three. Found by listing every action with
 * no staff gate and reading each:
 *
 *   searching, as a player        counted, thirty an hour            (correct)
 *   searching, as an organizer    NOT counted — "organizers search as before".
 *                                 But anybody can make a club and a tournament
 *                                 and is then its admin, so the exemption
 *                                 exempted everybody who wanted it.
 *   importing a course by id      NOT counted, for anybody. An id the stored
 *                                 catalogue does not hold goes straight to the
 *                                 directory, so five hundred made-up ids from
 *                                 one account ended course look-up for every
 *                                 club until tomorrow.
 *
 * These four actions are kept OUT of the every-action sweep precisely because
 * they spend the allowance — which is how the one place nobody looked came to
 * be the one with the hole.
 *
 * The directory itself is never called here: `fetch` is replaced by a counter.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Map<string, string>(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { importCourseFromDirectory, searchCourseDirectory } from "@/app/actions/courses";
import { RATE_LIMITS } from "@/lib/domain/rate-limit";
import { clearRateLimit } from "@/lib/rate-limit";

const prisma = new PrismaClient();
const TAG = `zz-allowance-${process.pid}`;
const CATALOGUED = `${TAG}-in-the-catalogue`;

/** Every request that would have left for the directory. */
let asked: string[] = [];
const realFetch = globalThis.fetch;

interface Person {
  user: string;
  email: string;
  event: string;
}
const people: Record<"player" | "organizerImports" | "organizerSearches" | "spent", Person> = {
  player: { user: "", email: "", event: "" },
  organizerImports: { user: "", email: "", event: "" },
  organizerSearches: { user: "", email: "", event: "" },
  spent: { user: "", email: "", event: "" },
};

async function as(p: Person) {
  jar.clear();
  await createSession(p.user);
  await setActiveEvent(p.event);
}

/** A club with a live tournament; `who` is its Commissioner, or a player entered in it. */
async function person(key: keyof typeof people, role: "admin" | "player"): Promise<void> {
  const email = `${TAG}-${key}@example.invalid`;
  const user = await prisma.user.create({ data: { email, name: `${TAG} ${key}`, password: "x:unusable" }, select: { id: true } });
  const org = await prisma.organization.create({ data: { name: `${TAG} ${key} club`, kind: "club" }, select: { id: true } });
  const event = await prisma.event.create({
    data: {
      name: `${TAG} ${key} medal`,
      organizationId: org.id,
      status: "live",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${key}`,
    },
    select: { id: true },
  });
  if (role === "admin") {
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
    await prisma.account.create({ data: { eventId: event.id, name: `${TAG} ${key}`, email, role: "admin" } });
  } else {
    await prisma.player.create({ data: { eventId: event.id, name: `${TAG} ${key}`, email, seed: 1, status: "confirmed", handicap: 0 } });
  }
  people[key] = { user: user.id, email, event: event.id };
}

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("opengolfapi")) {
      asked.push(url);
      // The directory has never heard of it.
      return new Response("{}", { status: 404 });
    }
    return realFetch(input);
  }) as typeof fetch;

  await person("player", "player");
  await person("organizerImports", "admin");
  await person("organizerSearches", "admin");
  await person("spent", "player");
  const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  await prisma.courseCatalog.create({
    data: {
      id: CATALOGUED,
      name: `${TAG} Stored Links`,
      city: "Testville",
      par: PARS.reduce((a, b) => a + b, 0),
      pars: JSON.stringify(PARS),
      strokeIndex: JSON.stringify([7, 11, 15, 1, 9, 5, 17, 13, 3, 8, 12, 16, 2, 10, 6, 18, 14, 4]),
    },
  });
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  try {
    for (const p of Object.values(people)) {
      for (const kind of ["course-search", "course-search-staff"] as const) {
        if (kind in RATE_LIMITS) await clearRateLimit(kind as never, p.user).catch(() => {});
      }
    }
    await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: TAG } } });
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    // Every club here carries the mark at the front of its name — the four made
    // above, and the personal library a player is given on the way past, which
    // is named after the person (`newOrganizationName`), who is named by it too.
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  } finally {
    await prisma.$disconnect();
  }
});

const PLAYER_BUDGET = RATE_LIMITS["course-search"].limit;
// Read from the table rather than typed, so the test follows the policy — and
// fails loudly, rather than passing on `undefined`, if the kind is not there.
const STAFF_BUDGET = (RATE_LIMITS as Record<string, { limit: number } | undefined>)["course-search-staff"]?.limit ?? Number.NaN;

describe("one account cannot spend the app's day at the course directory", () => {
  it("a player importing made-up course ids is stopped at their own budget", async () => {
    await as(people.player);
    asked = [];
    for (let i = 0; i < PLAYER_BUDGET + 10; i += 1) {
      const r = await importCourseFromDirectory(`${TAG}-no-such-course-${i}`);
      expect(r.ok).toBe(false);
    }
    expect(asked.length, "requests that left for the directory").toBeLessThanOrEqual(PLAYER_BUDGET);
    // CONTROL: the budget is spent on real lookups, not refused from the first.
    expect(asked.length).toBe(PLAYER_BUDGET);
  }, 120_000);

  it("an organizer has a budget too — being one costs a sign-up", async () => {
    expect(STAFF_BUDGET, "there is no budget for an organizer at all").toBeGreaterThan(PLAYER_BUDGET);
    expect(STAFF_BUDGET).toBeLessThanOrEqual(200);

    await as(people.organizerImports);
    asked = [];
    for (let i = 0; i < STAFF_BUDGET + 10; i += 1) await importCourseFromDirectory(`${TAG}-org-no-such-course-${i}`);
    expect(asked.length, "an organizer's imports that left for the directory").toBe(STAFF_BUDGET);

    await as(people.organizerSearches);
    asked = [];
    for (let i = 0; i < STAFF_BUDGET + 10; i += 1) await searchCourseDirectory(`zzqx${TAG}${i}`);
    expect(asked.length, "an organizer's searches that left for the directory").toBe(STAFF_BUDGET);
  }, 300_000);

  it("searching and importing draw on ONE budget, not one each", async () => {
    // The player above has spent theirs importing. A search now stays at home.
    await as(people.player);
    asked = [];
    const hits = await searchCourseDirectory(`zzqx${TAG}player`);
    expect(asked).toEqual([]);
    expect(Array.isArray(hits.hits ?? hits)).toBe(true);
  });

  it("CONTROL: a course the app already holds costs nothing, even with the budget spent", async () => {
    await as(people.spent);
    asked = [];
    for (let i = 0; i < PLAYER_BUDGET + 2; i += 1) await importCourseFromDirectory(`${TAG}-spent-${i}`);
    expect(asked.length).toBe(PLAYER_BUDGET);

    asked = [];
    const r = await importCourseFromDirectory(CATALOGUED);
    expect(r.ok, `a stored course could not be added: ${r.error ?? ""}`).toBe(true);
    expect(asked, "the stored catalogue was bypassed").toEqual([]);
  }, 120_000);

  it("and over budget, the answer says so rather than blaming the directory", async () => {
    await as(people.spent);
    const r = await importCourseFromDirectory(`${TAG}-one-more`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Too many course/i);
    expect(r.error).not.toMatch(/didn't answer/i);
  });
});
