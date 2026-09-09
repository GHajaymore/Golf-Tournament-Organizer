import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A casual round is never published by inheritance.
 *
 * `leaderboardVisibility: "public"` means, in the app's own words where it is
 * declared, "a read-only link anyone can open, no sign-in. Shows player names
 * and scores." A club choosing that for its tournaments is making a reasonable
 * decision about ITS competitions, where entrants signed up knowing there is a
 * leaderboard.
 *
 * A casual round's players did not sign up for anything. A guest is somebody's
 * mate, entered by a third party, who needs no account and is deliberately not
 * added to the roster — so publishing their name is a decision nobody made
 * about them, taken by inheritance from a setting they have never seen.
 *
 * DEMONSTRATED BEFORE IT WAS FIXED, on 2026-09-09: a casual round carrying
 * that visibility served both guests' names to an unauthenticated request,
 * with the round's title — which is built from those names — as the page
 * title. `noindex` keeps such a page out of search results and does nothing
 * whatever about the link.
 *
 * `createMatch` already pinned five settings for this same class of reasoning
 * — score entry, approval, attestation, attendance, money mode. This was the
 * only one left inherited, and the only one with a person on the other end.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NOT-PUBLIC";

let session: { email: string; name: string; eventId: string; role: string } | null = null;

vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { createMatch } = await import("@/app/actions/match-setup");

async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-audit-not-public" } } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  session = {
    email: "zz-audit-not-public@example.invalid",
    name: `${TAG} organizer`,
    eventId: "",
    role: "admin",
  };
});

afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

/**
 * Put the caller's own organization on the most permissive default there is.
 *
 * `organizationForNewEvent` creates a personal organization on first use, so
 * this runs one round to bring it into being, then sets the club default the
 * next round would inherit.
 */
async function orgOnPublicDefault() {
  const first = await createMatch({
    players: [{ name: `${TAG} seed one` }, { name: `${TAG} seed two` }],
    format: "Match Play",
  });
  expect(first.ok, first.error).toBe(true);
  const ev = await prisma.event.findUnique({
    where: { id: first.eventId! },
    select: { organizationId: true },
  });
  await prisma.organization.update({
    where: { id: ev!.organizationId },
    data: { defaultLeaderboardVisibility: "public" },
  });
  return ev!.organizationId;
}

describe("a casual round created inside a club that publishes everything", () => {
  it("is not public", async () => {
    const organizationId = await orgOnPublicDefault();

    // The club's default really is the permissive one — otherwise this test
    // asserts nothing, which is exactly the shape a fixture fails in.
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { defaultLeaderboardVisibility: true },
    });
    expect(org?.defaultLeaderboardVisibility, "the fixture's whole premise").toBe("public");

    const made = await createMatch({
      players: [{ name: `${TAG} guest one` }, { name: `${TAG} guest two` }],
      format: "Match Play",
    });
    expect(made.ok, made.error).toBe(true);

    const round = await prisma.event.findUnique({
      where: { id: made.eventId! },
      select: { leaderboardVisibility: true, shape: true },
    });
    expect(round?.shape).toBe("match");
    expect(round?.leaderboardVisibility, "never published by inheritance").toBe("participants");
    expect(round?.leaderboardVisibility).not.toBe("public");
  });

  it("still inherits the club's other house defaults", async () => {
    /**
     * THE ASSERTION THAT STOPS THIS BECOMING "IGNORE THE CLUB".
     *
     * `settingsForNewEvent` is spread first and five settings are pinned over
     * it on purpose. Everything NOT pinned must still come from the club — a
     * change that stopped reading the club at all would pass the test above
     * and quietly take a real feature away.
     *
     * `voiceEntry` is one of the settings that is genuinely inherited, so it
     * is the one to watch.
     */
    const organizationId = await orgOnPublicDefault();
    await prisma.organization.update({
      where: { id: organizationId },
      data: { defaultVoiceEntry: false },
    });

    const made = await createMatch({
      players: [{ name: `${TAG} v one` }, { name: `${TAG} v two` }],
      format: "Match Play",
    });
    const round = await prisma.event.findUnique({
      where: { id: made.eventId! },
      select: { voiceEntry: true, leaderboardVisibility: true },
    });

    expect(round?.voiceEntry, "an unpinned setting still follows the club").toBe(false);
    expect(round?.leaderboardVisibility, "a pinned one does not").toBe("participants");
  });
});
