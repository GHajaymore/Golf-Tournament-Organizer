import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { registerForEvent } from "@/app/actions/register";

/**
 * A MEMBER ENTERS THE SEASON IN ONE SITTING (2026-10-10).
 *
 * Found running a society's Saturday Stableford for the fourth time: the same
 * member, entering through each tournament's public link, was refused with "Too
 * many registration attempts. Wait 6 minutes" — by a per-person cap written for
 * a double-tap on ONE form, counted across every tournament the address had
 * entered that hour. A society that publishes its calendar and a member who
 * enters it the same evening is the ordinary case.
 *
 * So `register-email` counts one person's attempts at one tournament
 * (`entryLimitKey`). The control is the cap's own job: one person submitting
 * one form over and over is still refused.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-season-sitting";
// Fresh every run: the limiter lives in Postgres and outlives this file's rows.
const RUN = randomBytes(4).toString("hex");
const EMAIL = `${TAG}-${RUN}@example.invalid`;
const form = () => ({
  name: `${TAG} Member ${RUN}`,
  email: EMAIL,
  handicap: "12",
  handicapType: "18",
  phone: "15551234567",
  preferredTee: "White",
});

const tokens: string[] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "society" }, select: { id: true } });
  for (let i = 0; i < 8; i += 1) {
    const token = randomBytes(6).toString("hex");
    tokens.push(token);
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} event ${i + 1}`,
        status: "registration",
        shape: "single",
        format: "stroke",
        formationRule: "balanced",
        dates: "",
        course: `${TAG} Course`,
        city: `${TAG} Town`,
        address: "",
        regDeadline: "",
        capacity: 0,
        registrationOpen: true,
        registrationApproval: "auto",
        registrationToken: token,
        shareToken: randomBytes(10).toString("hex"),
      },
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("one member, the society's whole calendar, one evening", () => {
  it("enters all eight tournaments", async () => {
    for (const [i, token] of tokens.entries()) {
      const res = await registerForEvent(token, form());
      expect(res.ok, `event ${i + 1}: ${res.ok ? "" : res.error}`).toBe(true);
    }
    const rows = await prisma.player.count({ where: { email: EMAIL, status: "confirmed" } });
    expect(rows).toBe(8);
  });

  it("CONTROL: the same form submitted over and over is still refused", async () => {
    // Six attempts an hour at one tournament; the first entry above was one.
    const outcomes: boolean[] = [];
    for (let k = 0; k < 7; k += 1) outcomes.push((await registerForEvent(tokens[0], form())).ok);
    expect(outcomes.slice(0, 5).every(Boolean), "a re-submit is a no-op, not a refusal").toBe(true);
    const last = await registerForEvent(tokens[0], form());
    expect(last.ok).toBe(false);
    expect(last.ok ? "" : last.error).toMatch(/Too many registration attempts/);
  });
});
