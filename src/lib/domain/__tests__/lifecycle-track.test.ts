import { describe, it, expect } from "vitest";
import { tournamentJob, whatsNext, type TournamentJob, type TournamentJobFacts } from "../needs-you-now";
import { readSource } from "../../__tests__/source";
import { cardPressOf, endEarlyOf, lifecycleTrack, stepperOpenOn, stepperShown, trackCount, LIFECYCLE_STEPPER_ON, type LifecycleTrack } from "../lifecycle-track";
import { shortDate } from "../round-dates";
import { tournamentStatus, type RoundFacts, type TournamentFacts, type TournamentStatus } from "../tournament-status";
import { FAMILIES, FAMILY_FIXTURES, completed, facts, launched, playedOut, round } from "./tournament-facts-fixtures";

/**
 * THE LIFECYCLE STEPPER (B03) — ONE ANSWER WITH THE DASHBOARD AND THE HOME.
 *
 * The panel's ruling of 9 Nov: the stepper, the dashboard card's button and What's next's first line
 * for a tournament are ONE job (`tournamentJob`), and never "Complete tournament" while golf is being
 * played. Three blocks:
 *
 *   the table      a two-round medal walked the way an organizer walks it — set up, refused, ready,
 *                  launched, the tee sheet, day 1, a dispute, every card in, between rounds, day 2,
 *                  play over, completed — and at each stage the button, the stop and the count, worked
 *                  out at the desk (what a tournament director would press), not copied from the code
 *   every shape    each family at each stage, with THREE flights where flights matter, held to the
 *                  invariants: one current stop, held exactly when the button is refused, its reason
 *                  the refusal word for word, every unfinished stop a reason
 *   agreement      the stepper's press IS the job; the dashboard's press is the job; What's next's first
 *                  line for the tournament is the job — over the table, every shape, and generated
 *                  tournaments
 *
 * Pure: facts in, answers out. Every name is invented.
 */

const TODAY = "2026-11-20"; // a Friday
const day = (iso: string) => shortDate(iso, "en-GB");

/** The job facts for a tournament, its status the machine's own (`tournamentStatus`), never written by hand. */
type Facts = TournamentJobFacts & { status: TournamentStatus };
function jobFacts(f: TournamentFacts, over: Partial<TournamentJobFacts> = {}): Facts {
  return {
    eventId: "e1",
    name: "zz-stepper Quillstone Club Championship",
    awaitingApproval: 0,
    entriesClose: "",
    nextSheet: null,
    board: null,
    startOn: f.startOn,
    endOn: f.endOn,
    ...over,
    status: tournamentStatus(f),
  };
}

interface Seen {
  job: TournamentJob;
  track: LifecycleTrack;
}

function see(f: TournamentFacts, over: Partial<TournamentJobFacts> = {}, today = TODAY): Seen {
  const t = jobFacts(f, over);
  const job = tournamentJob(t, today, day)!;
  const track = lifecycleTrack(t.status, job)!;
  return { job, track };
}

const cur = (s: Seen) => s.track.steps[s.track.current];

/* ---------------------------------------------------------- the two-round medal */

const r1 = (o: Partial<RoundFacts> = {}) => round({ id: "r1", position: 0, ...o });
const r2 = (o: Partial<RoundFacts> = {}) => round({ id: "r2", position: 1, ...o });
const medal = (o: Partial<TournamentFacts> = {}) =>
  facts({ startOn: "2026-11-28", endOn: "2026-11-29", confirmed: 24, groups: 0, rounds: [r1(), r2()], ...o });
const sheet = (roundId: string, label: string, d: string, published: boolean) => ({ roundId, round: label, day: d, published });
const board = (o: Partial<NonNullable<TournamentJobFacts["board"]>> = {}): NonNullable<TournamentJobFacts["board"]> => ({
  roundId: "r1",
  round: "Round 1",
  day: "2026-11-28",
  closed: false,
  unit: "cards",
  started: 20,
  certified: 18,
  total: 24,
  ...o,
});

describe("the button, the stop and the count, phase by phase (a two-round medal)", () => {
  it("1. setting up, a step refused: Launch is refused on that step, its reason the refusal word for word", () => {
    const s = see(medal({ missingCards: [{ stageId: "r2", label: "Round 2", course: "Quillstone — North Course" }] }));
    expect(s.job.key).toBe("launch");
    expect(s.job.enabled).toBe(false);
    expect(s.job.action).toBe("Launch tournament");
    expect(cur(s).label).toBe("Rounds & formats");
    expect(cur(s).state).toBe("held");
    expect(cur(s).reason).toBe(s.job.disabledBecause);
    expect(s.job.wayOut?.href).toBe(cur(s).href);
    // Flights are optional for a medal: shown, and left out of the count.
    expect(s.track.steps.find((x) => x.key === "setup-grouping")?.optional).toBe(true);
    expect(trackCount(s.track)).toBe("Set up · 3 of 5 done");
  });

  it("1. setting up, ready: Launch now — and before the first round's tee sheet that falls due the same day", () => {
    const s = see(medal(), { nextSheet: sheet("r1", "Round 1", "2026-11-28", false) });
    expect(s.job.key).toBe("launch");
    expect(s.job.enabled).toBe(true);
    expect(cur(s).label).toBe("Launch");
    expect(cur(s).state).toBe("now");
    // Launch is the last step of setting up; Flights, optional for a medal, is not counted.
    expect(trackCount(s.track)).toBe("Set up · 4 of 5 done");
    // Outside the home's fortnight the button is still Launch: the window is the home's, not the tournament's.
    const far = see(medal({ startOn: "2027-03-06", endOn: "2027-03-07" }));
    expect(far.job.key).toBe("launch");
    expect(whatsNext({ tournaments: [jobFacts(medal({ startOn: "2027-03-06", endOn: "2027-03-07" }))], today: TODAY, locale: "en-GB" })).toEqual([]);
  });

  it("2. launched, before the first tee: Publish the tee sheet, on the Tee times stop", () => {
    const s = see(launched(medal()), { nextSheet: sheet("r1", "Round 1", "2026-11-28", false), board: board({ started: 0, certified: 0 }) });
    expect(s.job.key).toBe("tee-sheet");
    expect(s.job.action).toBe("Publish the tee sheet");
    expect(s.job.href).toBe("/foursomes");
    expect(cur(s).key).toBe("draw");
    expect(cur(s).label).toBe("Tee sheet");
    expect(s.track.phases[1].title).toBe("Tee times");
  });

  it("2. the sheet out: no button, only when it tees off", () => {
    const s = see(launched(medal()), { nextSheet: sheet("r1", "Round 1", "2026-11-28", true), board: board({ started: 0, certified: 0 }) });
    expect(s.job.key).toBe("waiting");
    expect(s.job.action).toBeNull();
    expect(s.job.text).toBe("Round 1 tees off Sat 28 Nov");
    expect(cur(s).label).toBe("Round 1");
    expect(cardPressOf(s.track.steps.length ? tournamentStatus(launched(medal())).nextAction : null, s.job)).toEqual({ kind: "none", text: "Round 1 tees off Sat 28 Nov" });
  });

  it("3. during play: Open score entry, the cards IN — never Complete, which the machine offers from the first card", () => {
    const day1 = launched(medal({ rounds: [r1({ hasResult: true }), r2()] }));
    expect(tournamentStatus(day1).nextAction?.kind, "the machine's own next action, which the button must NOT be").toBe("complete");
    const s = see(day1, { board: board() }, "2026-11-28");
    expect(s.job.key).toBe("cards");
    expect(s.job.text).toBe("Round 1 · 18 of 24 cards in");
    expect(s.job.action).toBe("Open score entry");
    expect(cur(s).label).toBe("Round 1");
    expect(cur(s).state).toBe("now");
    expect(trackCount(s.track)).toBe("Play · 0 of 2 done");
    expect(cardPressOf(tournamentStatus(day1).nextAction, s.job)).toMatchObject({ kind: "link", label: "Open score entry", href: "/entry" });
  });

  it("3. a disputed result outranks the cards", () => {
    const s = see(launched(medal({ rounds: [r1({ hasResult: true }), r2()] })), { board: board(), disputed: 1 }, "2026-11-28");
    expect(s.job.key).toBe("settle");
    expect(s.job.action).toBe("Settle it");
    expect(cur(s).label).toBe("Round 1");
  });

  it("4. every card in, the round still open: Close Round 1, which opens that round", () => {
    const s = see(launched(medal({ rounds: [r1({ hasResult: true }), r2()] })), { board: board({ started: 24, certified: 24 }) }, "2026-11-28");
    expect(s.job.key).toBe("close");
    expect(s.job.action).toBe("Close Round 1");
    expect(s.job.href).toBe("/stages?round=r1");
    expect(cur(s).label).toBe("Round 1");
  });

  it("5. between rounds: Round 2's tee sheet on Round 2's stop, then waiting for it", () => {
    const between = launched(medal({ rounds: [r1({ hasResult: true, closed: true }), r2()] }));
    const s = see(between, { nextSheet: sheet("r2", "Round 2", "2026-11-29", false) }, "2026-11-28");
    expect(s.job.key).toBe("tee-sheet");
    expect(cur(s).label).toBe("Round 2");
    expect(trackCount(s.track)).toBe("Play · 1 of 2 done");
    const out = see(between, { nextSheet: sheet("r2", "Round 2", "2026-11-29", true) }, "2026-11-28");
    expect(out.job.text).toBe("Round 2 tees off Sun 29 Nov");
    expect(cur(out).label).toBe("Round 2");
  });

  it("5. between rounds of a round robin: the owed draw is the job, on that round's stop", () => {
    const rr = (o: Partial<RoundFacts>) => round({ type: "Round Robin", format: "Match Play", drawsPairings: true, teeSheetSaved: null, ...o } as RoundFacts);
    const f = launched(
      facts({
        groups: 3,
        confirmed: 12,
        rounds: [rr({ id: "r1", position: 0, matches: 18, matchesOver: 18, hasResult: true, closed: true }), rr({ id: "r2", position: 1, matches: 0, cutFed: true })],
      }),
    );
    const s = see(f);
    expect(s.job.key).toBe("draw");
    expect(s.job.action).toBe("Generate Round 2 pairings");
    expect(s.job.href).toBe("/stages?round=r2");
    expect(cur(s).label).toBe("Round 2");
    expect(cur(s).state).toBe("now");
  });

  it("6. play over: Complete tournament, with the machine's line", () => {
    const s = see(playedOut(medal()));
    expect(s.job.key).toBe("results");
    expect(s.job.action).toBe("Complete tournament");
    expect(s.job.text).toBe("Every round closed · results not released");
    expect(cur(s).label).toBe("Results");
    expect(s.track.phases[3].title).toBe("Results");
  });

  it("7. completed: Reopen tournament, quiet, on a finished track", () => {
    const s = see(completed(medal()));
    expect(s.job.key).toBe("reopen");
    expect(s.job.quiet).toBe(true);
    expect(cur(s).label).toBe("Results");
    expect(cur(s).state).toBe("done");
    expect(s.track.steps.every((x) => x.state === "done" || x.optional)).toBe(true);
    expect(trackCount(s.track)).toBe("Results · 1 of 1 done");
  });

  it("a casual round has no stepper", () => {
    const f = FAMILY_FIXTURES.casual();
    const t = jobFacts(f);
    expect(lifecycleTrack(t.status, tournamentJob(t, TODAY, day))).toBeNull();
  });
});

/* -------------------------------------------------------------- every shape */

/** Each family at each stage — three flights where flights matter (the fixtures' flighted knockout has three draws). */
function everyStage(): Array<{ name: string; f: TournamentFacts; over?: Partial<TournamentJobFacts> }> {
  const out: Array<{ name: string; f: TournamentFacts; over?: Partial<TournamentJobFacts> }> = [];
  for (const family of FAMILIES) {
    if (family === "casual") continue;
    const base = { ...FAMILY_FIXTURES[family](), startOn: "2026-11-28", endOn: "2026-11-29" };
    const flighted = family === "roundRobinFlights" || family === "stroke" || family === "stableford" ? { ...base, groups: 3 } : base;
    const first = flighted.rounds[0];
    out.push(
      { name: `${family}: set up`, f: flighted },
      { name: `${family}: nobody entered`, f: { ...flighted, confirmed: 0 } },
      { name: `${family}: no dates`, f: { ...flighted, dated: false } },
      { name: `${family}: launched`, f: launched(flighted) },
      { name: `${family}: launched, entries waiting`, f: launched(flighted), over: { awaitingApproval: 2 } },
      { name: `${family}: day 1`, f: launched({ ...flighted, rounds: flighted.rounds.map((r, i) => (i === 0 ? { ...r, hasResult: true } : r)) }), over: { board: board({ roundId: first.id, round: first.label }) } },
      { name: `${family}: played out`, f: playedOut(flighted) },
      { name: `${family}: played out, a dispute`, f: playedOut({ ...flighted, review: { pendingConfirmations: 1, disputed: 1 } }) },
      { name: `${family}: completed`, f: completed(flighted) },
    );
  }
  return out;
}

/** Everything the stepper promises, of one tournament at one moment. */
function invariants(name: string, t: Facts, today = TODAY) {
  const job = tournamentJob(t, today, day);
  const track = lifecycleTrack(t.status, job);
  expect(job, name).not.toBeNull();
  expect(track, name).not.toBeNull();
  const tr = track!;
  const j = job!;
  const c = tr.steps[tr.current];
  // One current stop, and it is the button's.
  expect(tr.current, name).toBeGreaterThanOrEqual(0);
  expect(tr.press, name).toBe(j);
  // Its state is the button's verdict.
  if (t.status.step === "completed") expect(c.state, name).toBe("done");
  else if (!j.enabled) {
    expect(c.state, name).toBe("held");
    expect(c.reason, `${name}: the refusal, word for word`).toBe(j.disabledBecause);
  } else expect(c.state, name).toBe("now");
  // Never Complete while golf is being played (a live tournament with no playing round has none to play).
  if (t.status.step === "live" && t.status.rounds.length > 0) {
    expect(j.key, name).not.toBe("results");
    // Nor as the dashboard card's button: while live, Complete is only ever "End this event early…".
    const card = cardPressOf(t.status.nextAction, j);
    expect(card.kind === "move" && card.action.kind === "complete", `${name}: Complete is the card's button while live`).toBe(false);
  }
  // Ending early is offered only while live, and only as the machine's own Complete.
  const early = endEarlyOf(t.status, j);
  if (early) {
    expect(t.status.step, `${name}: ending early offered outside play`).toBe("live");
    expect(early, name).toBe(t.status.nextAction);
  }
  // Every unfinished stop says why.
  for (const s of tr.steps) if (s.state !== "done") expect(s.reason, `${name}: ${s.label}`).not.toBe("");
  // The track never claims what has not happened: Launch is done exactly when it is launched, Results
  // exactly when it is completed. (Setup is worked in any order, and a cup's sessions may close out of
  // order, so "nothing after the current stop is done" is not a rule.)
  const stop = (key: string) => tr.steps.find((s) => s.key === key)!;
  expect(stop("launch").state === "done", `${name}: Launch`).toBe(t.status.step !== "setting-up");
  expect(stop("results").state === "done", `${name}: Results`).toBe(t.status.step === "completed");
  // Once launched the current stop is never back in setting up — unless entries wait for approval.
  if (t.status.step !== "setting-up" && j.key !== "entries") expect(c.phase, `${name}: ${j.key} on ${c.label}`).not.toBe("setup");
  // Four phases, in order, and the count is of the current stop's phase.
  expect(tr.phases.map((p) => p.key), name).toEqual(["setup", "draw", "day", "after"]);
  expect(trackCount(tr), name).toMatch(/^(Set up|Tee times|Draw|Play|Results) · \d+ of \d+ done$/);
  // The dashboard's press is the same job.
  const press = cardPressOf(t.status.nextAction, j);
  if (j.moves) expect(press.kind === "move" && press.action, name).toBe(t.status.nextAction);
  else if (j.action && j.enabled) expect(press, name).toMatchObject({ kind: "link", label: j.action, href: j.href });
  else expect(press.kind, name).toBe("none");
  // And What's next's first line for it, when it has one, is the same job (the home never lists a
  // completed tournament: `secretaryHomeFor` leaves them out).
  const home = t.status.step === "completed" ? undefined : whatsNext({ tournaments: [t], today, locale: "en-GB" })[0];
  if (home) {
    expect(home.key, `${name}: the home's first line`).toBe(j.key);
    if (j.key !== "launch" && j.key !== "results") expect(home.action, name).toBe(j.action);
  }
}

describe("every shape renders sensibly, at every stage", () => {
  for (const { name, f, over } of everyStage()) {
    it(name, () => invariants(name, jobFacts(f, over)));
  }

  it("a knockout is drawn, everything else gets tee times; three flights read as one track", () => {
    const ko = see(launched(FAMILY_FIXTURES.flightedKnockout()));
    expect(ko.track.phases[1].title).toBe("Draw");
    expect(ko.track.steps.find((s) => s.key === "draw")?.label).toBe("The draw");
    expect(ko.track.steps.filter((s) => s.phase === "day")).toHaveLength(1);
    const cup = see(FAMILY_FIXTURES.teamCup());
    expect(cup.track.phases[1].title).toBe("Tee times");
    expect(cup.track.steps.filter((s) => s.phase === "day").map((s) => s.label)).toEqual(["Round 1", "Round 2"]);
    const league = see(launched(FAMILY_FIXTURES.league()));
    expect(league.track.steps.filter((s) => s.phase === "day")).toHaveLength(3);
  });
});

/* ------------------------------------------------- generated tournaments */

/** A small deterministic generator (mulberry32), so a failure names its seed. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("agreement over generated tournaments", () => {
  it("1,000 tournaments: the stepper, the dashboard and What's next give one job", () => {
    const families = FAMILIES.filter((f) => f !== "casual");
    for (let seed = 1; seed <= 1000; seed++) {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
      let f: TournamentFacts = { ...FAMILY_FIXTURES[pick(families)](), startOn: pick(["", "2026-11-21", "2026-11-28", "2027-02-01"]), endOn: "" };
      f = { ...f, endOn: f.startOn, confirmed: pick([0, 1, 2, 12]), dated: r() > 0.15, moneyAnswered: r() > 0.3, groups: pick([0, 1, 3]) };
      const status = pick(["draft", "live", "live", "completed"]);
      f = { ...f, status };
      f = {
        ...f,
        rounds: f.rounds.map((x) => {
          const played = status !== "draft" && r() > 0.4;
          return { ...x, hasResult: played, closed: played && r() > 0.4, scheduled: r() > 0.2, matches: x.drawsPairings && r() > 0.3 ? 6 : x.matches };
        }),
        review: { pendingConfirmations: r() > 0.8 ? 1 : 0, disputed: r() > 0.9 ? 1 : 0 },
      };
      // As the screens read them: the tee sheet opens on the next round not played; the board shows the
      // round in play, or the last one.
      const unplayed = f.rounds.find((x) => !x.hasResult && !x.closed);
      const inPlay = f.rounds.find((x) => !x.closed) ?? f.rounds[f.rounds.length - 1];
      const firstId = inPlay?.id ?? "r1";
      const over: Partial<TournamentJobFacts> = {
        awaitingApproval: r() > 0.8 ? 1 : 0,
        disputed: r() > 0.85 ? 1 : 0,
        nextSheet: unplayed && r() > 0.5 ? sheet(unplayed.id, unplayed.label, pick(["2026-11-20", "2026-11-28", "2027-01-10"]), r() > 0.5) : null,
        board: r() > 0.5 ? board({ roundId: firstId, round: inPlay?.label ?? "Round 1", closed: !!inPlay?.closed, day: pick(["2026-11-19", "2026-11-20", "2026-11-28"]), started: pick([0, 5, 24]), certified: pick([0, 5, 24]) }) : null,
      };
      invariants(`seed ${seed} (${tournamentStatus(f).family}, ${status})`, jobFacts(f, over));
    }
  });
});

/* ------------------------------------------------------------- the switch */

describe("the switch", () => {
  it("is off until Ajay's OK; ?stepper=1 previews it, and nothing else does", () => {
    expect(LIFECYCLE_STEPPER_ON).toBe(false);
    expect(stepperShown("?stepper=1")).toBe(true);
    expect(stepperShown("?view=timeline&stepper=1")).toBe(true);
    expect(stepperShown("")).toBe(false);
    expect(stepperShown("?view=timeline")).toBe(false);
    expect(stepperShown("?stepper=0")).toBe(false);
  });

  it("is open on the dashboard always, on Tournament details only while setting up, folded elsewhere", () => {
    expect(stepperOpenOn("/dashboard", "live")).toBe(true);
    expect(stepperOpenOn("/event", "setting-up")).toBe(true);
    expect(stepperOpenOn("/event", "live")).toBe(false);
    expect(stepperOpenOn("/entry", "setting-up")).toBe(false);
  });

  it("a card handed no job at all presses the machine's next action (the old contract)", () => {
    const st = tournamentStatus(launched(medal({ rounds: [r1({ hasResult: true }), r2()] })));
    expect(cardPressOf(st.nextAction)).toEqual({ kind: "move", action: st.nextAction, text: "" });
  });
});

describe("the dashboard's button follows the job for everyone, switch or no switch (the PM, 10 Nov)", () => {
  it("the dashboard hands its card the job unconditionally — never behind the stepper's switch", () => {
    const page = readSource("src/app/(app)/dashboard/page.tsx");
    expect(page).toMatch(/const job = await openTournamentJob\(session\.eventId, state\.today\);/);
    expect(page).toMatch(/<LifecycleBar[\s\S]*?job=\{job\}/);
    expect(page, "the dashboard's job is behind the stepper's switch again").not.toMatch(/stepperShown/);
    // CONTROL: the matcher sees the switched version this file once had.
    expect("const job = stepperShown(x) ? await openTournamentJob(session.eventId, state.today) : undefined;").toMatch(/stepperShown/);
  });

  it("with the switch OFF, a live tournament never offers Complete as the card's button", () => {
    expect(LIFECYCLE_STEPPER_ON).toBe(false);
    const day1 = launched(medal({ rounds: [r1({ hasResult: true }), r2()] }));
    const st = tournamentStatus(day1);
    expect(st.nextAction?.kind, "CONTROL: the machine itself offers Complete here").toBe("complete");
    for (const over of [{ board: board() }, { board: board(), disputed: 1 }, { board: board({ started: 24, certified: 24 }) }, {}]) {
      const job = tournamentJob(jobFacts(day1, over), "2026-11-28", day)!;
      const press = cardPressOf(st.nextAction, job);
      expect(press.kind === "move" && press.action.kind === "complete", `${job.key}: Complete is the card's button while live`).toBe(false);
    }
  });
});

describe("ending early: behind More, while golf remains to be played (the PM, 10 Nov)", () => {
  const offered = (f: TournamentFacts, over: Partial<TournamentJobFacts> = {}, today = TODAY) => {
    const st = tournamentStatus(f);
    return endEarlyOf(st, tournamentJob(jobFacts(f, over), today, day));
  };

  it("offered before the first card, with cards still out, and between rounds — the machine's own Complete", () => {
    const before = launched(medal());
    expect(offered(before)).toEqual(tournamentStatus(before).nextAction);
    const day1 = launched(medal({ rounds: [r1({ hasResult: true }), r2()] }));
    expect(offered(day1, { board: board() }, "2026-11-28")).toEqual(tournamentStatus(day1).nextAction);
    const between = launched(medal({ rounds: [r1({ hasResult: true, closed: true }), r2()] }));
    const early = offered(between);
    expect(early).toEqual(tournamentStatus(between).nextAction);
    // Its confirm names the round nobody has played (`completingCheckFor`).
    expect(early?.asks).toMatch(/Round 2/);
  });

  it("every card in Round 1 with Round 2 still to play: still offered; with no round left to play: not", () => {
    const allIn = launched(medal({ rounds: [r1({ hasResult: true }), r2()] }));
    expect(offered(allIn, { board: board({ started: 24, certified: 24 }) }, "2026-11-28")).not.toBeNull();
    const oneRound = launched(facts({ rounds: [r1({ hasResult: true })] }));
    const job = tournamentJob(jobFacts(oneRound, { board: board({ started: 12, certified: 12, total: 12 }) }), "2026-11-28", day)!;
    expect(job.key).toBe("close");
    expect(endEarlyOf(tournamentStatus(oneRound), job), "closing the round is the job; then Complete is the button").toBeNull();
  });

  it("never once play is over (Complete is the card's one filled button) or completed", () => {
    const over = playedOut(medal());
    const job = tournamentJob(jobFacts(over), TODAY, day)!;
    expect(cardPressOf(tournamentStatus(over).nextAction, job)).toMatchObject({ kind: "move", action: { kind: "complete" } });
    expect(endEarlyOf(tournamentStatus(over), job)).toBeNull();
    const done = completed(medal());
    expect(endEarlyOf(tournamentStatus(done), tournamentJob(jobFacts(done), TODAY, day))).toBeNull();
  });

  it("refused as Complete is refused: the same refusal and way out", () => {
    const nothing = launched(medal());
    const early = offered(nothing)!;
    expect(early.enabled).toBe(false);
    expect(early.disabledBecause).toBe(tournamentStatus(nothing).refusals.complete);
  });
});

/* ------------------------------------------- the dashboard is never a dead end */

describe("the card always has the press the tournament needs (found by #1081's round)", () => {
  it("results in on a tournament never launched, with a dispute and cards out: Launch is the button AND the home's first line", () => {
    // Set up, Round 1 already being scored a day ago, a result disputed (D2, D5). The home used to put
    // "Settle it" and the cards first by their earlier day, and its "Launch tournament" line sent the
    // secretary to a dashboard whose one button was "Settle it": nothing there launched it.
    const played = medal({ rounds: [r1({ hasResult: true }), r2()] });
    const t = jobFacts(played, { board: board({ day: "2026-11-19" }), disputed: 1 });
    expect(t.status.step, "CONTROL: still setting up").toBe("setting-up");
    expect(t.status.underWayUnlaunched).toBe(true);
    const job = tournamentJob(t, TODAY, day)!;
    expect(job.key).toBe("launch");
    expect(cardPressOf(t.status.nextAction, job)).toMatchObject({ kind: "move", action: { kind: "launch" } });
    const home = whatsNext({ tournaments: [t], today: TODAY, locale: "en-GB" });
    expect(home.map((j) => j.key)).toEqual(["launch", "settle", "cards"]);
  });

  it("a live tournament with no playing round has no golf left: the machine's Complete is the card's button", () => {
    const t = jobFacts(launched(facts({ rounds: [] })));
    expect(t.status.step, "CONTROL: the machine calls it live").toBe("live");
    expect(t.status.nextAction?.kind, "CONTROL: and offers Complete").toBe("complete");
    const job = tournamentJob(t, TODAY, day)!;
    expect(job.moves, "Play is under way with no button and no More: nothing completes it").toBe(true);
    expect(cardPressOf(t.status.nextAction, job)).toMatchObject({ kind: "move", action: { kind: "complete" } });
    expect(endEarlyOf(t.status, job), "nothing to end early: Complete is the button").toBeNull();
    // CONTROL: one round still to play keeps Complete off the card.
    const one = jobFacts(launched(facts({ rounds: [r1()] })));
    expect(tournamentJob(one, TODAY, day)!.moves).toBe(false);
  });
});
