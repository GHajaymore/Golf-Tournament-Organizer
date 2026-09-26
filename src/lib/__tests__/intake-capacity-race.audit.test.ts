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
 * TWO ENTRANTS RACING THE LAST CONFIRMED SLOT.
 *
 * The sign-up paths read the confirmed count, ask `decideIntake` whether this
 * entry is confirmed or waitlisted, and create the row — three statements with
 * nothing between them. Two people entering a field with one place left at the
 * same instant both read the same count, `decideIntake` tells both "confirmed",
 * and both are created: the field goes over the cap the organizer or the tier
 * set. Nothing between the count and the create stopped it, because the count is
 * `READ COMMITTED` and sees only committed rows — neither entry has committed
 * when the other counts.
 *
 * `withEventIntakeLock` closes it by serialising that section per event with a
 * Postgres advisory lock, so the second entrant's count already includes the
 * first. Both doors use it — this drives the PUBLIC one (`registerForEvent`),
 * which needs no session, so two genuinely concurrent strangers can be fired at
 * one link; `enter.ts` guards the signed-in door through the same helper.
 *
 * WHY THIS IS MUTATION-SENSITIVE. Remove the lock from `intake-lock.ts` (make it
 * `fn(prisma)` with no `pg_advisory_xact_lock`) and, whenever the two overlap,
 * both count zero and both confirm — the field holds two confirmed against a
 * cap of one, and the sort below reads `["confirmed", "confirmed"]`. With the
 * lock the outcome is deterministic whether the two overlap or fall sequential:
 * exactly one confirmed, one waitlisted.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-intake-race";
/** A fresh run every time: the rate limiter is keyed on the token and the email
 *  and lives in Postgres, so it outlives this file deleting its own rows. A
 *  fixed token or address would fail the second run inside the window on the
 *  limiter, before reaching the rule under test. */
const RUN = randomBytes(4).toString("hex");

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

/** A complete, valid public entry. A phone is present because a free club always
 *  collects one (`phoneRequiredFor`), so its absence would be rejected before
 *  the count is ever read — a refusal that has nothing to do with the race. */
const form = (who: string) => ({
  name: `${TAG} ${who} ${RUN}`,
  email: `${TAG}-${who}-${RUN}@example.invalid`,
  handicap: "12",
  handicapType: "18",
  phone: "15551234567",
  preferredTee: "White",
});

let token = "";
let eventId = "";

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  token = randomBytes(6).toString("hex");
  const ev = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} cap one`,
      status: "registration",
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${TAG} Course`,
      city: `${TAG} Town`,
      address: "",
      regDeadline: "",
      // One place. The whole field is the race.
      capacity: 1,
      registrationOpen: true,
      // Auto, not approve: an approve-mode club puts both entries at "pending"
      // and the capacity rule never runs, so nothing would be under test.
      registrationApproval: "auto",
      registrationToken: token,
      shareToken: randomBytes(10).toString("hex"),
    },
    select: { id: true },
  });
  eventId = ev.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("two strangers registering for the last slot at once", () => {
  it("confirms exactly one and waitlists the other, never both", async () => {
    const [a, b] = await Promise.all([
      registerForEvent(token, form("ada")),
      registerForEvent(token, form("bo")),
    ]);
    expect(a.ok, a.error).toBe(true);
    expect(b.ok, b.error).toBe(true);

    // The invariant the lock exists for: the two outcomes are one confirmed and
    // one waitlisted, in whichever order they landed — never two confirmed.
    expect([a.status, b.status].sort()).toEqual(["confirmed", "waitlisted"]);

    const rows = await prisma.player.findMany({ where: { eventId }, select: { status: true } });
    expect(rows, "both entrants should be recorded").toHaveLength(2);
    expect(
      rows.filter((r) => r.status === "confirmed"),
      "the field went over its cap of one — the count-then-create race",
    ).toHaveLength(1);
  });
});
