import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A MATCH THAT WAS NOT PLAYED OUT CAN BE RECORDED AS SUCH.
 *
 * A concession, a walkover and a withdrawal (Rule 3.2b(1)) are three ordinary
 * ways a match ends without a card, and the app could record none of them:
 * `forfeitMatch` was written, authorized, scoped and audited, and nothing
 * under `src/components` contained the word forfeit. Found by the
 * reachability sweep on 2026-09-13.
 *
 * What an organizer had to do instead was invent a scoreline — which is
 * exactly what `Match.forfeitedBy`'s own schema comment says the column was
 * added to end: "A conceded match had to be entered as a fabricated scoreline
 * or left Live forever." A fabricated 5&4 puts holes on the leaderboard that
 * nobody played, and they feed the tiebreakers.
 *
 * These assert the RULE — the concession settles the match in the other
 * player's favour, invents no holes, and can be taken back.
 *
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { forfeitMatch } from "@/app/actions/tournament";
import { loadEventState } from "@/lib/services/tournament";
import type { HoleResult } from "@/lib/domain/types";
import { readSource } from "./source";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CONCEDE";

let eventId = "";
let matchId = "";
const players: Array<{ id: string; name: string }> = [];

async function storedMatch() {
  return prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    select: { holes: true, forfeitedBy: true, scoreStatus: true, scoredAt: true },
  });
}

/**
 * What the STANDINGS make of it, which is the only thing that matters.
 *
 * A forfeit is deliberately NOT resolved by `resolveMatch` — that reads the
 * card, and the point of a concession is that the card does not decide it.
 * `standings` applies `forfeitWinnerSide` first and discards the holes,
 * "because crediting a conceder the three holes he was up would flatter him in
 * hole differential, which is what the flight is ranked on".
 *
 * The first draft of this file asserted through `resolveMatch` with an options
 * argument it does not take. It was silently ignored, and the assertion was
 * about nothing.
 */
async function record(playerId: string) {
  const state = (await loadEventState(eventId))!;
  const found = state.overall.find((r) => r.player.id === playerId);
  return found ? { wins: found.stats.wins, losses: found.stats.losses, played: found.stats.played } : null;
}

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} outing`,
      organizationId: org.id,
      format: "match",
      status: "active",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
    },
    select: { id: true },
  });
  eventId = ev.id;

  const group = await prisma.group.create({ data: { eventId, name: `${TAG} g`, position: 0 }, select: { id: true } });
  for (let i = 0; i < 2; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId,
          groupId: group.id,
          name: `${TAG} P${i + 1}`,
          email: `${TAG.toLowerCase()}-p${i + 1}@example.invalid`,
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
        select: { id: true, name: true },
      }),
    );
  }
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 },
    select: { id: true },
  });
  const match = await prisma.match.create({
    data: {
      eventId,
      stageId: stage.id,
      groupId: group.id,
      round: 1,
      playerAId: players[0].id,
      playerBId: players[1].id,
      // Nothing played. A walkover is the commonest case and has no holes.
      holes: JSON.stringify(new Array(18).fill(null)),
    },
    select: { id: true },
  });
  matchId = match.id;

  const user = await prisma.user.create({
    data: { email: `${TAG.toLowerCase()}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable" },
    select: { id: true },
  });
  await prisma.account.create({
    data: { eventId, name: `${TAG} Admin`, email: `${TAG.toLowerCase()}-admin@example.invalid`, role: "admin" },
  });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.$disconnect();
});

describe("recording that a match was not played out", () => {
  it("is unsettled until somebody says so", async () => {
    // The control: an empty card decides nothing, so anything the assertions
    // below see is the concession's doing and not the fixture's.
    expect((await storedMatch()).forfeitedBy).toBe("");
    expect((await record(players[0].id))?.played, "the empty card counted as played").toBe(0);
  });

  it("settles it in the other player's favour", async () => {
    const conceder = players[0];
    const res = await forfeitMatch(matchId, conceder.id);
    expect(res.ok, res.error).toBe(true);

    const conceded = await record(conceder.id);
    const other = await record(players[1].id);
    expect(conceded, "the conceder has no record row").not.toBeNull();
    expect(conceded!.losses, "the conceder was not given the loss").toBe(1);
    expect(other!.wins, "the other player was not given the win").toBe(1);
    // And both count as having met, which is what decides a round robin.
    expect(conceded!.played).toBe(1);
    expect(other!.played).toBe(1);
  });

  it("invents no holes to make it look played", async () => {
    /**
     * THE WHOLE POINT, and what the workaround could not avoid. A fabricated
     * 5&4 puts five holes on the board that nobody played — and those holes
     * feed the holes-won tiebreaker, so the fiction reaches the standings.
     */
    const m = await storedMatch();
    const holes = JSON.parse(m.holes) as HoleResult[];
    expect(holes.filter(Boolean), "holes were written for a match nobody played").toEqual([]);
  });

  it("is a result, so it is dated and goes for review like any other", async () => {
    const m = await storedMatch();
    expect(m.scoredAt).not.toBeNull();
    expect(m.scoreStatus).toBe("pending");
  });

  it("can be taken back", async () => {
    /**
     * The direction that decides whether this is a control or a trapdoor. A
     * concession recorded against the wrong name is the likeliest mistake on
     * this screen — the two buttons differ only by which player they name.
     */
    const res = await forfeitMatch(matchId, "");
    expect(res.ok, res.error).toBe(true);

    const m = await storedMatch();
    expect(m.forfeitedBy).toBe("");
    expect((await record(players[0].id))?.played, "undoing left the match counted").toBe(0);
    expect((await record(players[1].id))?.wins).toBe(0);
  });

  it("refuses a name that is not in the match", async () => {
    // An unchecked id here would decide a match in favour of somebody who
    // never played in it. The action says so; this pins that it still does.
    const stranger = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} outsider`,
        email: `${TAG.toLowerCase()}-out@example.invalid`,
        seed: 99,
        status: "confirmed",
        handicap: 0,
      },
      select: { id: true },
    });
    const res = await forfeitMatch(matchId, stranger.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/isn't in this match/i);
    expect((await storedMatch()).forfeitedBy).toBe("");
  });
});

describe("the screen offers it", () => {
  /**
   * The half the database cannot see, and the half that was missing for the
   * whole life of the action. Read through `readSource`, which strips
   * comments: the notes explaining this change name `forfeitMatch` several
   * times and would otherwise satisfy every assertion here on their own.
   */
  const client = () => readSource("src", "components", "ScoreEntryClient.tsx");

  it("calls the action", () => {
    expect(client(), "no screen reaches forfeitMatch").toContain("forfeitMatch(");
  });

  it("names the side rather than offering a bare 'forfeit'", () => {
    /**
     * The likeliest mistake on this screen is recording the concession against
     * the wrong player, so each button says whose it is and confirms before
     * writing. A single "Forfeit" button with a dropdown would be one slip.
     */
    const src = client();
    expect(src).toContain("concedes");
    expect(src).toContain("doForfeit(side.id)");
    expect(src, "the concession is written without a confirmation step").toContain("confirmLabel=\"Record it\"");
  });

  it("offers the undo too, and only once there is one", () => {
    const src = client();
    expect(src).toContain('doForfeit("")');
    expect(src).toContain("active.forfeitedBy &&");
  });

  it("is organizer-only, matching the action", () => {
    // `forfeitMatch` calls `requireAdminEvent`, so showing it to an assistant
    // would hand them a button that only ever errors.
    const src = client();
    const block = src.slice(src.indexOf("Not played out") - 400, src.indexOf("Not played out"));
    expect(block).toContain("isAdmin");
  });

  it("stops printing holes-won for a match nobody played", () => {
    // "Holes won — A 0 · B 0" under a concession is a statistic about a thing
    // that did not happen.
    expect(client()).toContain("Conceded by");
  });
});
