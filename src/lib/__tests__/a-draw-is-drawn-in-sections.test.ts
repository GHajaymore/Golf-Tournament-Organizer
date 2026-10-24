import { describe, it, expect } from "vitest";
import { buildBracket, roundLabels, bracketSizeFor, flightKind, type BracketView } from "@/lib/domain/bracket";
import {
  drawSections,
  layoutSection,
  isByeTie,
  playerPath,
  sectionOfPlayer,
  drawPlayers,
  type DrawSection,
} from "@/lib/domain/bracket-layout";
import type { Player } from "@/lib/domain/types";

/**
 * A DRAW IS DRAWN IN SECTIONS, AND NO TIE IS LOST OR DRAWN TWICE BETWEEN THEM.
 *
 * Ajay, 2026-10-23, after a knockout of 129 drew as one page 16,341px tall: "we
 * need to show entire bracket … including tabs based on the QF, SF, F". His
 * panel decided the tabs (docs/bracket-panel-2026-10-23.md): Quarters 1–4 over
 * 32 places, Top and Bottom half for 17–32, none for 16 or fewer, plus Finals
 * (quarter-finals to the final) and the Whole draw.
 *
 * What this holds, for every field size the panel named and three flights, in
 * twelve random orders of results and with a result taken back:
 *
 *   - the tabs together are the whole draw, each tie EXACTLY once — the one
 *     exception counted explicitly: a quarter-final is the last round of its
 *     quarter and the first of Finals, so it is in both;
 *   - "Whole draw" holds every tie, and no tab holds a bye;
 *   - each tie is drawn midway between the two ties that feed it, no two ties of
 *     a column overlap, and every line runs from a feeder to the place it fills;
 *   - every seed who had a bye is marked so, once, on their first real tie;
 *   - a player found is found on a tab that holds their latest tie.
 *
 * Shape and count are cheap to satisfy (CLAUDE.md, the combination sweep, point
 * 6), so the centring is asserted as a VALUE — the mean of the two feeders —
 * and the mutation of each rule is recorded in the PR.
 */

const GAP = 1;
const SIZES = [1, 2, 3, 5, 8, 12, 16, 17, 31, 32, 33, 64, 65, 100, 128, 129, 256];

const field = (n: number, tag = "p"): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${tag}${i + 1}`, name: `Seed ${tag}${i + 1}`, handicap: i, seed: i + 1 }));

/** A repeatable source of order: the same seed is the same sequence. */
function chooser(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

/** Every state a draw passes through when its ties are played in a random order, with one result taken back on the way. */
function* playedAtRandom(kind: Parameters<typeof buildBracket>[0], players: Player[], seed: number): Generator<BracketView> {
  const pick = chooser(seed);
  const winners: Record<string, string> = {};
  let view = buildBracket(kind, players, winners);
  yield view;
  let cleared = false;
  for (let step = 0; step < players.length * 2; step += 1) {
    const ready = view.rounds.flatMap((r) => r.matches).filter((m) => !m.winnerId && m.a.playerId && m.b.playerId);
    if (ready.length === 0) break;
    const m = ready[pick(ready.length)];
    winners[m.key] = pick(2) === 0 ? m.a.playerId! : m.b.playerId!;
    view = buildBracket(kind, players, winners);
    yield view;
    // Half way through, a committee takes a result back.
    if (!cleared && Object.keys(winners).length === Math.max(1, Math.floor(players.length / 2))) {
      cleared = true;
      const keys = Object.keys(winners);
      delete winners[keys[pick(keys.length)]];
      view = buildBracket(kind, players, winners);
      yield view;
    }
  }
}

function allTies(view: BracketView) {
  return view.rounds.flatMap((r) => r.matches);
}

function expectSections(view: BracketView, sections: DrawSection[], at: string) {
  const ties = allTies(view);
  const real = ties.filter((m) => !isByeTie(m)).map((m) => m.key);
  const whole = sections.find((s) => s.key === "whole")!;
  expect(sections[sections.length - 1].key, `${at}: the whole draw is the last tab`).toBe("whole");
  expect([...whole.keys].sort(), `${at}: the whole draw is every tie but the byes`).toEqual([...real].sort());

  const places = 2 ** view.rounds.length;
  const parts = sections.filter((s) => s.key !== "whole");
  if (places <= 16) {
    expect(parts, `${at}: a draw of ${places} places has no tabs`).toEqual([]);
    return;
  }
  expect(parts.map((s) => s.label), at).toEqual(
    places > 32
      ? ["Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4", "Finals"]
      : ["Top half", "Bottom half", "Finals"],
  );
  // Each tie exactly once across the tabs — a quarter-final exactly twice.
  const qfRound = view.rounds.length - 3;
  const count = new Map<string, number>();
  for (const s of parts) for (const k of s.keys) count.set(k, (count.get(k) ?? 0) + 1);
  // (Collected and asserted once: twelve million `expect` calls is a slow way to say "none".)
  const wrong = ties
    .filter((m) => (count.get(m.key) ?? 0) !== (isByeTie(m) ? 0 : m.roundIndex === qfRound ? 2 : 1))
    .map((m) => `${m.key} (${view.rounds[m.roundIndex].label}) is on ${count.get(m.key) ?? 0} tabs`);
  expect(wrong, at).toEqual([]);
  // A quarter-final is in Finals and in the one quarter (or half) above it.
  const finals = new Set(parts.find((s) => s.key === "finals")!.keys);
  expect(view.rounds[qfRound].matches.filter((m) => !finals.has(m.key)).map((m) => m.key), at).toEqual([]);
  // The number on each tab is its ties with no result.
  const byKey = new Map(ties.map((m) => [m.key, m]));
  expect(
    sections.map((s) => s.toPlay),
    at,
  ).toEqual(sections.map((s) => s.keys.filter((k) => !byKey.get(k)!.winnerId).length));
}

function expectLayout(view: BracketView, s: DrawSection, at: string) {
  const layout = layoutSection(view, s.keys, GAP);
  const boxes = layout.columns.flatMap((c) => c.ties);
  const where = `${at} · ${s.label}`;
  // Exactly the section's ties, each once, and never a bye.
  expect(boxes.map((b) => b.match.key).sort(), where).toEqual([...s.keys].sort());
  expect(boxes.some((b) => isByeTie(b.match)), `${where}: a bye was drawn as a box`).toBe(false);
  // Columns in round order, none empty, the first the first round with a real tie in the section.
  const rounds = layout.columns.map((c) => c.roundIndex);
  expect(rounds, where).toEqual([...rounds].sort((a, b) => a - b));
  expect(layout.columns.every((c) => c.ties.length > 0), where).toBe(true);
  if (boxes.length) {
    const byKey = new Map(allTies(view).map((m) => [m.key, m]));
    expect(rounds[0], where).toBe(Math.min(...s.keys.map((k) => byKey.get(k)!.roundIndex)));
  }

  const y = new Map(boxes.map((b) => [b.match.key, b.y]));
  const inSection = new Set(s.keys);
  let fedPlaces = 0;
  const wrong: string[] = [];
  for (const b of boxes) {
    const r = b.match.roundIndex;
    const k = b.match.key;
    // Inside the sheet: a tie is two seats tall.
    if (b.y - 1 < -1e-9 || b.y + 1 > layout.height + 1e-9) wrong.push(`${k} is off the sheet at ${b.y} of ${layout.height}`);
    if (r === 0) {
      if (b.a.bye || b.b.bye) wrong.push(`${k}, a first-round tie, is marked as coming off a bye`);
      continue;
    }
    const fa = view.rounds[r - 1].matches[b.match.matchIndex * 2];
    const fb = view.rounds[r - 1].matches[b.match.matchIndex * 2 + 1];
    const drawnA = inSection.has(fa.key) && !isByeTie(fa);
    const drawnB = inSection.has(fb.key) && !isByeTie(fb);
    fedPlaces += Number(drawnA) + Number(drawnB);
    // Midway between the two ties that feed it — a value, not a shape.
    if (drawnA && drawnB && Math.abs(b.y - (y.get(fa.key)! + y.get(fb.key)!) / 2) > 1e-9) {
      wrong.push(`${k} at ${b.y} is not midway between its feeders at ${y.get(fa.key)} and ${y.get(fb.key)}`);
    }
    // Marked "bye" exactly where the place was filled off a bye IN A ROUND THAT IS
    // DRAWN — never for skipping a preliminary round, which a draw sheet does not mark.
    const prelim = preliminaryByTheDraw(view);
    const byeA = isByeTie(fa) && !prelim;
    const byeB = isByeTie(fb) && !prelim;
    if (b.a.bye !== byeA) wrong.push(`${k} place A: bye mark ${b.a.bye}, a bye in a drawn round ${byeA}`);
    if (b.b.bye !== byeB) wrong.push(`${k} place B: bye mark ${b.b.bye}, a bye in a drawn round ${byeB}`);
    if (b.a.bye && b.b.bye) wrong.push(`${k} shows two bye marks`);
    // "Through the preliminary round" on the place a played-for preliminary tie fills.
    const throughA = prelim && r === 1 && !isByeTie(fa);
    const throughB = prelim && r === 1 && !isByeTie(fb);
    if (b.a.prelim !== throughA) wrong.push(`${k} place A: preliminary note ${b.a.prelim}, fed by a preliminary tie ${throughA}`);
    if (b.b.prelim !== throughB) wrong.push(`${k} place B: preliminary note ${b.b.prelim}, fed by a preliminary tie ${throughB}`);
  }
  expect(wrong, where).toEqual([]);
  // One line per place a drawn tie fills, from that tie to that place.
  expect(layout.connectors.length, where).toBe(fedPlaces);
  const at2 = (col: number, yy: number) => `${col}@${Math.round(yy * 1000)}`;
  const centres = new Set(boxes.map((b) => at2(b.col, b.y)));
  const seats = new Set(boxes.flatMap((b) => [at2(b.col, b.y - 0.5), at2(b.col, b.y + 0.5)]));
  for (const c of layout.connectors) {
    expect(c.toCol, where).toBe(c.fromCol + 1);
    expect(centres.has(at2(c.fromCol, c.fromY)) && seats.has(at2(c.toCol, c.toY)), `${where}: a line from nowhere or to nowhere`).toBe(true);
  }
  // No two ties of a column overlap, and neighbours keep the gap between them.
  for (const col of layout.columns) {
    const ys = col.ties.map((t) => t.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i] - ys[i - 1], `${where}: ${col.label} overlaps`).toBeGreaterThanOrEqual(2 + GAP - 1e-9);
    }
  }
}

/**
 * WHETHER THE FIRST ROUND IS A PRELIMINARY ROUND, read off the draw itself rather
 * than asked of the code: it is, when two of its byes would meet in the round after
 * it — then most of the field is merely waiting for a few extra entries to be
 * played off (129: one tie, 127 waiting), and a club calls that a preliminary
 * round and marks nobody's "bye". Otherwise it is a round of the draw, and a seed
 * with nobody to play in it had a bye in a round that is drawn (100 in a draw of
 * 128: 36 ties, 28 byes).
 */
function preliminaryByTheDraw(view: BracketView): boolean {
  if (view.rounds.length < 2) return false;
  const first = view.rounds[0].matches;
  return view.rounds[1].matches.some((_, i) => isByeTie(first[i * 2]) && isByeTie(first[i * 2 + 1]));
}

function expectByesMarkedOnce(view: BracketView, at: string) {
  const whole = drawSections(view).find((s) => s.key === "whole")!;
  const boxes = layoutSection(view, whole.keys, GAP).columns.flatMap((c) => c.ties);
  const byes = allTies(view).filter(isByeTie).length;
  const marks = boxes.reduce((n, b) => n + Number(b.a.bye) + Number(b.b.bye), 0);
  // A one-round draw (one or two players) has no bye to mark: its only tie is the final;
  // and nobody skipping a preliminary round is marked at all.
  const expected = view.rounds.length > 1 && !preliminaryByTheDraw(view) ? byes : 0;
  expect(marks, `${at}: ${byes} byes, ${marks} marked, ${expected} expected`).toBe(expected);
  expect(boxes.filter((b) => b.a.bye && b.b.bye).map((b) => b.match.key), `${at}: a tie with two bye marks`).toEqual([]);
}

function expectFound(view: BracketView, sections: DrawSection[], at: string) {
  for (const p of drawPlayers(view)) {
    const path = playerPath(view, p.id);
    const key = sectionOfPlayer(view, sections, p.id);
    if (path.length === 0) continue; // one player alone in a draw: no tie at all
    const s = sections.find((x) => x.key === key)!;
    expect(s.keys, `${at}: ${p.name} found on ${key}, which does not hold their latest tie`).toContain(path[path.length - 1]);
  }
}

describe("a draw's round names are a club's", () => {
  it("names the preliminary round, then Round 1, and never 'Round of'", () => {
    expect(roundLabels(256, 129)).toEqual([
      "Preliminary round", "Round 1", "Round 2", "Round 3", "Round 4", "Quarter-finals", "Semi-finals", "Final",
    ]);
    expect(roundLabels(256, 256)).toEqual([
      "Round 1", "Round 2", "Round 3", "Round 4", "Round 5", "Quarter-finals", "Semi-finals", "Final",
    ]);
    expect(roundLabels(8, 5)).toEqual(["Preliminary round", "Semi-finals", "Final"]);
    expect(roundLabels(8, 8)).toEqual(["Quarter-finals", "Semi-finals", "Final"]);
    // Three: seed 1 has a bye in a semi-final that is drawn (no two byes meet in the final).
    expect(roundLabels(4, 3)).toEqual(["Semi-finals", "Final"]);
    // A hundred in a draw of 128: 36 ties and 28 byes is a Round 1, not a preliminary round.
    expect(roundLabels(128, 100)).toEqual(["Round 1", "Round 2", "Round 3", "Round 4", "Quarter-finals", "Semi-finals", "Final"]);
    // Twelve in sixteen: four ties and four byes — a Round 1 with byes in it.
    expect(roundLabels(16, 12)).toEqual(["Round 1", "Quarter-finals", "Semi-finals", "Final"]);
    // Twenty in thirty-two: four ties, twelve byes — a preliminary round.
    expect(roundLabels(32, 20)[0]).toBe("Preliminary round");
    // The name agrees with the draw: a preliminary round is exactly one whose byes would meet.
    for (let n = 2; n <= 260; n += 1) {
      const isPrelim = roundLabels(bracketSizeFor(n), n)[0] === "Preliminary round";
      expect(isPrelim, `${n}`).toBe(preliminaryByTheDraw(buildBracket("winners", field(n), {})));
    }
    expect(roundLabels(2, 1)).toEqual(["Final"]);
    expect(roundLabels(2, 2)).toEqual(["Final"]);
    for (const n of SIZES) {
      for (const label of roundLabels(bracketSizeFor(n), n)) expect(label, `${n}`).not.toMatch(/Round of|Semifinals|Quarterfinals/);
    }
  });

  it("a place waiting on a tie between two known players names them, and never says Bye", () => {
    const view = buildBracket("winners", field(129), {});
    const r1 = view.rounds[1].matches[0];
    expect([r1.a.name, r1.b.name]).toEqual(["Seed p1", "Winner of Seed p128 v Seed p129"]);
    for (const rd of view.rounds.slice(1)) for (const m of rd.matches) expect([m.a.name, m.b.name]).not.toContain("Bye");
  });
});

describe("a draw is drawn in sections, and every tie is in them exactly once", () => {
  for (const n of SIZES) {
    it(`${n} ${n === 1 ? "player" : "players"}, twelve random orders of results and a result taken back`, () => {
      for (let order = 1; order <= 12; order += 1) {
        const states = [...playedAtRandom("winners", field(n), order * 7919 + n)];
        // Every state of a small draw; of a big one the first few, a stride through
        // the middle and the finished draw — the middle of a 256 is the same
        // arithmetic two hundred more times. The tabs are checked at every state
        // of a draw up to 65, and every fourth beyond.
        const stride = Math.max(1, Math.ceil(states.length / 12));
        const tabStride = n > 65 ? 4 : 1;
        states.forEach((view, i) => {
          const at = `${n} players, order ${order}, state ${i + 1} of ${states.length}`;
          const sampled = i < 3 || i % stride === 0 || i === states.length - 1;
          if (!sampled && i % tabStride !== 0) return;
          const sections = drawSections(view);
          expectSections(view, sections, at);
          if (sampled) {
            for (const s of sections) expectLayout(view, s, at);
            expectByesMarkedOnce(view, at);
            expectFound(view, sections, at);
          }
        });
        // A draw of n is n − 1 results (and one taken back and played again), so a
        // walk that stopped early has not reached the finished draw.
        expect(states.length, `${n}: the walk stopped short`).toBeGreaterThanOrEqual(Math.max(1, n));
        if (n > 1) expect(states[states.length - 1].champion, `${n}: never finished`).not.toBeNull();
      }
    }, 60_000);
  }

  it("three flights: each its own draw, its own tabs, no tie shared between them", () => {
    const sizes = [33, 17, 9];
    const views = sizes.map((n, i) => buildBracket(flightKind(i), field(n, `f${i}-`), {}));
    const seen = new Set<string>();
    views.forEach((view, i) => {
      const sections = drawSections(view);
      expectSections(view, sections, `flight ${i + 1}`);
      for (const s of sections) expectLayout(view, s, `flight ${i + 1}`);
      for (const k of sections.find((s) => s.key === "whole")!.keys) {
        expect(seen.has(k), `${k} is in two flights`).toBe(false);
        seen.add(k);
      }
    });
    expect(drawSections(views[0]).map((s) => s.key)).toEqual(["q1", "q2", "q3", "q4", "finals", "whole"]);
    expect(drawSections(views[1]).map((s) => s.key)).toEqual(["top", "bottom", "finals", "whole"]);
    expect(drawSections(views[2]).map((s) => s.key)).toEqual(["whole"]);
  });

  it("129: the preliminary tie is its own short column in the quarter that holds it, and Round 1 begins every other", () => {
    const view = buildBracket("winners", field(129), {});
    const sections = drawSections(view);
    const firsts = sections
      .filter((s) => s.key.startsWith("q"))
      .map((s) => layoutSection(view, s.keys, GAP).columns.map((c) => `${c.label}:${c.ties.length}`));
    expect(firsts[0]).toEqual(["Preliminary round:1", "Round 1:16", "Round 2:8", "Round 3:4", "Round 4:2", "Quarter-finals:1"]);
    for (const q of firsts.slice(1)) expect(q).toEqual(["Round 1:16", "Round 2:8", "Round 3:4", "Round 4:2", "Quarter-finals:1"]);
    const finals = layoutSection(view, sections.find((s) => s.key === "finals")!.keys, GAP);
    expect(finals.columns.map((c) => `${c.label}:${c.ties.length}`)).toEqual(["Quarter-finals:4", "Semi-finals:2", "Final:1"]);
    // 127 seeds through on a bye, each marked once; 128 v 129 is a real tie.
    expect(sections.find((s) => s.key === "whole")!.keys.length).toBe(128);
    // Seed 1's first real tie is in Round 1, against the winner of the preliminary tie.
    expect(sectionOfPlayer(view, sections, "p1")).toBe("q1");
    expect(sectionOfPlayer(view, sections, "p129")).toBe("q1");
    // The tab says how many are left to play.
    expect(sections.map((s) => s.toPlay)).toEqual([32, 31, 31, 31, 7, 128]);
    // Nobody is marked "bye" for not needing the preliminary round; its one place in
    // Round 1 says where its player comes from.
    const whole = layoutSection(view, sections.find((s) => s.key === "whole")!.keys, GAP).columns.flatMap((c) => c.ties);
    expect(whole.reduce((n, b) => n + Number(b.a.bye) + Number(b.b.bye), 0)).toBe(0);
    expect(whole.filter((b) => b.a.prelim || b.b.prelim).map((b) => b.match.key)).toEqual(["winners-1-0"]);
  });

  it("100 in a draw of 128: Round 1 has 36 ties, and the 28 seeds with nobody to play are marked bye in Round 2", () => {
    const view = buildBracket("winners", field(100), {});
    expect(view.rounds.map((r) => r.label)).toEqual(["Round 1", "Round 2", "Round 3", "Round 4", "Quarter-finals", "Semi-finals", "Final"]);
    const sections = drawSections(view);
    const whole = layoutSection(view, sections.find((s) => s.key === "whole")!.keys, GAP).columns.flatMap((c) => c.ties);
    const marked = whole.flatMap((b) => [b.a.bye ? b.match.a.playerId : null, b.b.bye ? b.match.b.playerId : null]).filter(Boolean);
    expect(marked.length).toBe(28);
    expect(whole.filter((b) => b.a.bye || b.b.bye).every((b) => b.match.roundIndex === 1)).toBe(true);
    // The marked are the top 28 seeds.
    expect(new Set(marked)).toEqual(new Set(field(100).slice(0, 28).map((p) => p.id)));
    expect(whole.some((b) => b.a.prelim || b.b.prelim)).toBe(false);
  });
});
