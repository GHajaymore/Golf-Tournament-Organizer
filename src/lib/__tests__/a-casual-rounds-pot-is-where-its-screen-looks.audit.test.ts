import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

let session: { email: string; name: string; eventId: string; role: string; viewRole: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { createMatch } = await import("@/app/actions/match-setup");
const { QUICK_ROUND_FORMATS } = await import("@/lib/domain/quick-match");
const { roundPotKey } = await import("@/lib/domain/skins-pot");
const { readSource } = await import("./source");

/**
 * A CASUAL ROUND'S SKINS POT IS WHERE ITS MONEY SCREEN LOOKS (sweep 1, b10,
 * 2026-10-10).
 *
 * A pot is keyed on (round, net, nine, group). Setting a casual round up
 * wrote the pot's `net` from what the form ASKED for; the round's own basis is
 * stored through `basisFor`, which makes a Stableford round net whatever was
 * asked; and the money screen looks the pot up by the ROUND's basis. So a
 * Modified Stableford played level — the form's own default — with a skins
 * stake wrote a gross pot beside a net round. The money screen asked for the
 * net one, found nothing, and showed no skins game while the pot held
 * everybody's stake.
 *
 * (The game itself is the same either way: a level round stores zero for every
 * handicap, so net and gross skins are one result. Only the key was wrong.)
 *
 * The same fault was fixed once already for a level MATCH — the screen's own
 * comment describes a gross pot it asked for as net — by teaching the screen
 * about that case. The writer and the reader now share `roundPotKey`, so
 * there is no case to teach.
 *
 * PINNED ON THE AXIS: every casual format that can carry a skins pot, level
 * and with strokes, over eighteen and each nine.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROUNDPOT";
const EMAIL = `${TAG}-owner@example.invalid`.toLowerCase();

let courseId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: EMAIL, name: `${TAG} owner` }, select: { id: true } });
  const org = await prisma.organization.create({ data: { name: `${TAG} personal`, kind: "personal" }, select: { id: true } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
  courseId = (
    await prisma.course.create({
      data: {
        organizationId: org.id, name: `${TAG} course`, city: "", pars: JSON.stringify(new Array(18).fill(4)),
        yards: JSON.stringify(new Array(18).fill(400)), strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
      select: { id: true },
    })
  ).id;
  session = { email: EMAIL, name: `${TAG} owner`, eventId: "", role: "admin", viewRole: "admin" };
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const SHAPES: { holes: number; nine?: string; label: string }[] = [
  { holes: 18, label: "eighteen" },
  { holes: 9, nine: "front", label: "the front nine" },
  { holes: 9, nine: "back", label: "the back nine" },
];

describe("the pot a casual round is set up with is the one its money screen asks for", () => {
  let created = 0;
  let level = 0;

  for (const format of QUICK_ROUND_FORMATS) {
    for (const useHandicaps of [false, true]) {
      for (const shape of SHAPES) {
        const name = `${TAG} ${format.name} ${useHandicaps ? "strokes" : "level"} ${shape.label}`;
        it(`${format.name}, ${useHandicaps ? "with strokes" : "played level"}, over ${shape.label}`, async () => {
          const players = Array.from({ length: format.sideSize * 2 }, (_, i) => ({ name: `${name} p${i + 1}`, handicap: useHandicaps ? 10 + i : 0 }));
          const res = await createMatch({
            players, format: format.name, holes: shape.holes, nine: shape.nine, useHandicaps, courseId, name,
            money: { game: "skins", stakeCents: 500 },
          });
          // A format that cannot carry a skins pot refuses it at setup, which
          // is the right answer and not this test's subject.
          if (!res.ok) return;

          const stage = await prisma.stage.findFirst({ where: { event: { name } }, select: { id: true, scoringBasis: true, nine: true } });
          expect(stage, "the round exists").not.toBeNull();
          const pots = await prisma.skinsPot.findMany({ where: { stageId: stage!.id }, select: { net: true, scope: true, groupKey: true } });
          expect(pots, "one pot, the round's").toHaveLength(1);
          created += 1;
          if (!useHandicaps) level += 1;

          // What the money screen asks for, by the function it asks with.
          expect({ net: pots[0].net, scope: pots[0].scope, groupKey: pots[0].groupKey }).toEqual({ ...roundPotKey(stage!), groupKey: "" });
        });
      }
    }
  }

  it("CONTROL: the sweep really set rounds up, level ones among them", () => {
    // Every case above returns early when setup refuses. If they all did,
    // this file would be green and have checked nothing.
    expect(created).toBeGreaterThanOrEqual(6);
    expect(level).toBeGreaterThanOrEqual(3);
  });
});

describe("the writer and the reader ask the one function", () => {
  it("setup writes the pot under roundPotKey", () => {
    expect(readSource("src/app/actions/match-setup.ts")).toContain("...roundPotKey(");
  });

  it("the money screen reads the round's pot under roundPotKey", () => {
    expect(readSource("src/app/(app)/group-games/page.tsx")).toContain("roundPotKey(week)");
  });
});
