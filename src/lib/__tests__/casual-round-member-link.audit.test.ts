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

/**
 * ONE PHONE DOING FOUR CARDS.
 *
 * `playerAccess` was the one setting `createMatch` left to resolve, and for a
 * casual round it fell to the app default: `email`. So the only way to a card
 * was an account — and a guest is by definition somebody without one, often
 * without an address at all. A fourball had exactly one route to four cards:
 * the phone belonging to whoever set the round up.
 *
 * The product's own front page contradicts it, offering "Playing today? Enter
 * your round code" to a golfer whose round has no code.
 *
 * What a code grants is stated rather than implied: the PLAY shell, as a
 * player of this round, picked from the list. Never staff, never the console.
 * It is exactly as strong as handing somebody your phone — which is what it
 * replaces — and it dies with the round a day later.
 */
describe("a quick round's players getting to their own cards", () => {
  const roundOf = async (eventId: string) =>
    prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { playerAccess: true, stages: { select: { accessCode: true } } },
    });

  it("accepts a round code as well as an address", async () => {
    const res = await createMatch({
      format: "Stroke Play",
      players: [
        { name: `${TAG} sec`, handicap: "10", memberId: "" },
        { name: `${TAG} Mate`, handicap: "18", memberId: "" },
      ],
      holes: 18,
      useHandicaps: true,
    } as never);
    expect(res.ok, res.error).toBe(true);

    const round = await roundOf(res.eventId!);
    // "both", not "code": whoever set it up signs in with their address and
    // everyone else uses the code.
    expect(round.playerAccess).toBe("both");
  });

  it("issues the code with the round, not later", async () => {
    /**
     * A tournament issues codes when an organizer turns code access on, from
     * Play settings — a screen a casual round deliberately does not have. So
     * without this the setting would say codes are accepted and every code
     * anyone tried would be wrong.
     */
    const res = await createMatch({
      format: "Stroke Play",
      players: [
        { name: `${TAG} sec`, handicap: "10", memberId: "" },
        { name: `${TAG} Mate`, handicap: "18", memberId: "" },
      ],
      holes: 18,
      useHandicaps: true,
    } as never);
    expect(res.ok, res.error).toBe(true);

    const round = await roundOf(res.eventId!);
    expect(round.stages).toHaveLength(1);
    expect(round.stages[0].accessCode).toMatch(/^[A-Z0-9]{6,10}$/);
  });

  it("gives two rounds two different codes", async () => {
    // Redemption looks a code up on its own, with no event to narrow by, so a
    // repeat would send one round's players into another's.
    const mk = async (who: string) =>
      createMatch({
        format: "Stroke Play",
        players: [
          { name: `${TAG} sec`, handicap: "10", memberId: "" },
          { name: `${TAG} ${who}`, handicap: "18", memberId: "" },
        ],
        holes: 18,
        useHandicaps: true,
      } as never);

    const a = await mk("One");
    const b = await mk("Two");
    expect(a.ok && b.ok).toBe(true);
    const [ra, rb] = [await roundOf(a.eventId!), await roundOf(b.eventId!)];
    expect(ra.stages[0].accessCode).not.toBe(rb.stages[0].accessCode);
    expect(ra.stages[0].accessCode).toBeTruthy();
  });

  it("checks a new code against EVERY tournament, not just this one", async () => {
    /**
     * Read from source, and the reason is worth stating because a
     * source-reading assertion is usually the weaker choice.
     *
     * The collision retry cannot be exercised through `createMatch`: two
     * random eight-character codes from a twenty-seven character alphabet
     * effectively never collide, so deleting the check entirely leaves every
     * behavioural test green — confirmed by mutation. Writing a test that
     * "covers" it would be decoration.
     *
     * What CAN be got wrong, and silently, is the scope of the check. A code
     * is looked up at redemption on its own, with no event to narrow by, so a
     * uniqueness check scoped to one event would let two rounds share a code
     * and send one round's players into another's. That is the property, so
     * that is what is pinned.
     */
    const { readSource } = await import("./source");
    const src = readSource("src/app/actions/match-setup.ts");
    expect(src).toMatch(/prisma\.stage\.count\(\{ where: \{ accessCode: code \} \}\)/);
    // No eventId anywhere in that condition — the whole point.
    const check = src.slice(src.indexOf("prisma.stage.count"));
    expect(check.slice(0, 120)).not.toMatch(/eventId/);
  });

  it("does not make the round public in the bargain", async () => {
    /**
     * The line between "your mates can score" and "anyone can read it". A code
     * is given to the people playing; `leaderboardVisibility` decides whether a
     * link works for everybody else, and a casual round pins it to
     * "participants" for reasons that have their own audit test.
     */
    const res = await createMatch({
      format: "Stroke Play",
      players: [
        { name: `${TAG} sec`, handicap: "10", memberId: "" },
        { name: `${TAG} Mate`, handicap: "18", memberId: "" },
      ],
      holes: 18,
      useHandicaps: true,
    } as never);
    expect(res.ok, res.error).toBe(true);
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: res.eventId! },
      select: { leaderboardVisibility: true },
    });
    expect(event.leaderboardVisibility).toBe("participants");
  });
});
