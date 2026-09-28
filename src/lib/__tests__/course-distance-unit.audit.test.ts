import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/** One browser's cookie jar, so a console session round-trips for real. */
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
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { saveClubCourse } from "@/app/actions/courses";
import { clubCourses } from "@/lib/services/courses";
import { distanceUnitFor } from "@/lib/services/round-card";
import { courseForRound } from "@/lib/services/course-resolution";
import { directorySourceUrl } from "@/lib/domain/course-directory";

/**
 * A COURSE'S DISTANCE UNIT, AGAINST REAL ROWS (decision 15, 2026-09-28).
 *
 * A German club: its own courses read in metres until somebody says otherwise,
 * a card from the course directory stays in yards, and the unit a club sets is
 * what is stored — validated at the boundary, because `saveClubCourse` is a
 * public endpoint and will be called with whatever the caller likes.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */
const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DISTANCE-UNIT";
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const PARS = [4, 4, 4, 5, ...new Array(14).fill(4)];

let orgId = "";
let eventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

const course = (name: string, extra: { distanceUnit?: string; sourceUrl?: string } = {}) =>
  prisma.course.create({
    data: {
      organizationId: orgId, name: `${TAG} ${name}`, city: "",
      pars: JSON.stringify(PARS), yards: JSON.stringify(new Array(18).fill(150)), strokeIndex: JSON.stringify(SI),
      ...extra,
    },
  });

const unitOf = async (id: string) => (await clubCourses(orgId, eventId)).find((c) => c.id === id)?.distanceUnit;
const storedOf = async (id: string) => (await prisma.course.findUniqueOrThrow({ where: { id } })).distanceUnit;
const save = (id: string, distanceUnit?: string) =>
  saveClubCourse({ id, name: `${TAG} home`, city: "", pars: PARS, yards: new Array(18).fill(150), strokeIndex: SI, distanceUnit });

beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} Golfclub`, kind: "club", country: "DE" } })).id;
  const event = await prisma.event.create({
    data: {
      organizationId: orgId, name: `${TAG} medal`, status: "registration", shape: "single", format: "stroke",
      formationRule: "balanced", dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: `audit-distance-${Date.now()}`, registrationToken: `r-distance-${Date.now()}`,
    },
  });
  eventId = event.id;
  const email = `${TAG.toLowerCase()}-sec@example.invalid`;
  const user = await prisma.user.create({ data: { email, name: `${TAG} Sec`, password: "x" } });
  await prisma.account.create({ data: { eventId, email, name: `${TAG} Sec`, role: "admin" } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: "owner" } });
  jar.clear();
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("what a German club's courses are measured in", () => {
  it("its own card, never set, reads in metres", async () => {
    const c = await course("home");
    expect(await storedOf(c.id)).toBe(""); // nothing was written to make it so
    expect(await unitOf(c.id)).toBe("metres");
  });

  it("a card from the course directory stays in yards", async () => {
    const c = await course("directory", { sourceUrl: directorySourceUrl("zz-dir-1") });
    expect(await unitOf(c.id)).toBe("yards");
  });

  it("the card a round is played on answers the same as the library", async () => {
    // Two readers of one question — the library and the round's card — must
    // agree, or the editor and the scorecard label one course two ways.
    const c = await course("round");
    const row = await prisma.course.findUniqueOrThrow({ where: { id: c.id } });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const resolved = courseForRound(row, { ...event, courseRef: null, courses: [] });
    expect(await distanceUnitFor(resolved, orgId)).toBe(await unitOf(c.id));
  });
});

describe("the unit a club sets is what is stored", () => {
  it("stores yards when the club says the card is in yards", async () => {
    const c = await course("switched");
    expect((await save(c.id, "yards")).ok).toBe(true);
    expect(await storedOf(c.id)).toBe("yards");
    expect(await unitOf(c.id)).toBe("yards");
  });

  it("leaves the unit alone when a caller does not send one", async () => {
    const c = await course("kept", { distanceUnit: "yards" });
    expect((await save(c.id)).ok).toBe(true);
    expect(await storedOf(c.id)).toBe("yards");
  });

  it("refuses anything but the two real units, and leaves the stored one", async () => {
    const c = await course("guarded", { distanceUnit: "metres" });
    await save(c.id, "furlongs");
    expect(await storedOf(c.id)).toBe("metres");
  });

  it("never converts the numbers — only the label they are read under changes", async () => {
    const c = await course("numbers");
    await save(c.id, "yards");
    expect(JSON.parse((await prisma.course.findUniqueOrThrow({ where: { id: c.id } })).yards)).toEqual(new Array(18).fill(150));
  });
});
