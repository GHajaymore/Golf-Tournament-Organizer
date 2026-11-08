import { prisma, makeClub, makeEvent, memberSession, returnCard, NAMES, type Club } from "./rounds-fixture";

/**
 * THE STATES THE SHARED FIXTURE DOES NOT HOLD (master backlog J52, 2026-11-06).
 *
 * `fixture.mjs` seeds one club (Verdigris), one tournament and one secretary, and every spec that
 * needs a different world builds its own throwaway club through `rounds-fixture.ts`. These are the
 * five worlds the backlog said nobody could walk, each built the same way, so the next spec that needs
 * one does not write it again:
 *
 *   themedClub          a club wearing a second theme, so a defect that depends on the accent shows
 *   twoRoundsCutAhead   two rounds, a cut into the second, round 1 played, the cut NOT yet made
 *   assistantFor        a signed-in assistant: staff of ONE tournament who is not the club's owner
 *   playedCup           a team cup played to completion: four singles, 3-1, status completed
 *   (flights: 3)        `makeEvent(..., { flights: 3 })`, already there; `threeFlights` names the shape
 *
 * Every row carries the caller's mark (`zz-…`), names are invented, addresses are `@example.invalid`,
 * and `dropClub(mark)` takes the lot (organizations cascade to their tournaments).
 */

/** The theme the shared fixture is not wearing. Verdigris is the default; this one is a different hue. */
export const SECOND_THEME = "claret";
export const DEFAULT_THEME_KEY = "verdigris";

/** A club on a named theme. A fresh club is on Verdigris, which is what hid accent-dependent faults. */
export async function themedClub(mark: string, themeKey: string = SECOND_THEME): Promise<Club> {
  const club = await makeClub(mark);
  await prisma.organization.update({ where: { id: club.orgId }, data: { themeKey } });
  return club;
}

/** Eight players: round 1 has every card in, round 2 is cut to the top `cutCount`, and no cut has been made. */
export async function twoRoundsCutAhead(club: Club, name = "Two Day Medal", cutCount = 5) {
  const made = await makeEvent(club, name, {
    status: "live",
    stages: [{ scoringBasis: "gross" }, { scoringBasis: "gross" }],
    players: 8,
  });
  const [r1, r2] = made.stages;
  await prisma.stage.update({
    where: { id: r2.id },
    data: { cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount },
  });
  for (const p of made.players) await returnCard(made.event.id, r1.id, p.id);
  return { ...made, round1: r1, round2: r2, cutCount };
}

/**
 * A signed-in ASSISTANT of one tournament: an Account with the assistant role at an address the
 * club's mark begins, and no seat in the club. `memberSession` makes the same thing with the player
 * role; this one is staff who may run the event and may not reshape it (`SCREEN_ACCESS` in `roles.ts`).
 */
export async function assistantFor(club: Club, eventId: string): Promise<{ userId: string; session: string; email: string }> {
  const email = `${club.mark}-assistant@example.invalid`;
  const made = await memberSession(eventId, email, "Ines Assistant");
  await prisma.account.updateMany({ where: { eventId, email }, data: { role: "assistant" } });
  return { ...made, email };
}

/** Two teams of four, four singles, Oakmere winning 3-1, the tournament completed. Returns the names to read back. */
export async function playedCup(club: Club, name = "Autumn Cup") {
  const event = await prisma.event.create({
    data: {
      organizationId: club.orgId, name: `${club.mark} ${name}`, status: "completed", format: "match", shape: "single",
      dates: "October 2026", course: `${club.mark} Hollins Moss`, city: "", address: "", regDeadline: "",
      shareToken: `${club.mark}-cup-${Date.now()}`, completedAt: new Date(),
    },
  });
  const oak = await prisma.group.create({ data: { eventId: event.id, name: "Oakmere", position: 0 } });
  const elm = await prisma.group.create({ data: { eventId: event.id, name: "Elmbridge", position: 1 } });
  const singles = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Team Session", format: "Match Play", holes: 18, description: "Singles", lineupPublished: true },
  });
  const carrier = await prisma.group.create({
    data: { eventId: event.id, stageId: singles.id, isCarrier: true, name: "Match Play — cup session", position: 10 },
  });
  /** Won 3&2 by the A side, or the B side: three holes up, thirteen halved, two never needed. */
  const card = (w: "A" | "B") => JSON.stringify([...Array(3).fill(w), ...Array(13).fill("H"), null, null]);
  const results: Array<"A" | "B"> = ["A", "A", "A", "B"];
  for (let i = 0; i < 4; i++) {
    const a = await prisma.player.create({
      data: { eventId: event.id, name: NAMES[i], email: `${club.mark}-cup-o${i}@example.invalid`, handicap: 10, seed: 2 * i + 1, status: "confirmed", groupId: oak.id },
    });
    const b = await prisma.player.create({
      data: { eventId: event.id, name: NAMES[i + 4], email: `${club.mark}-cup-e${i}@example.invalid`, handicap: 10, seed: 2 * i + 2, status: "confirmed", groupId: elm.id },
    });
    await prisma.match.create({
      data: { eventId: event.id, stageId: singles.id, groupId: carrier.id, round: i + 1, playerAId: a.id, playerBId: b.id, teamAId: "", teamBId: "", holes: card(results[i]), scoreStatus: "confirmed" },
    });
  }
  return { event, singles, winner: "Oakmere", loser: "Elmbridge", score: "3–1" };
}

/** The same field in three flights (3, 3 and 2 of eight), a Round Robin per flight to draw. */
export async function threeFlights(club: Club, name = "Winter Groups") {
  return makeEvent(club, name, {
    status: "live",
    stages: [
      { type: "Round Robin", format: "Match Play", scoringBasis: "net" },
      { type: "Round Robin", format: "Match Play", scoringBasis: "net" },
    ],
    players: 8,
    flights: 3,
  });
}
