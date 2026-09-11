import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * EVERY CLUB MEMBER IN A QUICK ROUND WAS RECORDED AS A GUEST.
 *
 * `createMatch` re-reads each claimed `memberId` rather than believing it, and
 * the reason is good: an id arrives from a form, and one belonging to another
 * club would otherwise attach a stranger's handicap and history to this round.
 *
 * It scoped that re-read to `organizationId` — the organization the round is
 * being created in. Once a quick round moved into the person's own
 * organization, that is an organization with no roster at all, so the query
 * matched nothing and every member came back a guest.
 *
 * The link is not decoration. `/match/new` offers the club's members with
 * their stored index precisely so nobody types one from memory — the commonest
 * way a net round is scored wrong, and wrong invisibly, because the card looks
 * right and the shots are in the wrong holes. `Player.memberId` is what makes
 * that handicap the club's own number rather than a copy that drifts from it.
 *
 * The fix is a WIDER scope, not no scope: the id is re-read against the clubs
 * this person actually belongs to. Both halves are asserted here, because a
 * fix to the first that loosened the second would be a takeover.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MEMBERLINK";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let session: { email: string; name: string; eventId: string; role: string } | null = null;

vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { createMatch } = await import("@/app/actions/match-setup");

let club: { id: string };
let otherClub: { id: string };
let ourMember: { id: string };
let strangerMember: { id: string };

async function scrub() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: TAG.toLowerCase() } },
    select: { id: true },
  });
  await prisma.organizationMember.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.event.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.member.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

/** The round this person just set up, with its players. */
async function roundPlayers(eventId: string) {
  return prisma.player.findMany({
    where: { eventId },
    select: { name: true, memberId: true, handicap: true },
    orderBy: { seed: "asc" },
  });
}

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: at("sec"), name: `${TAG} sec` } });
  club = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  await prisma.organizationMember.create({
    data: { organizationId: club.id, userId: user.id, role: "owner" },
  });
  ourMember = await prisma.member.create({
    data: { organizationId: club.id, name: `${TAG} Ours`, email: at("ours"), handicap: 12 },
  });

  // A club this person has nothing to do with.
  otherClub = await prisma.organization.create({ data: { name: `${TAG} other club`, kind: "club" } });
  strangerMember = await prisma.member.create({
    data: { organizationId: otherClub.id, name: `${TAG} Stranger`, email: at("stranger"), handicap: 3 },
  });

  session = { email: at("sec"), name: `${TAG} sec`, eventId: "", role: "admin" };
});

beforeEach(async () => {
  await prisma.event.deleteMany({ where: { organization: { kind: "personal", name: `${TAG} sec` } } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a club member picked from the roster", () => {
  it("keeps their member id on the round", async () => {
    // THE FAULT. Before this they came back with memberId null — a name with a
    // number beside it, cut loose from the club's own record of them.
    const res = await createMatch({
      format: "Stroke Play",
      players: [
        { name: `${TAG} sec`, handicap: "10", memberId: "" },
        { name: `${TAG} Ours`, handicap: "12", memberId: ourMember.id },
      ],
      holes: 18,
      useHandicaps: true,
    } as never);
    expect(res.ok, res.error).toBe(true);

    const players = await roundPlayers(res.eventId!);
    const ours = players.find((p) => p.name === `${TAG} Ours`);
    expect(ours?.memberId).toBe(ourMember.id);
  });

  it("still lands in the person's own organization, not the club", async () => {
    // The control on the control: reading the club's roster must not have
    // dragged the round back into the club.
    const res = await createMatch({
      format: "Stroke Play",
      players: [
        { name: `${TAG} sec`, handicap: "10", memberId: "" },
        { name: `${TAG} Ours`, handicap: "12", memberId: ourMember.id },
      ],
      holes: 18,
      useHandicaps: true,
    } as never);
    expect(res.ok, res.error).toBe(true);
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: res.eventId! },
      select: { organization: { select: { kind: true, id: true } } },
    });
    expect(event.organization.kind).toBe("personal");
    expect(event.organization.id).not.toBe(club.id);
  });
});

describe("an id belonging to a club this person is not in", () => {
  it("is refused the link and recorded as a guest", async () => {
    /**
     * The security half, and the reason this is a wider scope rather than no
     * scope. `memberId` arrives from a form. Believing it would attach a
     * stranger's handicap and history to somebody else's round.
     *
     * The failure direction is deliberate and unchanged: an unrecognised id
     * becomes a GUEST — which creates nothing and links nothing — rather than
     * a hard error on the first tee.
     */
    const res = await createMatch({
      format: "Stroke Play",
      players: [
        { name: `${TAG} sec`, handicap: "10", memberId: "" },
        { name: `${TAG} Stranger`, handicap: "3", memberId: strangerMember.id },
      ],
      holes: 18,
      useHandicaps: true,
    } as never);
    expect(res.ok, res.error).toBe(true);

    const players = await roundPlayers(res.eventId!);
    const stranger = players.find((p) => p.name === `${TAG} Stranger`);
    expect(stranger).toBeTruthy();
    expect(stranger?.memberId).toBeNull();
  });

  it("does not add the guest to anybody's roster", async () => {
    // A Sunday fourball must never put somebody's brother-in-law on a club's
    // member list — and a member matched BY NAME months later would overwrite
    // a real member's index, silently.
    const before = await prisma.member.count({
      where: { organization: { name: { startsWith: TAG } } },
    });
    const res = await createMatch({
      format: "Stroke Play",
      players: [
        { name: `${TAG} sec`, handicap: "10", memberId: "" },
        { name: `${TAG} Brother In Law`, handicap: "20", memberId: "" },
      ],
      holes: 18,
      useHandicaps: true,
    } as never);
    expect(res.ok, res.error).toBe(true);
    expect(
      await prisma.member.count({ where: { organization: { name: { startsWith: TAG } } } }),
    ).toBe(before);
  });
});
