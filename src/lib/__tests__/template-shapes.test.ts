import { describe, it, expect } from "vitest";
import {
  TOURNAMENT_TEMPLATES,
  TEMPLATE_GROUPS,
  templateGroup,
  suggestedFor,
} from "../tournament-templates";
import { GOLF_FORMATS } from "../formats";
import { isHeadToHead } from "../stage-types";
import { readSource } from "./source";

/**
 * TEMPLATES NAMED FOR THE SHAPE, NOT FOR THE AUDIENCE.
 *
 * They were called "Society or league round" and "Charity or company day",
 * and both were wrong about the golf their audience plays. A society picking
 * the template with its own name on it got a match-play round robin, where
 * every player is drawn against every other; the individual Stableford a
 * society outing actually is sat under a name for charities. A four-person
 * scramble — what most charity and company days in America play — was not
 * offered at all, on the stale grounds that team formats had "no team model
 * behind them", which stopped being true when `services/teams.ts` was built.
 *
 * And a list of audiences reads as a classification. A list of shapes cannot:
 * nobody reads eleven shapes and concludes those are the only eleven.
 */

const NAME_BY_KEY = new Map(TOURNAMENT_TEMPLATES.map((t) => [t.key, t.name]));

describe("what the templates are called", () => {
  it("never names an audience", () => {
    /**
     * Absence, which is the comment-proof direction. Each of these is a kind
     * of ORGANIZER, and every one of them plays more than one format — which
     * is exactly why naming a template after them put the wrong golf behind
     * the right label.
     */
    const audiences = [/society/i, /charity/i, /company/i, /member-guest/i, /club championship/i];
    for (const t of TOURNAMENT_TEMPLATES) {
      for (const a of audiences) {
        expect(t.name, `${t.key} is named for an audience`).not.toMatch(a);
      }
    }
  });

  it("offers the shapes the common events actually are", () => {
    /**
     * The events a club, society, league, charity or company day runs, the
     * world over — not one country's habits. Stableford is the club format in
     * Britain, Ireland and Australia; the scramble is what American charity
     * golf plays; foursomes and greensomes are staples outside the US and were
     * missing entirely.
     */
    const formats = TOURNAMENT_TEMPLATES.flatMap((t) => t.rounds.map((r) => r.format));
    for (const f of ["Stroke Play", "Match Play", "Four-Ball", "Foursomes", "Greensomes", "Scramble", "Skins"]) {
      expect(formats, `no starting point plays ${f}`).toContain(f);
    }
    // And the Stableford one is a scoring basis on a medal round, not a
    // format — `Stableford` is deliberately not playable as a format.
    expect(TOURNAMENT_TEMPLATES.some((t) => t.rounds.some((r) => r.scoringBasis === "stableford"))).toBe(true);
  });

  it("only starts formats the app can actually play", () => {
    // A template promising a format nothing implements is a promise that
    // breaks on the first tee — the reason the scramble was withheld in the
    // first place, back when it was true.
    const playable = new Set(GOLF_FORMATS.filter((f) => f.playable).map((f) => f.name));
    for (const t of TOURNAMENT_TEMPLATES) {
      for (const r of t.rounds) {
        expect(playable, `${t.key} starts an unplayable format`).toContain(r.format);
      }
    }
  });
});

describe("how the picker groups them", () => {
  it("puts every template under a heading the picker renders", () => {
    for (const t of TOURNAMENT_TEMPLATES) {
      expect(TEMPLATE_GROUPS, `${t.key}`).toContain(templateGroup(t));
    }
  });

  it("reads the heading off the format's own side size", () => {
    // Derived, not a second list kept beside the first. Four-ball is a pair;
    // a scramble is four; a medal is on your own.
    expect(templateGroup(NAME_LOOKUP("four-ball"))).toBe("In pairs");
    expect(templateGroup(NAME_LOOKUP("foursomes"))).toBe("In pairs");
    expect(templateGroup(NAME_LOOKUP("scramble-day"))).toBe("In teams");
    expect(templateGroup(NAME_LOOKUP("club-championship"))).toBe("On their own");
  });

  it("gives the blank one no heading, because it is not a kind of golf", () => {
    expect(templateGroup(NAME_LOOKUP("custom"))).toBe("");
  });
});

function NAME_LOOKUP(key: string) {
  const t = TOURNAMENT_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`no template ${key} — ${[...NAME_BY_KEY.keys()].join(", ")}`);
  return t;
}

describe("what is suggested first", () => {
  it("suits a single round with one-round shapes", () => {
    const keys = suggestedFor("single").map((t) => t.key);
    expect(keys).toContain("charity-day"); // individual Stableford
    expect(keys).toContain("scramble-day");
    expect(keys).toContain("four-ball");
    // Not the league round: a round robin needs a season to mean anything.
    expect(keys).not.toContain("league-round");
  });

  it("suits a season with the round robin and the sequences", () => {
    const keys = suggestedFor("series").map((t) => t.key);
    expect(keys).toContain("league-round");
    expect(keys).toContain("member-guest-rr");
  });

  it("suits a knockout with the head-to-head shapes, singles and pairs alike", () => {
    /**
     * Read off the round TYPE rather than the format string. Asking whether
     * the format was literally "Match Play" excluded the four-ball knockout —
     * one of the commonest club championships there is — because its format is
     * "Four-Ball". `isHeadToHead` is what the rest of the app decides this
     * with.
     */
    const keys = suggestedFor("knockout").map((t) => t.key);
    expect(keys).toContain("league-round"); // singles match play
    expect(keys).toContain("member-guest"); // four-ball pairs
    for (const k of keys) {
      expect(isHeadToHead(NAME_LOOKUP(k).rounds[0].type), `${k} is not head to head`).toBe(true);
    }
  });

  it("suggests nothing until the shape question is answered", () => {
    // The group simply does not render, rather than heading an empty list.
    expect(suggestedFor("")).toEqual([]);
  });

  it("never suggests the blank one", () => {
    for (const shape of ["single", "series", "knockout"]) {
      expect(suggestedFor(shape).some((t) => t.blank), shape).toBe(false);
    }
  });

  it("suggests rather than filters — everything stays reachable", () => {
    /**
     * A knockout organizer who wants to start from a medal and add a bracket
     * is not doing anything wrong. The suggested group is a shortcut to the
     * top of the list, never a gate on the rest of it.
     */
    const src = readSource("src", "components", "CreateFirstTournament.tsx");
    expect(src).toMatch(/suggested\.length > 0 && \(/);
    // The full grouped list is rendered unconditionally beside it.
    expect(src).toMatch(/TEMPLATE_GROUPS\.map\(/);
    expect(src).toMatch(/TOURNAMENT_TEMPLATES\.filter\(\(t\) => templateGroup\(t\) === group\)/);
  });
});

describe("the picker's own words", () => {
  it("offers a starting point rather than asking for a classification", () => {
    /**
     * "What kind of tournament?" over a list of eleven asks the newcomer to
     * classify their event against a set that cannot be complete — so an
     * organizer whose event is not on it concludes the app does not run it.
     * The returning organizer's switcher has always said "Start from".
     */
    const src = readSource("src", "components", "CreateFirstTournament.tsx");
    expect(src).toMatch(/<label>Start from<\/label>/);
    expect(src).not.toMatch(/What kind of tournament\?/);
    // And it says plainly that nothing here is binding.
    expect(src).toMatch(/starting point only/i);
  });
});
