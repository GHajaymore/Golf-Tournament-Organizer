import { describe, it, expect } from "vitest";
import { tournamentStatus } from "@/lib/domain/tournament-status";
import type { TournamentFacts, TournamentStatus } from "@/lib/domain/tournament-status";
import { FAMILIES, FAMILY_FIXTURES, facts, launched, round } from "@/lib/domain/__tests__/tournament-facts-fixtures";
import { SETUP_FIELDS, markOf } from "@/lib/domain/setup-field";
import type { FieldKey } from "@/lib/domain/setup-field";

/**
 * "REQUIRED BEFORE LAUNCH" IS WHAT LAUNCH REFUSES, and nothing else (R1a).
 *
 * A mark on a field is a promise about the Launch button. Walk every family through every opening move
 * (one thing wrong with an otherwise ready tournament) and hold the field registry to the machine both
 * ways: whatever holds launch is marked on some field, and nothing is marked that does not hold.
 */

type Move = { name: string; apply: (f: TournamentFacts) => TournamentFacts };

const MOVES: Move[] = [
  { name: "ready as it is", apply: (f) => f },
  { name: "a missing card", apply: (f) => ({ ...f, missingCards: [{ stageId: f.rounds[0].id, label: "Round 1", course: "A course" }] }) },
  { name: "no course at all", apply: (f) => ({ ...f, missingCards: [{ stageId: f.rounds[0].id, label: "Round 1", course: "" }] }) },
  { name: "a round that cannot be scored", apply: (f) => ({ ...f, rounds: f.rounds.map((r, i) => (i === 0 ? { ...r, scorable: false } : r)) }) },
  { name: "the first round unscheduled", apply: (f) => ({ ...f, rounds: f.rounds.map((r, i) => (i === 0 ? { ...r, scheduled: false } : r)) }) },
  {
    name: "a second round unscheduled",
    apply: (f) => ({ ...f, rounds: [...f.rounds, round({ id: "zz-extra", position: f.rounds.length, scheduled: false })] }),
  },
  { name: "nobody entered", apply: (f) => ({ ...f, confirmed: 0 }) },
  { name: "no dates", apply: (f) => ({ ...f, dated: false }) },
  { name: "an undrawn round robin", apply: (f) => ({ ...f, rounds: f.rounds.map((r, i) => (i === 0 ? { ...r, drawsPairings: true, matches: 0 } : r)) }) },
  { name: "no rounds", apply: (f) => ({ ...f, rounds: [] }) },
];

const KEYS = Object.keys(SETUP_FIELDS) as FieldKey[];

/** What the registry marks required-before-launch in this status. */
function marked(st: TournamentStatus): FieldKey[] {
  return KEYS.filter((k) => markOf(k, st, "x", null) === "required-before-launch");
}

const cases = FAMILIES.flatMap((family) =>
  MOVES.map((m) => {
    const f = m.apply(FAMILY_FIXTURES[family]());
    return { label: `${family} / ${m.name}`, f, st: tournamentStatus(f) };
  }),
);

describe("a mark is what launch refuses", () => {
  it("walks every family through every opening move", () => {
    expect(cases.length).toBe(FAMILIES.length * MOVES.length);
    // Control: the walk does reach states that hold launch.
    expect(cases.filter((c) => c.st.refusals.launch !== null).length).toBeGreaterThan(10);
  });

  it("(a) every step and need that holds launch is marked on at least one field", () => {
    const missed: string[] = [];
    for (const c of cases) {
      const on = new Set(marked(c.st));
      for (const s of c.st.setup.steps.filter((s) => s.holds)) {
        const has = KEYS.some((k) => {
          const h = SETUP_FIELDS[k].holder as { step?: string } | null;
          return h !== null && h.step === s.key && on.has(k);
        });
        if (!has) missed.push(`${c.label}: step ${s.key}`);
      }
      for (const r of c.st.rounds) {
        for (const n of r.needs.filter((n) => n.holds)) {
          const has = KEYS.some((k) => {
            const h = SETUP_FIELDS[k].holder as { need?: string } | null;
            return h !== null && h.need === n.key && on.has(k);
          });
          if (!has) missed.push(`${c.label}: need ${n.key}`);
        }
      }
    }
    expect(missed, `a hold with no field to carry its mark:\n${missed.join("\n")}`).toEqual([]);
  });

  it("(b) no field is marked unless its holder holds", () => {
    const wrong: string[] = [];
    for (const c of cases) {
      for (const k of marked(c.st)) {
        const h = SETUP_FIELDS[k].holder as { step?: string; need?: string } | null;
        const holds =
          h !== null &&
          ((h.step !== undefined && c.st.setup.steps.some((s) => s.key === h.step && s.holds)) ||
            (h.need !== undefined && c.st.rounds.some((r) => r.needs.some((n) => n.key === h.need && n.holds))));
        if (!holds) wrong.push(`${c.label}: ${k}`);
      }
    }
    expect(wrong, `marked required with nothing holding launch:\n${wrong.join("\n")}`).toEqual([]);
  });

  it("(b) a two-round medal's undated Round 2 is never required before launch", () => {
    const f = MOVES[5].apply(FAMILY_FIXTURES.stroke());
    const st = tournamentStatus(f);
    const need = st.rounds.flatMap((r) => r.needs).find((n) => n.key === "date");
    expect(need, "the fixture must carry the undated round's need").toBeDefined();
    expect(need?.holds).toBe(false);
    expect(markOf("roundDate", st, "", null)).toBeNull();
  });

  it("(c) whenever launch is refused, at least one field is required", () => {
    // A casual round is created live, so its "refusal" is only "already launched": not a set-up state.
    const silent = cases
      .filter((c) => c.st.step === "setting-up" && c.st.refusals.launch !== null && marked(c.st).length === 0).map((c) => `${c.label}: ${c.st.refusals.launch}`);
    expect(silent, `launch refused with no field marked:\n${silent.join("\n")}`).toEqual([]);
  });

  it("nothing is required before launch once it has launched", () => {
    for (const family of FAMILIES) {
      const st = tournamentStatus(launched(MOVES[1].apply(FAMILY_FIXTURES[family]())));
      expect(marked(st), family).toEqual([]);
    }
  });

  it("control: a plain ready tournament marks nothing", () => {
    expect(marked(tournamentStatus(facts()))).toEqual([]);
  });
});
