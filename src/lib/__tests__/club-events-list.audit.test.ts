import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { clubEventsFor } from "@/lib/services/club-events";

/**
 * THE SCREEN A MEMBER OPENS TO FIND OUT WHAT THEIR CLUB IS RUNNING.
 *
 * Every row is a claim somebody acts on: whether entries are open, whether
 * they are already in, and whether there is a board worth opening. Getting any
 * of the three wrong sends a member to a form that refuses them or to an empty
 * table.
 *
 * SIX TOURNAMENTS IN ONE CLUB, each the shape of a different answer, so no
 * assertion can be satisfied by a rule that treats them all alike:
 *
 *     open        entries open, member not in it        -> can enter
 *     entered     entries open, member already in it    -> no way in, badge
 *     full        capacity reached                      -> shut, and says why
 *     finished    completed                             -> shut, viewable
 *     draft-played  status draft, cards on it           -> viewable ANYWAY
 *     draft-empty   status draft, nothing on it         -> not viewable
 *
 * THE LAST TWO ARE THE POINT. `canView` first asked `status`, which is exactly
 * the mistake this codebase keeps making — asking a label instead of counting
 * the rows. The seeded Demo Cup disproves it on the first screen it renders:
 * `status: "draft"` with fifty-four results on it. CLAUDE.md says the same,
 * that clubs run tournaments in draft. A rule keyed on status hides the
 * leaderboard of the tournament a member most wants to open.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-club-events";
const MEMBER = `${TAG}-member@example.invalid`;

const id: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function makeEvent(
  organizationId: string,
  label: string,
  over: { status?: string; capacity?: number; registrationOpen?: boolean },
): Promise<string> {
  const e = await prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${label}`,
      status: over.status ?? "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "",
      capacity: over.capacity ?? 0,
      registrationOpen: over.registrationOpen ?? true,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });
  return e.id;
}

beforeAll(async () => {
  await cleanup();

  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const user = await prisma.user.create({
    data: {
      email: MEMBER,
      name: `${TAG} member`,
      password: `${randomBytes(8).toString("hex")}:unusable`,
    },
    select: { id: true },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "member" },
  });

  id.open = await makeEvent(org.id, "open", {});
  id.entered = await makeEvent(org.id, "entered", {});
  id.full = await makeEvent(org.id, "full", { capacity: 1 });
  id.finished = await makeEvent(org.id, "finished", { status: "completed" });
  id.draftPlayed = await makeEvent(org.id, "draft-played", { status: "draft" });
  id.draftEmpty = await makeEvent(org.id, "draft-empty", { status: "draft" });

  // The member is in one of them.
  await prisma.player.create({
    data: {
      eventId: id.entered,
      name: `${TAG} member`,
      email: MEMBER,
      handicap: 12,
      seed: 1,
      status: "confirmed",
    },
  });

  // Somebody else fills the one-place tournament.
  await prisma.player.create({
    data: {
      eventId: id.full,
      name: `${TAG} somebody`,
      email: `${TAG}-somebody@example.invalid`,
      handicap: 4,
      seed: 1,
      status: "confirmed",
    },
  });

  // A card on the draft tournament — which is what makes it worth opening,
  // and what its status column will never say.
  const stage = await prisma.stage.create({
    data: {
      eventId: id.draftPlayed,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      scoringBasis: "gross",
    },
    select: { id: true },
  });
  const played = await prisma.player.create({
    data: {
      eventId: id.draftPlayed,
      name: `${TAG} played`,
      email: `${TAG}-played@example.invalid`,
      handicap: 8,
      seed: 1,
      status: "confirmed",
    },
    select: { id: true },
  });
  await prisma.scorecard.create({
    data: {
      eventId: id.draftPlayed,
      stageId: stage.id,
      playerId: played.id,
      strokes: JSON.stringify(new Array(18).fill(4)),
      status: "certified",
    },
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const rows = async () => {
  const all = await clubEventsFor(MEMBER);
  return new Map(all.map((r) => [r.eventId, r]));
};

describe("what a member is told about each of their club's tournaments", () => {
  it("lists every one of them", async () => {
    // The control. Every assertion below is satisfied by an empty list.
    const byId = await rows();
    for (const [label, eventId] of Object.entries(id)) {
      expect(byId.has(eventId), `${label} is missing from the member's list`).toBe(true);
    }
  });

  it("offers a way in to the one that is open", async () => {
    const r = (await rows()).get(id.open)!;
    expect(r.canEnter).toBe(true);
    expect(r.entered).toBe(false);
    expect(r.registrationHref, "and it points at the sign-up form").toContain("/register/");
  });

  it("offers no way in to the one they are already in", async () => {
    const r = (await rows()).get(id.entered)!;
    expect(r.entered, "they are in the field").toBe(true);
    expect(r.canEnter, "so there is nothing to sign up for").toBe(false);
    expect(r.registrationHref, "and no form to send them to").toBe("");
  });

  it("offers the full one as a WAITLIST rather than shutting it", async () => {
    /**
     * Written the other way round first, asserting a full tournament was shut.
     * The code was right and the test was wrong: `registrationStatus` returns
     * `state: "full"` with `acceptingEntries: true` and `waitlisting: true`,
     * labelled "Full — waitlist active". A club with a full field still wants
     * the next name down, and that is the better behaviour.
     *
     * Kept as a cell because it is the one place a member could be told
     * something the ORGANIZER'S screen does not say — the label is the
     * console's own, so the two cannot disagree about whether there is room.
     */
    const r = (await rows()).get(id.full)!;
    expect(r.statusLabel, "the console's own words, not a second opinion").toContain("Full");
    expect(r.canEnter, "a waitlist is still a way in").toBe(true);
    expect(r.statusDetail, "a badge alone does not explain itself").not.toBe("");
  });

  it("lets them open a finished tournament, and calls it Results", async () => {
    const r = (await rows()).get(id.finished)!;
    expect(r.canEnter, "a finished tournament takes no entries").toBe(false);
    expect(r.canView, "it is the one with a result on it").toBe(true);
    expect(r.viewLabel).toBe("Results");
  });
});

describe("a tournament being played in DRAFT", () => {
  it("can still be opened, because it has results on it", async () => {
    /**
     * THE CELL THE FIRST IMPLEMENTATION FAILED. `canView` asked `status`, so a
     * draft tournament with cards on it offered no way to see the board — and
     * the seeded Demo Cup is exactly that: `status: "draft"`, fifty-four
     * results. Counting the rows is the only answer that survives contact with
     * how clubs actually use this.
     */
    const r = (await rows()).get(id.draftPlayed)!;
    expect(r.eventStatus, "the status column still says draft").toBe("draft");
    expect(r.canView, "and there is a board behind the link anyway").toBe(true);
    expect(r.viewLabel).toBe("Leaderboard");
  });

  it("but an EMPTY draft offers nothing to look at", async () => {
    /**
     * The other direction, and what keeps the rule from being "always show it".
     * Sending a member to an empty table teaches them the link is broken
     * rather than that the tournament has not started.
     */
    const r = (await rows()).get(id.draftEmpty)!;
    expect(r.eventStatus).toBe("draft");
    expect(r.canView, "nothing has been played, so there is nothing to open").toBe(false);
  });
});
