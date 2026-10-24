import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A PLAYER'S MOBILE IS OPTIONAL ON EVERY PLAN (Ajay, 2026-10-21, decisions
 * review A7: "go with your recommendations").
 *
 * Until that day a free (Par) club's tournament refused every entrant without
 * a mobile, unless its players used Round Codes, and only a paid club could
 * stop asking. Now the organizer decides per tournament with `requirePhone`,
 * off by default, and the plan plays no part (`phoneRequiredFor`).
 *
 * Through the three doors an entrant comes in by, against real rows, on a club
 * that is on the free plan:
 *
 *   requirePhone off   the public form, the organizer's Add and the CSV import
 *                      each take an entrant with no mobile
 *   requirePhone on    each refuses one, in words, and writes nobody — the
 *                      control: without it, a rule that asked nobody would
 *                      pass the first half
 *
 * and the organizer's Add on every plan key, so a plan that crept back into the
 * rule would be seen here and not only in `phone-required.test.ts`.
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
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { createSession, setActiveEvent } from "@/lib/auth";
import { addSignup, importCsvSignups } from "@/app/actions/tournament";
import { registerForEvent } from "@/app/actions/register";
import { PLANS } from "@/lib/plans";

const prisma = new PrismaClient();
const TAG = "zz-phone-optional";
/** Fresh every run: the public form's rate limiter is keyed on token and email
 *  and lives in Postgres, so it outlives this file deleting its own rows. */
const RUN = randomBytes(4).toString("hex");
const at = (who: string) => `${TAG}-${who}-${RUN}@example.invalid`;

let orgId = "";
const ev = { quiet: { id: "", token: "" }, asks: { id: "", token: "" } };

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
}

const setPlan = (plan: string) => prisma.subscription.update({ where: { organizationId: orgId }, data: { plan } });

/** A public entry with everything but a mobile. */
const publicForm = (who: string) => ({
  name: `${TAG} ${who} ${RUN}`,
  email: at(who),
  handicap: "12",
  handicapType: "18",
  phone: "",
  preferredTee: "",
});

const fieldOf = (eventId: string) => prisma.player.findMany({ where: { eventId }, select: { name: true, phone: true } });

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  orgId = org.id;
  await prisma.subscription.create({ data: { organizationId: org.id, plan: "free", planTermsApply: true } });
  const user = await prisma.user.create({ data: { email: at("organizer"), name: `${TAG} Organizer`, password: "x:unusable" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
  for (const [key, requirePhone] of [["quiet", false], ["asks", true]] as const) {
    const token = `${TAG}-${key}-${RUN}`;
    const row = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} ${key} medal`,
        status: "registration",
        shape: "single",
        format: "stroke",
        formationRule: "balanced",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        capacity: 0,
        registrationOpen: true,
        registrationApproval: "auto",
        registrationToken: token,
        shareToken: `${token}-share`,
        requirePhone,
      },
      select: { id: true },
    });
    ev[key] = { id: row.id, token };
    await prisma.account.create({ data: { eventId: row.id, email: at("organizer"), name: `${TAG} Organizer`, role: "admin" } });
  }
  jar.clear();
  await createSession(user.id);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a free club's tournament that does not ask for a mobile", () => {
  it("the public form takes an entrant with none", async () => {
    const res = await registerForEvent(ev.quiet.token, publicForm("public"));
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(await fieldOf(ev.quiet.id)).toContainEqual({ name: `${TAG} public ${RUN}`, phone: "" });
  });

  it("the organizer's Add takes a player with none", async () => {
    await setActiveEvent(ev.quiet.id);
    const res = await addSignup({ name: `${TAG} added ${RUN}`, email: at("added"), phone: "", handicap: 12 });
    expect(res.ok, res.error).toBe(true);
    expect(await fieldOf(ev.quiet.id)).toContainEqual({ name: `${TAG} added ${RUN}`, phone: "" });
  });

  it("the CSV import takes a file with no phone column", async () => {
    await setActiveEvent(ev.quiet.id);
    const res = await importCsvSignups(`name,email,handicap\n${TAG} csv ${RUN},${at("csv")},10\n`);
    expect(res.error).toBeFalsy();
    expect(res.imported).toBe(1);
    expect(await fieldOf(ev.quiet.id)).toContainEqual({ name: `${TAG} csv ${RUN}`, phone: "" });
  });

  it("and so on every plan: the organizer's Add, plan by plan", async () => {
    await setActiveEvent(ev.quiet.id);
    try {
      for (const plan of Object.keys(PLANS)) {
        await setPlan(plan);
        const res = await addSignup({ name: `${TAG} ${plan} ${RUN}`, email: at(plan), phone: "", handicap: 12 });
        expect(res.ok, `${plan}: ${res.error}`).toBe(true);
      }
    } finally {
      await setPlan("free");
    }
  });
});

describe("CONTROL: a free club's tournament that asks for a mobile", () => {
  it("the public form refuses an entrant with none, in words", async () => {
    const res = await registerForEvent(ev.asks.token, publicForm("public"));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Enter a mobile number — this tournament needs one to reach you on the day.");
    expect(await fieldOf(ev.asks.id)).toEqual([]);
  });

  it("the organizer's Add refuses a player with none, in words", async () => {
    await setActiveEvent(ev.asks.id);
    const res = await addSignup({ name: `${TAG} added ${RUN}`, email: at("added"), phone: "", handicap: 12 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Enter a mobile number for this player.");
    expect(await fieldOf(ev.asks.id)).toEqual([]);
  });

  it("the CSV import refuses a file with no phone column, in words", async () => {
    await setActiveEvent(ev.asks.id);
    const res = await importCsvSignups(`name,email,handicap\n${TAG} csv ${RUN},${at("csv")},10\n`);
    expect(res.imported).toBe(0);
    expect(res.error).toMatch(/Couldn't find a "phone" column/);
    expect(res.error).toMatch(/collects a mobile number for every entrant/);
    expect(await fieldOf(ev.asks.id)).toEqual([]);
  });

  it("and each lets the entrant in once they give one — the refusal is the mobile, not the fixture", async () => {
    await setActiveEvent(ev.asks.id);
    const res = await addSignup({ name: `${TAG} with ${RUN}`, email: at("with"), phone: "07700 900661", handicap: 12 });
    expect(res.ok, res.error).toBe(true);
    const pub = await registerForEvent(ev.asks.token, { ...publicForm("publicwith"), phone: "07700 900662" });
    expect(pub.ok, pub.error).toBe(true);
    const csv = await importCsvSignups(`name,email,phone,handicap\n${TAG} csvwith ${RUN},${at("csvwith")},07700 900663,10\n`);
    expect(csv.error).toBeFalsy();
    expect(csv.imported).toBe(1);
    expect((await fieldOf(ev.asks.id)).length).toBe(3);
  });
});
