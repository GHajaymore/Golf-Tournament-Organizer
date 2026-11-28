import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * EVERY PLAYER'S WRITE OF A MATCH OR ITS CARDS ASKS THE ONE SINK (B128, 27 Nov 2026).
 *
 * A closed round refused three callers and took every other player write of a match, because the close was added where
 * three screens were and not where every writer asks. `every-action-says-who-may-call-it.test.ts` holds WHO may call
 * an action, never WHEN. This holds the when: each exported action in `actions/play.ts` and `actions/tournament.ts`
 * that writes `match`, `matchScorecard` or `teamScorecard` either
 *
 *   - reaches the sink (`mayWriteMatch`, or `assertOwnMatch`, which asks it; or `roundClosedRefusal` for a card that has
 *     no match), where a CLOSED round and a SIGNED-OFF result are refused once, for all of them; or
 *   - is staff-only, by its own gate (`requireAdmin`, `requireStaff`, or a role check before the write); or
 *   - is named in `NOT_A_RESULT_WRITE` with the reason: a signature or a dispute is not a result.
 *
 * So a new match writer that skips the sink is red the day it lands. The sink itself must still hold the close and the
 * sign-off (the last block), because a writer that asks a sink with nothing in it is no better than one that skips it.
 */

const ASKS_THE_SINK = /\b(?:mayWriteMatch|assertOwnMatch|roundClosedRefusal)\s*\(/;
// Any client name: `prisma`, a transaction's `tx`, `db`, a callback's `t` ... a writer inside `$transaction` is a writer.
const WRITES = /\b[A-Za-z_$][\w$]*\.(?:match|matchScorecard|teamScorecard)\.(?:update|updateMany|upsert|create|createMany|delete|deleteMany)\b/;
// A CALL to a staff gate, never a role comparison: `applyMatchResult` compares roles to let staff skip ONE check and is a
// player's door, so a comparison would excuse the very action this sweep is for (found by the mutation below).
const STAFF_ONLY = /\b(?:requireAdmin|requireStaff|requireAdminEvent|requireStaffEvent)\s*\(/;

/** Actions that write a match row without writing a RESULT, each with why. */
const NOT_A_RESULT_WRITE: Record<string, string> = {
  confirmPlayMatch: "a signature on a result that exists, not a result (attestation.audit.test.ts)",
  disputePlayMatch: "a dispute of a result that exists; the committee settles it",
  confirmMatches: "the committee's bulk sign-off; an organizer-only role check before the write",
  confirmMatch: "the committee's sign-off or a player's countersignature, keyed to the scoreline it saw",
  disputeMatch: "a dispute of a result that exists; the committee settles it",
};

/** The exported async functions of a source, name -> body. */
function actionsOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = source.replace(/\r\n/g, "\n").split(/\nexport async function /);
  for (const part of parts.slice(1)) {
    out.set(part.slice(0, part.indexOf("(")), part.split(/\n\}\n/)[0]);
  }
  return out;
}

/** The writers that neither ask the sink, nor are staff-only, nor are named as no result write. */
export function writersThatSkipTheSink(source: string, exempt: Record<string, string> = NOT_A_RESULT_WRITE): string[] {
  return [...actionsOf(source)]
    .filter(([name, body]) => WRITES.test(body) && !ASKS_THE_SINK.test(body) && !STAFF_ONLY.test(body) && !(name in exempt))
    .map(([name]) => name);
}

describe("every action that writes a match or its cards", () => {
  for (const file of ["src/app/actions/play.ts", "src/app/actions/tournament.ts"]) {
    it(`${file}: asks the sink, is staff-only, or is named as no result write`, () => {
      expect(writersThatSkipTheSink(readSource(file))).toEqual([]);
    });
  }

  it("CONTROL: a new match writer that skips the sink is caught, and one that asks it is not", () => {
    const skips = `
export async function keepMyWholeMatchAgain(matchId: string) {
  await prisma.match.update({ where: { id: matchId }, data: { holes: "[]" } });
}
`;
    expect(writersThatSkipTheSink(skips)).toEqual(["keepMyWholeMatchAgain"]);
    const asks = `
export async function keepMyWholeMatchAgain(matchId: string) {
  await assertOwnMatch(session, eventId, matchId);
  await prisma.match.update({ where: { id: matchId }, data: { holes: "[]" } });
}
`;
    expect(writersThatSkipTheSink(asks)).toEqual([]);
    const staff = `
export async function keepMyWholeMatchAgain(matchId: string) {
  await requireAdmin();
  await prisma.match.update({ where: { id: matchId }, data: { holes: "[]" } });
}
`;
    expect(writersThatSkipTheSink(staff)).toEqual([]);
  });

  it("CONTROL: a writer inside a transaction (tx.match.update, tx.match.upsert) that skips the sink is caught", () => {
    for (const call of ["update", "upsert", "updateMany"]) {
      const skipsInTx = `
export async function keepMyMatchInATransaction(matchId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.match.${call}({ where: { id: matchId }, data: { holes: "[]" } });
  });
}
`;
      expect(writersThatSkipTheSink(skipsInTx), call).toEqual(["keepMyMatchInATransaction"]);
      const asksInTx = skipsInTx.replace("await prisma.$transaction", "await mayWriteMatch({});\n  await prisma.$transaction");
      expect(writersThatSkipTheSink(asksInTx), call).toEqual([]);
    }
    const cards = `
export async function saveCardsInTx() {
  await db.$transaction(async (t) => { await t.teamScorecard.create({ data: {} }); });
}
`;
    expect(writersThatSkipTheSink(cards)).toEqual(["saveCardsInTx"]);
  });

  it("CONTROL: the sweep reads the real files (it finds the writers it is meant to hold)", () => {
    const play = [...actionsOf(readSource("src/app/actions/play.ts"))].filter(([, b]) => WRITES.test(b)).map(([n]) => n);
    expect(play).toEqual(expect.arrayContaining(["savePlayMatchHoles", "savePlayMatchResult", "savePlayMatchCard"]));
    const tour = [...actionsOf(readSource("src/app/actions/tournament.ts"))].filter(([, b]) => WRITES.test(b)).map(([n]) => n);
    expect(tour).toEqual(expect.arrayContaining(["saveMatchHoles", "applyMatchResult", "clearMatch", "saveMatchScorecard", "saveTeamScorecard"]));
  });
});

describe("the sink holds the close and the sign-off", () => {
  const sink = readSource("src/lib/services/match-membership.ts");
  const body = sink.slice(sink.indexOf("export async function mayWriteMatch("), sink.indexOf("async function mayWriteMatchWho("));

  it("mayWriteMatch asks whether the round is closed, in the one sentence (roundClosedRefusal), before it says yes", () => {
    expect(body).toMatch(/roundClosedRefusal\(/);
    expect(body.indexOf("roundClosedRefusal(")).toBeGreaterThan(body.indexOf("mayWriteMatchWho("));
  });

  it("mayWriteMatch refuses a confirmed result, read fresh from the row", () => {
    expect(body).toMatch(/scoreStatus\s*===\s*"confirmed"/);
    expect(body).toMatch(/SIGNED_OFF_MATCH_REFUSAL/);
  });

  it("assertRoundOpen and the sink share ONE sentence (no second copy)", () => {
    const write = readSource("src/lib/services/scorecard-write.ts");
    expect(write.match(/no more scores can be entered for it/g)?.length).toBe(1);
  });
});
