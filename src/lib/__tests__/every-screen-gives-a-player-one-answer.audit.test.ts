import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The public board is `unstable_cache`d, which throws outside a Next request;
// the identity runs the real builder, which is the code every reader reads.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));
import { loadEventState, standingRows, withBoardRound } from "@/lib/services/tournament";
import { liveBoard } from "@/lib/services/live-board";
import { meFor } from "@/lib/services/me";
import { eventReport } from "@/lib/services/event-report";
import { moneyFor } from "@/lib/services/expenses";
import { seedReport, teardownReport } from "../../../e2e/report-fixture.mjs";

/**
 * EVERY SCREEN GIVES A PLAYER ONE ANSWER (foundation pass, layer 9, 2026-10-23).
 *
 * Two screens answering one question with different numbers is the class no
 * screen test can see: each is right on its own terms. `e2e/the-boards-agree.spec.ts`
 * holds the secretary's board and the public link together in a browser; this
 * holds every reader of a player's PLACE and MONEY together at the data level,
 * on a real two-round medal with money in it (`e2e/report-fixture.mjs`, worked
 * by hand in its header), with a round picked and at the end:
 *
 *   the place     the secretary's board (`standingRows` of the event state),
 *                 the public link (`liveBoard`), the player's own Today
 *                 (`meFor`), and the tournament report, the organizer's copy
 *                 and the public one
 *   the money     the player's own Money screen (`netCents`), the standing
 *                 everybody is shown, and the settle-up's handovers
 *
 * They agree by construction today, and that is the reason to pin them: a
 * reader that grows its own sort, or its own idea of a tie, is caught here the
 * day it does. The places are pinned to the Rules as well — the fixture's
 * order worked by hand — so the readers cannot agree on something wrong.
 *
 *   npx vitest run --config vitest.audit.config.ts every-screen-gives-a-player-one-answer
 */

const MARK = "zz-audit-one-answer";
type Seeded = {
  eventId: string;
  stageIds: string[];
  players: Record<string, { id: string; name: string; email: string }>;
  organizerEmail: string;
};
let seeded: Seeded;

beforeAll(async () => {
  seeded = (await seedReport(MARK)) as Seeded;
});
afterAll(async () => {
  await teardownReport(MARK);
});

/** "T2" when two or more share the place, "2" alone, "" for no place — read off a reader's own rows. */
function placeOf(rows: ReadonlyArray<{ id: string; rank: number; ranked?: boolean }>, id: string): string {
  const me = rows.find((r) => r.id === id);
  if (!me || me.rank <= 0 || me.ranked === false) return "";
  const shared = rows.filter((r) => r.rank === me.rank && r.ranked !== false).length > 1;
  return `${shared ? "T" : ""}${me.rank}`;
}

/**
 * Each screen as the screen builds it: the console's board is
 * `withBoardRound(loadEventState(event), ?round)` then `standingRows`, the
 * public link `liveBoard(event, ?round)`, and Today `meFor` on the event's own
 * state (it has no round picker).
 */
async function placesBy(stageId: string | undefined) {
  const loaded = (await loadEventState(seeded.eventId))!;
  const state = withBoardRound(loaded, stageId);
  const board = (await liveBoard(seeded.eventId, stageId ?? ""))!;
  const secretary = standingRows(state);
  const out: Record<string, Record<string, string>> = {};
  for (const [key, p] of Object.entries(seeded.players)) {
    out[key] = {
      secretary: placeOf(secretary, p.id),
      publicLink: placeOf(board.rows, p.id),
    };
    if (!stageId) out[key].today = (await meFor(loaded, p.email)).standing?.position ?? "";
  }
  return out;
}

describe("a player's place is the same on every screen", () => {
  it("with Round 1 picked — the secretary's board and the public link", async () => {
    const places = await placesBy(seeded.stageIds[0]);
    for (const [who, by] of Object.entries(places)) {
      expect(new Set(Object.values(by)), `${who}: ${JSON.stringify(by)}`).toEqual(new Set([by.secretary]));
    }
    // The totals table both boards lead with, whichever round is picked (the
    // round's own table sits under it): Bob, Cat, Ann, Dan on 36 holes.
    expect(Object.fromEntries(Object.entries(places).map(([k, v]) => [k, v.secretary]))).toEqual({ Bob: "1", Cat: "2", Ann: "3", Dan: "4" });
  });

  it("at the end — and the report, both copies, says the same", async () => {
    const places = await placesBy(undefined);
    const staff = (await eventReport(seeded.eventId, { kind: "staff", email: seeded.organizerEmail }))!;
    const pub = (await eventReport(seeded.eventId, { kind: "public" }))!;
    for (const [who, p] of Object.entries(seeded.players)) {
      const by: Record<string, string> = {
        ...places[who],
        reportStaff: staff.rows.find((r) => r.name === p.name)?.place ?? "",
        reportPublic: pub.rows.find((r) => r.name === p.name)?.place ?? "",
      };
      expect(new Set(Object.values(by)), `${who}: ${JSON.stringify(by)}`).toEqual(new Set([by.secretary]));
    }
    // Worked by hand: Bob 141, Cat 144, Ann 145, Dan 146.
    expect(Object.fromEntries(Object.entries(places).map(([k, v]) => [k, v.secretary]))).toEqual({ Bob: "1", Cat: "2", Ann: "3", Dan: "4" });
  });

  it("CONTROL: the comparison can fail — a reader ordered by name instead of score disagrees", async () => {
    const state = (await loadEventState(seeded.eventId))!;
    const rows = standingRows(state);
    const byName = [...rows].sort((a, b) => a.name.localeCompare(b.name)).map((r, i) => ({ ...r, rank: i + 1 }));
    const differ = Object.values(seeded.players).filter((p) => placeOf(rows, p.id) !== placeOf(byName, p.id));
    expect(differ.length).toBeGreaterThan(0);
    // and the places are not all one, so a reader that put everybody level would differ too
    expect(new Set(Object.values(seeded.players).map((p) => placeOf(rows, p.id))).size).toBe(4);
  });
});

describe("a player's money is the same on every screen", () => {
  it("their own Money screen, the standing everybody sees, and the settle-up's handovers", async () => {
    const everyone = await moneyFor(seeded.eventId, "");
    expect(everyone.transfers.length, "the fixture settles nothing").toBeGreaterThan(0);
    for (const [who, p] of Object.entries(seeded.players)) {
      const mine = await moneyFor(seeded.eventId, p.email);
      expect(mine.playerId, who).toBe(p.id);
      const standing = everyone.standing.find((s) => s.playerId === p.id)?.netCents ?? 0;
      const handedOver =
        everyone.transfers.filter((t) => t.toPlayerId === p.id).reduce((a, t) => a + t.cents, 0) -
        everyone.transfers.filter((t) => t.fromPlayerId === p.id).reduce((a, t) => a + t.cents, 0);
      expect({ who, own: mine.netCents, standing, handedOver }).toEqual({ who, own: standing, standing, handedOver: standing });
      expect(mine.netCents).toBe(mine.expensesCents + mine.gamesCents - mine.settledCents);
    }
    expect(everyone.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);
  });
});
