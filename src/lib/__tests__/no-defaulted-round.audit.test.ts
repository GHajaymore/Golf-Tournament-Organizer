import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * No tournament arrives holding a round nobody chose.
 *
 * "Start from scratch" — whose whole blurb is "the plain defaults, set
 * everything yourself" — used to fall through to the SHAPE's opening round, so
 * every such tournament was created carrying a Round Robin it had never been
 * asked about.
 *
 * That is not a harmless placeholder. A round's type and format decide what is
 * scored and how: `stage-types.ts` records a round robin set to stroke play
 * "generating a full set of pairings for a round in which nobody plays
 * anybody". A default here is a scoring decision made on the organizer's
 * behalf and never mentioned again.
 *
 * A TEMPLATE IS DIFFERENT, and this file asserts the difference. Picking "Club
 * championship" IS choosing stroke play — the blurb says what it is, and
 * building a member-guest's rounds by hand is the assembly work that keeps
 * clubs on what they know. What is banned is the app deciding when nobody did.
 *
 * Zero rounds is an already-supported state: the setup checklist has said "No
 * rounds yet — sequence the tournament" since it was written, and Rounds &
 * formats is step two of the guided flow.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NO-DEFAULT";
const EMAIL = "zz-audit-no-default@example.invalid";

const session = { email: EMAIL, name: `${TAG} organizer`, eventId: "", role: "admin" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { createEvent } = await import("@/app/actions/tournament");

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

/** The rounds a freshly created tournament holds. */
async function roundsOf(name: string) {
  const ev = await prisma.event.findFirst({
    where: { name: `${TAG} ${name}` },
    select: { id: true },
  });
  expect(ev, `${name} was created`).not.toBeNull();
  return prisma.stage.findMany({
    where: { eventId: ev!.id },
    select: { type: true, format: true },
    orderBy: { position: "asc" },
  });
}

beforeAll(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("what rounds a new tournament arrives holding", () => {
  it("creates NONE when nobody chose a format", async () => {
    // "Start from scratch" is the one template that applies nothing.
    await createEvent(`${TAG} scratch`, "custom", "single");
    expect(await roundsOf("scratch"), "no round, and so no defaulted format").toEqual([]);
  });

  it("creates none for an unknown template key either", async () => {
    /**
     * `templateFor` falls back to `custom` rather than throwing, so an old
     * link cannot block creating a tournament. That fallback must not become a
     * back door to the defaulted round — it is the same "nobody chose" case.
     */
    await createEvent(`${TAG} stale link`, "a-template-that-was-removed", "single");
    expect(await roundsOf("stale link")).toEqual([]);
  });

  it("still creates the rounds a TEMPLATE names", async () => {
    /**
     * THE ASSERTION THAT STOPS THIS BECOMING "NEVER CREATE A ROUND".
     *
     * Picking a template is choosing its rounds. A change that created nothing
     * for everybody would pass both tests above and quietly delete a real
     * feature — the one whose reason is written where the rounds are declared:
     * leaving them to be built by hand is the assembly work that keeps clubs
     * on what they know.
     */
    await createEvent(`${TAG} champs`, "club-championship", "single");
    const rounds = await roundsOf("champs");
    expect(rounds).toHaveLength(1);
    // The template's OWN choice, asserted by value — a round that came from
    // somewhere else would still be one round.
    expect(rounds[0]).toEqual({ type: "Round Robin", format: "Stroke Play" });
  });

  it("does not let the SHAPE decide either", async () => {
    /**
     * The shape's `openingRound` is what the removed fallback read. Every
     * shape declares one, so a tournament of any shape used to arrive with a
     * round — this asserts the shape no longer speaks for the organizer.
     */
    for (const shape of ["single", "series", "knockout"]) {
      await createEvent(`${TAG} ${shape}`, "custom", shape);
      expect(await roundsOf(shape), `${shape} shape`).toEqual([]);
    }
  });
});
