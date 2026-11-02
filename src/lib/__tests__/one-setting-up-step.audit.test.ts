import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * ONE "SETTING UP" STEP BEFORE LAUNCH (Ajay, 2026-10-31, gap G1), against real rows.
 *
 * Draft, registration and ready read as one, and nothing migrates: the three
 * stored values stay. So the security question is whether anything a STRANGER
 * reaches still tells them apart. The public sign-up is the stranger's door:
 *
 *   published link    the form opens and an entry is taken, identically, for all three
 *   unpublished link  the form is closed and the entry refused, in the same words, for all three
 *   the status action refuses a move to "registration" or "ready" (or back to "draft")
 *                     from outside, and writes nothing
 *
 * Real rows in the development database, under a zz- mark, deleted afterwards.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { registerForEvent } from "@/app/actions/register";
import { setEventStatus } from "@/app/actions/tournament";
import { openRegistrationView } from "@/lib/services/registration";

const prisma = new PrismaClient();
const TAG = "zz-one-setting-up";
/** Fresh every run: the public form's rate limiter is keyed on token and email and outlives this file. */
const RUN = randomBytes(4).toString("hex");
const at = (who: string) => `${TAG}-${who}-${RUN}@example.invalid`;
const STATUSES = ["draft", "registration", "ready"] as const;

let orgId = "";
let userId = "";
let made = 0;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function tournament(status: string, published: boolean) {
  const token = `${TAG}-${status}-${published ? "open" : "shut"}-${RUN}-${(made += 1)}`;
  const row = await prisma.event.create({
    data: {
      // Numbered: two of one name may not be in play in one club (migration A036).
      organizationId: orgId, name: `${TAG} ${status} ${published ? "open" : "shut"} #${made}`, status, shape: "single", format: "stroke",
      formationRule: "balanced", dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      registrationOpen: published, registrationApproval: "auto", registrationToken: token, shareToken: `${token}-share`,
    },
    select: { id: true },
  });
  await prisma.account.create({ data: { eventId: row.id, email: at("organizer"), name: `${TAG} Organizer`, role: "admin" } });
  return { id: row.id, token };
}

const form = (who: string) => ({ name: `${TAG} ${who}`, email: at(who), handicap: "12", handicapType: "18", phone: "", preferredTee: "" });

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  userId = (
    await prisma.user.create({ data: { email: at("organizer"), name: `${TAG} Organizer`, password: "x:unusable", emailVerifiedAt: new Date() }, select: { id: true } })
  ).id;
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId, role: "owner" } });
  await createSession(userId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the public sign-up reads the three setting-up statuses as one", () => {
  it("with the link published: the form opens and the entry is taken, the same way for all three", async () => {
    const seen: string[] = [];
    for (const status of STATUSES) {
      const ev = await tournament(status, true);
      const view = await openRegistrationView(ev.token);
      const res = await registerForEvent(ev.token, form(`${status}-open`));
      seen.push(JSON.stringify({ form: !!view, waitlist: view?.waitlistOnly ?? null, res }));
      expect(await prisma.player.count({ where: { eventId: ev.id } }), `${status}: nobody was entered`).toBe(1);
    }
    expect(seen[0]).toContain('"form":true');
    expect(seen[0]).toContain('"ok":true');
    expect(new Set(seen).size, `the statuses answered differently: ${seen.join(" | ")}`).toBe(1);
  });

  it("with the link unpublished: the form is closed and the entry refused, in the same words, for all three", async () => {
    const seen: string[] = [];
    for (const status of STATUSES) {
      const ev = await tournament(status, false);
      const view = await openRegistrationView(ev.token);
      const res = await registerForEvent(ev.token, form(`${status}-shut`));
      seen.push(JSON.stringify({ form: !!view, res }));
      expect(await prisma.player.count({ where: { eventId: ev.id } }), `${status}: somebody got in`).toBe(0);
    }
    expect(seen[0]).toContain('"form":false');
    expect(seen[0]).toContain('"ok":false');
    expect(new Set(seen).size, `the statuses answered differently: ${seen.join(" | ")}`).toBe(1);
  });
});

describe("the status action does not move between them", () => {
  it("refuses a move to registration, ready or draft from outside, and writes nothing", async () => {
    const ev = await tournament("draft", false);
    await setActiveEvent(ev.id);
    for (const to of ["registration", "ready", "draft"]) {
      const res = await setEventStatus(to);
      expect(res.ok, `${to} was written`).toBe(false);
      expect(res.error).toContain("one Setting up step");
      expect((await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe("draft");
    }
  });
});
