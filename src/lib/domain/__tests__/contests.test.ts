import { describe, it, expect } from "vitest";
import {
  contestNets,
  contestLedger,
  potOf,
  isDecided,
  isContestKind,
  CONTEST_LABEL,
  type Contest,
} from "../contests";
import { settle } from "../money";

/**
 * Closest to the pin, long drive, and the rest of the first tee's inventions.
 *
 * Player-funded: everybody puts in, somebody takes it out, and the money moves
 * between players — so every test here is really asking one question. Does the
 * pot that goes out equal the stakes that came in, to the cent?
 */

const contest = (over: Partial<Contest> = {}): Contest => ({
  id: "c1",
  kind: "closest-pin",
  name: "Closest to the pin, 7th",
  buyInCents: 500,
  entrantIds: ["a", "b", "c", "d"],
  winnerIds: ["a"],
  ...over,
});

const sum = (nets: Array<{ netCents: number }>) => nets.reduce((a, n) => a + n.netCents, 0);

describe("one contest", () => {
  it("takes the stake off everyone and gives the pot to the winner", () => {
    const nets = contestNets(contest());
    expect(sum(nets)).toBe(0);
    // Four in at $5: a $20 pot, and the winner is up their own stake less.
    expect(nets.find((n) => n.playerId === "a")!.netCents).toBe(1_500);
    expect(nets.find((n) => n.playerId === "b")!.netCents).toBe(-500);
  });

  it("splits a tie exactly", () => {
    // Two players the same distance from the pin share it.
    const nets = contestNets(contest({ winnerIds: ["a", "b"] }));
    expect(sum(nets)).toBe(0);
    expect(nets.find((n) => n.playerId === "a")!.netCents).toBe(500);
    expect(nets.find((n) => n.playerId === "b")!.netCents).toBe(500);
  });

  it("splits a pot that will not divide, without losing a cent", () => {
    // A $25 pot between three ties is 8.3333 each. Rounded independently that
    // is a cent short, and a cent short is a sheet that does not balance.
    const nets = contestNets(contest({ buyInCents: 500, entrantIds: ["a", "b", "c", "d", "e"], winnerIds: ["a", "b", "c"] }));
    expect(sum(nets)).toBe(0);
    const won = nets
      .filter((n) => ["a", "b", "c"].includes(n.playerId))
      // Add each winner's own stake back to see the raw share they took.
      .map((n) => n.netCents + 500)
      .sort((x, y) => y - x);
    expect(won).toEqual([834, 833, 833]);
    expect(won.reduce((x, y) => x + y, 0)).toBe(2_500);
  });

  it("pays and charges nobody until it is decided", () => {
    // A pot collected but not yet won is not a debt. Charging every entrant
    // the moment they enter would tell a player they owe money for a contest
    // nobody has won, and the sheet would stop matching the cash on the table.
    expect(contestNets(contest({ winnerIds: [] }))).toEqual([]);
    expect(isDecided(contest({ winnerIds: [] }))).toBe(false);
    expect(isDecided(contest())).toBe(true);
  });

  it("is worth nothing when it is a free contest", () => {
    expect(contestNets(contest({ buyInCents: 0 }))).toEqual([]);
  });

  it("charges a player once even if entered twice", () => {
    const nets = contestNets(contest({ entrantIds: ["a", "b", "b", "c", "d"] }));
    expect(sum(nets)).toBe(0);
    expect(nets.find((n) => n.playerId === "b")!.netCents).toBe(-500);
  });

  it("still records a winner who never paid in", () => {
    // Somebody put down for the long drive without staking. That is the
    // organizer's to sort out, and refusing to record it just moves the
    // argument off the app — but the money must still balance.
    const nets = contestNets(contest({ entrantIds: ["b", "c", "d"], winnerIds: ["a"] }));
    expect(sum(nets)).toBe(0);
    expect(nets.find((n) => n.playerId === "a")!.netCents).toBe(1_500);
  });

  it("nets a one-player contest to nothing", () => {
    // You cannot win money off yourself.
    expect(sum(contestNets(contest({ entrantIds: ["a"], winnerIds: ["a"] })))).toBe(0);
  });
});

describe("a day of side bets", () => {
  const day: Contest[] = [
    contest({ id: "c1", name: "KP 7th", winnerIds: ["a"] }),
    contest({ id: "c2", kind: "long-drive", name: "Long drive 12th", buyInCents: 1_000, winnerIds: ["b", "c"] }),
    contest({ id: "c3", kind: "other", name: "Nearest in two", buyInCents: 300, winnerIds: [] }),
  ];

  it("sums to zero across the outing", () => {
    expect(sum(contestLedger(day))).toBe(0);
  });

  it("settles square", () => {
    const nets = contestLedger(day);
    const after = new Map(nets.map((n) => [n.playerId, n.netCents]));
    for (const t of settle(nets)) {
      after.set(t.fromPlayerId, (after.get(t.fromPlayerId) ?? 0) + t.cents);
      after.set(t.toPlayerId, (after.get(t.toPlayerId) ?? 0) - t.cents);
      expect(t.cents).toBeGreaterThan(0);
      expect(t.fromPlayerId).not.toBe(t.toPlayerId);
    }
    for (const [id, cents] of after) expect(cents, `${id}`).toBe(0);
  });

  it("leaves an undecided pot out of everyone's position", () => {
    // c3 is 4 x $3 collected and unwon; nobody's number should move for it.
    const withOpen = contestLedger(day);
    const withoutOpen = contestLedger(day.filter((c) => c.id !== "c3"));
    expect(withOpen).toEqual(withoutOpen);
  });

  it("reports the pot on the table, decided or not", () => {
    expect(potOf(day[0])).toBe(2_000);
    expect(potOf(day[2]), "an open pot is still real money").toBe(1_200);
  });
});

describe("what counts as a contest", () => {
  it("recognises the kinds it knows and refuses the rest", () => {
    for (const k of ["closest-pin", "long-drive", "other"]) expect(isContestKind(k)).toBe(true);
    for (const k of ["nassau", "", "SKINS"]) expect(isContestKind(k)).toBe(false);
  });

  it("has a name for each", () => {
    expect(CONTEST_LABEL["closest-pin"]).toBe("Closest to the pin");
    expect(CONTEST_LABEL["long-drive"]).toBe("Long drive");
  });
});
