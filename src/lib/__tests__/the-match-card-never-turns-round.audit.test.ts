import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { generateAccessCode } from "../codes";
import { clearRateLimit } from "../rate-limit";

/**
 * THE CUP'S WRONG CARD, AS IT HAPPENED (18 Oct), DRIVEN THROUGH THE ROUND CODE.
 *
 * At a real team cup, scorers scanned the QR on the cart sign, which opens
 * `/play` with the round code. Two of them tapped a name from the OPPOSING
 * pair. The card made the tapped name's side "side A" and turned the match
 * round to face it (`flipped`), so the scorer's own pair sat where the other
 * pair's button had been. They pressed what they took to be their own side's
 * button, and the board took every hole they won as a win for the other side.
 *
 * So the holder here is on side B, the match is a cup four-ball, and the page
 * is the real one (`/play`, rendered from the rows, signed in the way a code
 * holder is): the answers for hole 1 must read side A's team, Halved, side B's
 * team — in draw order, the same whoever holds the phone — and the one named
 * for side B must record "B". Before 2026-11-04 the B holder's card read side
 * B first and named the pairs by first name.
 *
 * Then the new front of the flow: the round lists the match as a GROUP, with
 * its tee time once the tee sheet is published, and with no script the server
 * draws the one confirmation before it starts anything.
 *
 * Invented names, `@example.invalid`, all rows under one mark and deleted after.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
// `/play` mounts the suspension siren (a client component asking `useRouter`), and this renders the page
// outside the app router: the same stand-in `the-scorer-keeps-every-ball.audit.test.ts` uses.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import { claimPlayerSlot, claimPlayerSlotForm, redeemRoundCode, savePlayMatchHoles } from "@/app/actions/play";
import { getPlaySession } from "@/lib/play-auth";
import { resolveMatch } from "@/lib/domain/match";
import { keepingSentence } from "@/lib/domain/play-groups";
import PlayPage from "@/app/play/page";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NEVER-TURNS";
const CODE = generateAccessCode();
const BLUES = "Zz Blues";
const WHITES = "Zz Whites";

let eventId = "";
let stageId = "";
let matchId = "";
const p: Record<string, string> = {};

async function cleanup() {
  await clearRateLimit("round-code", CODE);
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "society" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} cup`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      status: "live",
      shareToken: `${TAG}-${Date.now()}`,
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      playerAccess: "code",
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Team Session",
      format: "Four-Ball",
      holes: 18,
      scoringBasis: "gross",
      lineupPublished: true,
      matchKeptBy: "holes",
      accessCode: CODE,
    },
  });
  stageId = stage.id;
  const blues = await prisma.group.create({ data: { eventId, name: BLUES, position: 0 } });
  const whites = await prisma.group.create({ data: { eventId, name: WHITES, position: 1 } });
  let seed = 0;
  for (const [who, name, team] of [
    ["a1", "Zz Ann Ash", blues.id],
    ["a2", "Zz Bea Birch", blues.id],
    ["b1", "Zz Cal Cedar", whites.id],
    ["b2", "Zz Dot Dale", whites.id],
  ] as const) {
    const row = await prisma.player.create({
      data: { eventId, name, email: `${TAG}.${who}@example.invalid`.toLowerCase(), seed: ++seed, status: "confirmed", handicap: 0, groupId: team },
    });
    p[who] = row.id;
  }
  // The pairs as a cup's lineup files them: a side each, drawn A then B.
  const pair = async (name: string, ids: string[]) => {
    const team = await prisma.team.create({ data: { eventId, stageId, name } });
    for (const [position, playerId] of ids.entries()) await prisma.teamMember.create({ data: { teamId: team.id, playerId, position } });
    return team.id;
  };
  const teamA = await pair("Zz Ann Ash & Zz Bea Birch", [p.a1, p.a2]);
  const teamB = await pair("Zz Cal Cedar & Zz Dot Dale", [p.b1, p.b2]);
  matchId = (
    await prisma.match.create({
      data: { eventId, stageId, groupId: blues.id, round: 1, playerAId: "", playerBId: "", teamAId: teamA, teamBId: teamB, holes: JSON.stringify(new Array(18).fill(null)) },
    })
  ).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** The `/play` page as the code holder signed in as `who` is drawn it. */
async function playPageAs(who: string): Promise<string> {
  jar.clear();
  expect(await claimPlayerSlot(CODE, p[who])).toEqual({ ok: true });
  expect((await getPlaySession())?.playerId, "the session is not the holder's").toBe(p[who]);
  return renderToStaticMarkup(await PlayPage({ searchParams: Promise.resolve({}) }));
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

/** Hole 1's answers, in the order the card draws them: what each says, and what pressing it records. */
function holeOneAnswers(html: string): Array<{ says: string; records: string }> {
  const at = html.indexOf('aria-label="Who won hole 1"');
  expect(at, "the page drew no hole card at all").toBeGreaterThan(-1);
  const found = [...html.slice(at).matchAll(/<button[^>]*class="is-([ahb])"[^>]*>([^<]*)/g)].slice(0, 3);
  // The class is the answer the card hands `onPick` — the two are one entry of one list in `HoleResultCard`.
  return found.map((m) => ({ says: decode(m[2]).trim(), records: m[1].toUpperCase() }));
}

describe("a cup four-ball kept by somebody on side B", () => {
  it("draws side A first, by team, and the button for side B records B — the cup's bug", async () => {
    const answers = holeOneAnswers(await playPageAs("b2"));
    // Draw order, whoever holds the phone. The B holder's card used to read their own pair first.
    expect(answers.map((a) => a.says)).toEqual([`${BLUES} won`, "Halved", `${WHITES} won`]);
    const theirs = answers.find((a) => a.says === `${WHITES} won`);
    expect(theirs?.records, "the button naming side B gives the hole to somebody else").toBe("B");

    // The press, saved as the holder's phone saves it, and read back from the row.
    const holes = new Array(18).fill(null) as Array<"A" | "B" | "H" | null>;
    holes[0] = theirs!.records as "B";
    const saved = await savePlayMatchHoles(matchId, holes);
    expect(saved.ok, saved.error).toBe(true);
    const row = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { holes: true } });
    const stored = JSON.parse(row.holes) as Array<string | null>;
    expect(stored[0]).toBe("B");
    // And the board's reader credits side B with the hole: one down for A is one up for B.
    expect(resolveMatch(stored as Array<"A" | "B" | "H" | null>)).toMatchObject({ holesWonA: 0, holesWonB: 1, lead: -1 });
  });

  it("is the same card for side A's holder — nothing on it depends on whose name opened it", async () => {
    // Back to an empty card, so both open on hole 1.
    await prisma.match.update({ where: { id: matchId }, data: { holes: JSON.stringify(new Array(18).fill(null)) } });
    const fromB = holeOneAnswers(await playPageAs("b1"));
    const fromA = holeOneAnswers(await playPageAs("a1"));
    expect(fromA).toEqual(fromB);
  });
});

describe("the round lists the match as a group, and the phone confirms it once", () => {
  it("shows the match as one group, both sides named, side A first", async () => {
    const res = await redeemRoundCode(CODE);
    expect(res.ok).toBe(true);
    expect(res.groups).toEqual([
      {
        key: `match:${matchId}`,
        title: "Match 1",
        names: "Zz Ann Ash & Zz Bea Birch v Zz Cal Cedar & Zz Dot Dale",
        tee: "",
        players: [p.a1, p.a2, p.b1, p.b2].map((id) => ({ id, name: expect.any(String) })),
        oneMatch: true,
      },
    ]);
  });

  it("takes the tee time and starting hole off a published tee sheet, and says it back in full", async () => {
    await prisma.stage.update({
      where: { id: stageId },
      data: {
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date(0).toISOString(),
          startType: "split",
          groups: [{ name: "Group 3", startHole: 10, time: "12:54", playerIds: [p.b1, p.a1, p.b2, p.a2] }],
        }),
      },
    });
    const group = (await redeemRoundCode(CODE)).groups?.[0];
    expect(group?.tee).toBe("12:54 off the 10th");
    expect(keepingSentence({ kind: "group", group: group! })).toBe(
      "You're keeping Group 3: Zz Ann Ash & Zz Bea Birch v Zz Cal Cedar & Zz Dot Dale · 12:54 off the 10th",
    );
  });

  it("with no script, asks before it starts anything, then opens the match", async () => {
    jar.clear();
    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };
    const asked = await claimPlayerSlotForm(null, form({ code: CODE, group: `match:${matchId}` }));
    expect(asked.step?.kind).toBe("confirm");
    expect(await getPlaySession(), "a tap that has not been confirmed started a session").toBeNull();
    // Yes: the session starts and the page redirects to the card (`redirect` throws to do it).
    await expect(claimPlayerSlotForm(null, form({ code: CODE, group: `match:${matchId}`, confirmed: "yes" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect((await getPlaySession())?.playerId).toBe(p.a1);
  });
});
