import { describe, it, expect } from "vitest";
import { switcherFor, isWatching, openCardOf, playOverOf, type SwitchableRow } from "@/lib/domain/tournament-switcher";
import { BAND_LABEL, type EventBand } from "@/lib/domain/club-event-card";
import { readSource } from "./source";
import { tournamentStatus, type TournamentFacts } from "@/lib/domain/tournament-status";
import { stepOf } from "@/lib/domain/tournament-step";
import { FAMILY_FIXTURES, facts, round, launched, playedOut } from "@/lib/domain/__tests__/tournament-facts-fixtures";

/** Where a tournament is, as the machine hands it to the switcher (`stepOf`, PR 6). */
const SETTING_UP = { step: "setting-up", journey: "setup" } as const;
const LIVE = { step: "live", journey: "play" } as const;
const PLAY_OVER = { step: "play-over", journey: "play" } as const;

const row = (eventId: string, band: EventBand, over: Partial<SwitchableRow> = {}): SwitchableRow => ({
  eventId,
  name: `zz-${eventId}`,
  band,
  bandLabel: BAND_LABEL[band],
  entered: band === "entered",
  canView: true,
  ...over,
});

describe("the tournament switcher", () => {
  it("names the tournament on screen and says the member is watching one they are not in", () => {
    const s = switcherFor([row("medal", "entered"), row("cup", "live")], "cup", false);
    // `waiting` joined the shape on 2026-09-20, when a member on the waiting
    // list stopped being called a spectator — see `waiting-is-not-watching`.
    // Asserted here rather than loosened: this is the one place that pins the
    // whole object, and a field arriving unnoticed is what it exists to stop.
    expect(s.current).toEqual({
      eventId: "cup",
      name: "zz-cup",
      note: "Watching · On now",
      watching: true,
      waiting: false,
      awaiting: false,
    });
  });

  it("an entry awaiting approval is said as such, not as a waiting list (2026-09-28)", () => {
    const s = switcherFor([row("vetted", "waiting", { waiting: true, awaiting: true })], "vetted", false);
    expect(s.current?.awaiting).toBe(true);
    expect(s.current?.waiting).toBe(true); // every RULE still treats it as waiting
    expect(s.current?.note).toMatch(/^Awaiting approval/);
    // CONTROL: a real waiting-list place keeps its words.
    const q = switcherFor([row("am", "waiting", { waiting: true })], "am", false);
    expect(q.current?.awaiting).toBe(false);
    expect(q.current?.note).toMatch(/^Waiting list/);
  });

  it("does not call a member watching a tournament they are in", () => {
    const s = switcherFor([row("medal", "entered")], "medal", false);
    expect(s.current?.watching).toBe(false);
    expect(s.current?.note).toBe("You’re in");
  });

  it("never calls staff watching — an organizer in the player view is running it", () => {
    const s = switcherFor([row("cup", "live")], "cup", true);
    expect(s.current?.watching).toBe(false);
    expect(s.current?.note).toBe("On now");
  });

  it("says a finished tournament the member played in was theirs", () => {
    const s = switcherFor([row("old", "finished", { entered: true })], null, false);
    expect(s.others[0].note).toBe("You’re in · Finished");
  });

  it("leaves the current tournament out of the list of places to go", () => {
    const s = switcherFor([row("medal", "entered"), row("cup", "live")], "medal", false);
    expect(s.others.map((o) => o.eventId)).toEqual(["cup"]);
  });

  it("leaves out a tournament with nothing to look at that the member is not in", () => {
    const s = switcherFor(
      [row("draft", "closed", { canView: false }), row("mine", "open", { entered: true, canView: false })],
      null,
      false,
    );
    expect(s.others.map((o) => o.eventId)).toEqual(["mine"]);
  });

  it("orders the rest the way the events list does — the member's own first, finished last", () => {
    const s = switcherFor(
      [row("done", "finished"), row("open", "open"), row("mine", "entered"), row("now", "live")],
      null,
      false,
    );
    expect(s.others.map((o) => o.eventId)).toEqual(["mine", "now", "open", "done"]);
  });

  it("has no current tournament when the active one is not in the member's list", () => {
    expect(switcherFor([row("cup", "live")], "elsewhere", false).current).toBeNull();
    expect(switcherFor([row("cup", "live")], null, false).current).toBeNull();
  });

  it("says which of the player's own tournaments is being played now, and puts it first", () => {
    // The club's ask: a player in several tournaments picks the one they are playing.
    const s = switcherFor(
      [
        row("league", "entered", { step: SETTING_UP }),
        row("medal", "entered", { step: LIVE }),
        row("cup", "live"),
      ],
      null,
      false,
    );
    expect(s.others.map((o) => [o.eventId, o.note])).toEqual([
      ["medal", "You’re in · Playing now"],
      ["league", "You’re in"],
      ["cup", "Watching · On now"],
    ]);
  });

  it("isWatching needs a row", () => {
    expect(isWatching(null, false)).toBe(false);
  });

  it("says which one has the member's card open, and puts it first", () => {
    // The seeded member on 2026-09-27: five live tournaments, five identical
    // "Playing now" lines, and his card open at the 12th in the last of them.
    const s = switcherFor(
      [
        row("twilight", "entered", { step: LIVE }),
        row("league", "entered", { step: LIVE }),
        row("medal", "entered", { step: LIVE, openCard: { thru: 11, complete: false } }),
        row("signing", "entered", { step: LIVE, openCard: { thru: 9, complete: true } }),
      ],
      null,
      false,
    );
    expect(s.others.map((o) => [o.eventId, o.note])).toEqual([
      ["medal", "You’re in · Your card · thru 11"],
      ["signing", "You’re in · Your card · to sign"],
      ["twilight", "You’re in · Playing now"],
      ["league", "You’re in · Playing now"],
    ]);
  });

  it("does not repeat the card on the tournament already on screen", () => {
    // Today, directly beneath, says "YOUR CARD · THRU 11" itself — the second
    // copy was found by e2e/player.spec.ts matching both.
    const s = switcherFor(
      [row("medal", "entered", { step: LIVE, openCard: { thru: 11, complete: false } })],
      "medal",
      false,
    );
    expect(s.current?.note).toBe("You’re in · Playing now");
  });

  /**
   * EVERY ROUND CLOSED, TOURNAMENT NOT YET COMPLETED (2026-10-09, T69). The
   * header said "Playing now" over a board reading FINAL.
   */
  it("says play is complete once every round is closed, and not before", () => {
    const at = (playOver: boolean) =>
      switcherFor([row("medal", "entered", { step: playOver ? PLAY_OVER : LIVE })], "medal", false).current?.note;
    expect(at(true)).toBe("You’re in · Play complete");
    expect(at(false)).toBe("You’re in · Playing now");
  });

  /**
   * CUT, WHILE THE ROUND IS BEING PLAYED (2026-10-09). Walked on a 120-player
   * championship: everybody who missed the cut read "Playing now".
   */
  it("says a member missed the cut, not that they are playing", () => {
    const at = (cutOut: boolean) =>
      switcherFor([row("medal", "entered", { step: LIVE, cutOut })], "medal", false).current?.note;
    expect(at(true)).toBe("You’re in · Missed the cut");
    expect(at(false)).toBe("You’re in · Playing now");
  });

  /**
   * THE NOTE READS THE MACHINE (state machine PR 6). Facts in, the machine's
   * step out, the note from that — the route the player's switcher takes
   * (`clubEventsFor` → `tournamentStepsFor` → `stepOf`).
   */
  describe("the note is the machine's step", () => {
    const noteFor = (f: TournamentFacts) =>
      switcherFor([row("t", "entered", { step: stepOf(tournamentStatus(f)) })], "t", false).current?.note;

    it("a knockout whose Final is decided is play complete — no round is ever closed on one (D3)", () => {
      const ko = FAMILY_FIXTURES.knockout();
      const decided = playedOut(ko);
      expect(decided.rounds.every((r) => !r.closed), "the fixture closes a Bracket Stage").toBe(true);
      expect(noteFor(decided)).toBe("You’re in · Play complete");
      // CONTROL: the Final not yet decided is still being played.
      const undecided = { ...decided, knockout: { ...decided.knockout!, draws: decided.knockout!.draws.map((d) => ({ ...d, finalDecided: false })) } };
      expect(noteFor(undecided)).toBe("You’re in · Playing now");
      // And what the switcher said before, from every round closed: never complete for a knockout.
      expect(playOverOf(decided.rounds.map((r) => ({ type: r.type, closedAt: r.closed ? new Date() : null })))).toBe(false);
    });

    it("a tournament being played before it was launched is being played (D5)", () => {
      const f = facts({ rounds: [round({ id: "r1", position: 0, hasResult: true })] });
      expect(f.status).toBe("draft");
      expect(noteFor(f)).toBe("You’re in · Playing now");
      // CONTROL: the same draft with nothing on it says nothing.
      expect(noteFor(facts())).toBe("You’re in");
    });

    it("live, play over and completed read as before for a medal", () => {
      expect(noteFor(launched(facts()))).toBe("You’re in · Playing now");
      expect(noteFor(playedOut(facts()))).toBe("You’re in · Play complete");
    });

    it("a row the machine was not asked about says nothing about being played", () => {
      expect(switcherFor([row("t", "entered", { step: null })], "t", false).current?.note).toBe("You’re in");
    });
  });

  it("counts only playing rounds, and a tournament with none has not been played", () => {
    const closed = new Date();
    expect(playOverOf([{ type: "Stroke Play Round", closedAt: closed }])).toBe(true);
    expect(playOverOf([{ type: "Stroke Play Round", closedAt: closed }, { type: "Stroke Play Round", closedAt: null }])).toBe(false);
    expect(playOverOf([])).toBe(false);
    // A legacy row nobody plays (the removed Qualification Stage) does not hold it open.
    expect(playOverOf([{ type: "Stroke Play Round", closedAt: closed }, { type: "Qualification Stage", closedAt: null }])).toBe(true);
  });

  it("and the dashboard stops offering to suspend play that is over — unless it is suspended", () => {
    // Since the state machine's PR 3 the dashboard asks the machine's step:
    // "live" is launched, not completed, and not play-over — which for a medal
    // is `playOverOf` (every playing round closed), and for a knockout is its
    // Final decided (D3k). The control below holds the machine to playOverOf.
    const src = readSource("src/app/(app)/dashboard/page.tsx");
    expect(src).toMatch(/isStaff && \(step === "live" \|\| !!event\.playSuspendedAt\) && \(\s*<PlayStatusControl/);
    const closed = (c: boolean) => [round({ id: "r1", position: 0, hasResult: true, closed: c })];
    expect(tournamentStatus(launched(facts({ rounds: closed(false) }))).step).toBe("live");
    expect(tournamentStatus(launched(facts({ rounds: closed(true) }))).step).toBe("play-over");
    expect(playOverOf([{ type: "Stroke Play Round", closedAt: new Date() }])).toBe(true);
  });
});

describe("a card that still needs its player", () => {
  const card = (holes: (number | null)[]) => JSON.stringify(holes);

  it("is one started and not finished, counted in holes", () => {
    expect(openCardOf(card([4, 5, 3, null, null, null, null, null, null]), 9, false)).toEqual({ thru: 3, complete: false });
  });

  it("is still open with every hole in, until it is signed", () => {
    expect(openCardOf(card([4, 4, 4, 4, 4, 4, 4, 4, 4]), 9, false)).toEqual({ thru: 9, complete: true });
  });

  it("counts the holes played, not the position — a card started on the 10th", () => {
    const back = [null, null, null, null, null, null, null, null, null, 4, 5, 4, null, null, null, null, null, null];
    expect(openCardOf(card(back), 18, false)).toEqual({ thru: 3, complete: false });
  });

  it("is nothing when blank, when the round is closed, or when the card will not read", () => {
    expect(openCardOf(card([null, null, null]), 3, false)).toBeNull();
    expect(openCardOf(card([4, 5]), 18, true)).toBeNull();
    expect(openCardOf("not json", 18, false)).toBeNull();
    expect(openCardOf("{}", 18, false)).toBeNull();
  });

  it("does not count past the round's own holes", () => {
    // A nine played off an eighteen-long array still finishes at nine.
    expect(openCardOf(card([...new Array(9).fill(4), ...new Array(9).fill(null)]), 9, false)).toEqual({
      thru: 9,
      complete: true,
    });
  });
});
