import { describe, it, expect } from "vitest";
import {
  tournamentStatus,
  statusRequestOf,
  playRefusalOf,
  roundCloseCheck,
  ALREADY_COMPLETED,
  ALREADY_LAUNCHED,
  NOT_LAUNCHED_TO_COMPLETE,
  NOT_COMPLETED_TO_REOPEN,
} from "../tournament-status";
import { cardsNotFinal, cutBlockers } from "../cut-ready";
import { FAMILY_FIXTURES, FAMILIES, facts, round, launched, playedOut, completed } from "./tournament-facts-fixtures";

/**
 * WHAT THE ACTIONS ASK THE MACHINE (state machine PR 4) — worked by hand from
 * the panel's rulings (proposal 3 Nov, section 8) and the Rules of Golf, never
 * by calling the readers the machine replaces.
 *
 *   launch     `refusals.launch`, the button's own refusal
 *   a status   `statusRequestOf`: launch, complete (and its question), reopen
 *   play       `playRefusalOf`: the one "has anybody played" (`hasResult`, D2)
 *   a round    `roundCloseCheck`: refuse over a dispute, ask over an unsigned card (TD Q4)
 */

const ask = (st: ReturnType<typeof tournamentStatus>, from: string, to: string) => statusRequestOf(st, from, to);

describe("a status move is asked of the machine", () => {
  it("going live on a tournament setting up is Launch — refused in the button's own words", () => {
    // Golf Pro 8.2: a knockout needs two players. The old gate let one through.
    const one = { ...FAMILY_FIXTURES.knockout(), confirmed: 1 };
    const st = tournamentStatus(one);
    expect(ask(st, "draft", "live")).toEqual({ kind: "refuse", error: st.refusals.launch });
    expect(st.refusals.launch).toBe("A knockout needs at least two players, and only one is entered. Add more on Entries, then launch.");
    expect(ask(tournamentStatus(FAMILY_FIXTURES.knockout()), "draft", "live")).toEqual({ kind: "launch" });
  });

  it("completing a draft is refused: there is nothing to complete until it is launched", () => {
    const st = tournamentStatus(FAMILY_FIXTURES.stroke());
    expect(ask(st, "draft", "completed")).toEqual({ kind: "refuse", error: NOT_LAUNCHED_TO_COMPLETE });
  });

  it("completing over a disputed result is refused until the Committee rules (Rule 20.2b, 20.2e)", () => {
    const st = tournamentStatus({ ...playedOut(FAMILY_FIXTURES.stroke()), review: { pendingConfirmations: 0, disputed: 1 } });
    const r = ask(st, "live", "completed");
    expect(r.kind).toBe("refuse");
    expect(r.kind === "refuse" && r.error).toMatch(/^1 result is disputed/);
  });

  it("completing with a round nobody played is ASKED, not refused (the panel, 31 Oct)", () => {
    // Two rounds; Round 1 played, Round 2 neither played nor closed.
    const two = launched(
      facts({ rounds: [round({ id: "r1", position: 0, hasResult: true, closed: true }), round({ id: "r2", position: 1 })] }),
    );
    const st = tournamentStatus(two);
    expect(st.refusals.complete).toBeNull();
    expect(ask(st, "live", "completed")).toEqual({
      kind: "complete",
      asks: "Round 2 has no scores. Completing will close it as not played, and results will be decided on the rounds played.",
    });
    // Played out: nothing to ask.
    expect(ask(tournamentStatus(playedOut(FAMILY_FIXTURES.stroke())), "live", "completed")).toEqual({ kind: "complete", asks: null });
  });

  it("the question is asked whatever the button of the moment — a live league's button may be a day to set", () => {
    const league = launched(FAMILY_FIXTURES.league());
    const weeks = league.rounds.map((r, i) => ({ ...r, hasResult: i === 0, closed: i === 0, scheduled: i !== 1 }));
    const st = tournamentStatus({ ...league, rounds: weeks });
    expect(st.nextAction?.kind).toBe("schedule");
    expect(st.asks.complete).toMatch(/^Rounds 2 and 3 have no scores/);
  });

  it("a completed tournament is not completed twice, and is reopened", () => {
    const st = tournamentStatus(completed(FAMILY_FIXTURES.stroke()));
    expect(ask(st, "completed", "completed")).toEqual({ kind: "refuse", error: ALREADY_COMPLETED });
    expect(ask(st, "completed", "live")).toEqual({ kind: "reopen" });
  });

  it("'live' on a tournament already live is not a reopen", () => {
    const st = tournamentStatus(launched(FAMILY_FIXTURES.stroke()));
    expect(ask(st, "live", "live")).toEqual({ kind: "refuse", error: NOT_COMPLETED_TO_REOPEN });
  });

  it("CONTROL: the vocabulary is still `statusMove`'s — an unknown word, and never back to setting up", () => {
    const st = tournamentStatus(launched(FAMILY_FIXTURES.stroke()));
    expect(ask(st, "live", "archived")).toEqual({ kind: "refuse", error: "That is not a tournament status." });
    const back = ask(st, "live", "draft");
    expect(back.kind === "refuse" && back.error).toMatch(/can’t go back to setting up/);
    const draft = tournamentStatus(FAMILY_FIXTURES.stroke());
    const between = ask(draft, "draft", "registration");
    expect(between.kind === "refuse" && between.error).toMatch(/one Setting up step/);
  });

  it("every refusal the actions now return says what to do next, and a launched tournament is not launched again", () => {
    expect(tournamentStatus(launched(FAMILY_FIXTURES.stroke())).refusals.launch).toBe(ALREADY_LAUNCHED);
    for (const words of [ALREADY_LAUNCHED, ALREADY_COMPLETED, NOT_LAUNCHED_TO_COMPLETE, NOT_COMPLETED_TO_REOPEN]) {
      expect(words.split(/\s+/).length, words).toBeLessThanOrEqual(20);
      expect(words).toMatch(/^This tournament /);
    }
  });

  it("for every family and step, an allowed move agrees with the button: the button is live exactly when the move is", () => {
    for (const family of FAMILIES.filter((x) => x !== "casual")) {
      for (const [from, f] of [
        ["draft", FAMILY_FIXTURES[family]()],
        ["live", launched(FAMILY_FIXTURES[family]())],
        ["live", playedOut(FAMILY_FIXTURES[family]())],
        ["completed", completed(FAMILY_FIXTURES[family]())],
      ] as const) {
        const st = tournamentStatus(f);
        const n = st.nextAction;
        if (!n || n.kind === "draw" || n.kind === "schedule") continue;
        const to = n.kind === "launch" ? "live" : n.kind === "complete" ? "completed" : "live";
        const r = ask(st, from, to);
        expect(r.kind !== "refuse", `${family} ${from} → ${to}: button ${n.enabled ? "live" : "refused"}, action ${r.kind}`).toBe(n.enabled);
        if (r.kind === "refuse") expect(r.error).toBe(n.disabledBecause);
      }
    }
  });
});

describe("play is refused before launch, unless play has begun — on the one definition of 'begun' (D2)", () => {
  it("a draft with nothing played is refused; any round with a result lets play go on", () => {
    expect(playRefusalOf(facts())).toMatch(/hasn’t been launched yet/);
    // A forfeit, a match card, a knockout winner: each is a round's `hasResult`.
    expect(playRefusalOf(facts({ rounds: [round({ id: "r1", position: 0, hasResult: true })] }))).toBeNull();
  });

  it("a launched tournament is never refused, whatever its rounds — so a hot path need not read them", () => {
    for (const status of ["live", "completed"]) {
      expect(playRefusalOf({ status, rounds: [] })).toBeNull();
      expect(playRefusalOf({ status, rounds: [round({ id: "r1", position: 0 })] })).toBeNull();
    }
  });

  it("is the machine's own `refusals.play`", () => {
    for (const family of FAMILIES) {
      for (const f of [FAMILY_FIXTURES[family](), launched(FAMILY_FIXTURES[family]()), playedOut(FAMILY_FIXTURES[family]())]) {
        expect(tournamentStatus(f).refusals.play).toBe(playRefusalOf(f));
      }
    }
  });
});

describe("closing a round with cards outstanding (TD Q4, Rule 3.3b, Rule 20.1c(3))", () => {
  it("a card not signed off is ASKED about, naming whose — the TD's own sentence", () => {
    expect(roundCloseCheck({ label: "Round 2", unsigned: ["Sam Reed"], disputed: 0 })).toEqual({
      ask: "Sam Reed’s card is not signed off yet. Close Round 2 anyway? It counts once it is signed.",
    });
    expect(roundCloseCheck({ label: "Round 2", unsigned: ["Sam Reed", "Ida Moss"], disputed: 0 })).toEqual({
      ask: "Sam Reed’s and Ida Moss’s cards are not signed off yet. Close Round 2 anyway? They count once they are signed.",
    });
    expect(roundCloseCheck({ label: "Round 1", unsigned: ["A", "B", "C"], disputed: 0 })).toEqual({
      ask: "A’s, B’s and C’s cards are not signed off yet. Close Round 1 anyway? They count once they are signed.",
    });
    // Past three names a count, so the question stays one line on a phone.
    expect(roundCloseCheck({ label: "Round 1", unsigned: ["A", "B", "C", "D"], disputed: 0 })).toEqual({
      ask: "4 cards are not signed off yet. Close Round 1 anyway? They count once they are signed.",
    });
  });

  it("a disputed card or result is REFUSED until it is ruled on — and outranks an unsigned one", () => {
    expect(roundCloseCheck({ label: "Round 2", unsigned: ["Sam Reed"], disputed: 1 })).toEqual({
      refuse: "1 result in Round 2 is disputed, so it can’t be closed yet. Settle it on Score entry, then close the round.",
    });
    expect(roundCloseCheck({ label: "Round 2", unsigned: [], disputed: 2 })).toEqual({
      refuse: "2 results in Round 2 are disputed, so it can’t be closed yet. Settle them on Score entry, then close the round.",
    });
  });

  it("CONTROL: every card final, nothing disputed — closing is not interrupted", () => {
    expect(roundCloseCheck({ label: "Round 1", unsigned: [], disputed: 0 })).toBeNull();
  });

  it("which card is final is the cut's own split, so the cut and the close cannot disagree", () => {
    const card = (status: string, strokes = "[4,4]") => ({ status, strokes });
    const cards = [card("entered"), card("certified"), card("approved"), card("disputed"), card("entered", "[]")];
    // Players confirm (no committee review): certified is final; an empty card is nobody's yet.
    expect(cardsNotFinal(cards, false)).toEqual({ pending: [cards[0]], disputed: [cards[3]] });
    // The committee accepts cards: only approved is final.
    expect(cardsNotFinal(cards, true)).toEqual({ pending: [cards[0], cards[1]], disputed: [cards[3]] });
    for (const staff of [false, true]) {
      const split = cardsNotFinal(cards, staff);
      const b = cutBlockers(cards, staff);
      expect(b.disputed).toBe(split.disputed.length);
      expect(b.awaitingApproval + b.notReturned).toBe(split.pending.length);
    }
  });
});
