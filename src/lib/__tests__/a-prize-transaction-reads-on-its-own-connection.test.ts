import { describe, expect, it, vi } from "vitest";

/**
 * A PRIZE TRANSACTION READS ON ITS OWN CONNECTION (2026-11-09).
 *
 * The nightly round G26-1-nightly (run 42709763106, Firefox desktop) failed
 * `one-prize-per-player.spec.ts` at the last step: the "counts toward one
 * prize per player" switch was pressed on a line whose winner already held
 * Best gross, and no refusal appeared. The trace shows why. `setPrizeCounts`
 * opened an interactive transaction, locked the tournament's row, read the
 * prize list on the transaction — and then read the winner's NAME through the
 * bare `prisma` client, which needs a second pooled connection while the
 * transaction holds the first. That read stalled for six seconds; the
 * transaction's five-second limit passed; the commit failed with P2028
 * "Transaction already closed"; the action threw rather than answering, and the
 * organizer's whole Prizes screen was replaced by "This screen didn't load"
 * (reference 2114098164 on the screenshot, the same digest in the server log).
 *
 * The rule this pins: while one of the prize actions has a transaction open,
 * EVERY read goes on the transaction's client. The database here is a fake
 * that answers canned rows and refuses the bare client the moment a
 * transaction is open — so the test cannot pass by the pool happening to be
 * free, which is how the real one passed in six parts of the same round and
 * failed in the seventh.
 */

/** Whether a transaction callback is running right now. */
let open = false;
/** What the bare client was asked while a transaction was open. */
const asked: string[] = [];

type Row = Record<string, unknown>;
const players: Row[] = [
  { id: "ann", name: "Ann Example" },
  { id: "bea", name: "Bea Example" },
];
/** Ann holds Best gross (counts) and Nearest the pin (does not); Best net is open. */
let prizes: Row[] = [
  { id: "gross", category: "Best gross", winnerId: "ann", countsForOnePrize: true },
  { id: "net", category: "Best net", winnerId: null, countsForOnePrize: true },
  { id: "pin", category: "Nearest the pin", winnerId: "ann", countsForOnePrize: false },
];

/** The rows the real queries would return, by model and method. */
function canned(model: string, method: string, args: Row[]): unknown {
  const where = (args[0]?.where ?? {}) as Row;
  if (model === "event" && method === "findUnique") {
    // `archiveOf` asks for the archive; the actions ask for the rule.
    return { archivedAt: null, status: "active", organization: { timeZone: "", locale: "" }, onePrizePerPlayer: true };
  }
  if (model === "event" && method === "update") return {};
  if (model === "prize" && method === "findMany") return prizes;
  if (model === "prize" && method === "updateMany") return { count: 1 };
  if (model === "player" && method === "findMany") {
    const ids = ((where.id as Row | undefined)?.in as string[] | undefined) ?? [];
    return players.filter((p) => ids.includes(p.id as string));
  }
  if (model === "player" && method === "findFirst") return players.find((p) => p.id === where.id) ?? null;
  if (model === "auditLog" && method === "create") return {};
  throw new Error(`the fake database has no answer for ${model}.${method}`);
}

/** A client whose every model method answers from `canned`; `bare` is refused inside a transaction. */
function client(bare: boolean): Row {
  return new Proxy({} as Row, {
    get(_, model: string) {
      if (model === "$queryRaw" || model === "$executeRaw") return async () => [];
      if (model === "$transaction") {
        return async (fn: (tx: Row) => Promise<unknown>) => {
          open = true;
          try {
            return await fn(client(false));
          } finally {
            open = false;
          }
        };
      }
      return new Proxy({} as Row, {
        get(__, method: string) {
          return async (...args: Row[]) => {
            if (bare && open) {
              asked.push(`${model}.${method}`);
              throw new Error(`the bare client was asked ${model}.${method} inside an open transaction`);
            }
            return canned(model, method, args);
          };
        },
      });
    },
  });
}

const session = { email: "zz-prize-tx@example.invalid", name: "zz secretary", eventId: "zz-event", role: "admin" };
vi.mock("@/lib/db", () => ({ prisma: client(true) }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { prisma } = await import("@/lib/db");
const { setPrizeCounts, setOnePrizePerPlayer } = await import("@/app/actions/tournament");

describe("a prize transaction reads on its own connection", () => {
  it("control: the fake refuses the bare client inside an open transaction, and answers it outside one", async () => {
    await expect(prisma.player.findMany({ where: { id: { in: ["ann"] } } })).resolves.toEqual([{ id: "ann", name: "Ann Example" }]);
    await expect(
      prisma.$transaction(async () => prisma.player.findMany({ where: { id: { in: ["ann"] } } })),
    ).rejects.toThrow(/bare client was asked player\.findMany inside an open transaction/);
    asked.length = 0;
  });

  it("switching nearest the pin to counting is refused in words, naming the holder, with no read off the transaction", async () => {
    const res = await setPrizeCounts("pin", true);
    expect(res).toEqual({
      ok: false,
      error: "Ann Example already has Best gross, so Nearest the pin can't count as well. Clear one of the two awards first.",
    });
    expect(asked, "a read left the transaction's connection").toEqual([]);
  });

  it("ticking the rule while somebody holds two counting prizes is refused, naming them, with no read off the transaction", async () => {
    prizes = prizes.map((p) => (p.id === "net" ? { ...p, winnerId: "ann" } : p));
    const res = await setOnePrizePerPlayer(true);
    expect(res).toEqual({ ok: false, error: "Ann Example has Best gross and Best net. Clear one of them before giving one prize per player." });
    expect(asked, "a read left the transaction's connection").toEqual([]);
  });
});
