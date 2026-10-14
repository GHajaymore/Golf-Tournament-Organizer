import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FORMAT_NAMES, findFormat, needsTeams, isManualFormat } from "../formats";
import { STAGE_TYPES, isHeadToHead, roundIsStroke } from "../stage-types";
import { individualAllowanceFor, roundTakesAllowance } from "../round-allowance";
import { allowanceSaid } from "../domain/allowance-words";
import { tournamentTerms } from "../rules";
import { readSource } from "./source";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
// A "use server" module pulls in Prisma; the component only holds a reference until a press.
function actionModule() {
  return new Proxy({}, { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) }) as Record<string, unknown>;
}
vi.mock("@/app/actions/teams", actionModule);

/**
 * AN INDIVIDUAL NET ROUND SAYS ITS ALLOWANCE, AND A COMMITTEE CAN CHANGE IT.
 *
 * Rules of Handicapping, Appendix C: individual stroke play and Stableford at
 * 95% for a field of thirty or more, and a committee may play a smaller field
 * at 100%. A team round has had the control on its card for months. An
 * individual round had none: `Stage.handicapAllowance` was honoured wherever a
 * card is priced and no screen could set it, while the organizer's guide said
 * it could be changed "under Handicaps for this round" — the panel that sets
 * one PLAYER's handicap. Found 2026-10-13 by correcting that sentence.
 *
 * Three things are held here:
 *
 *   which rounds have the line   every format on every kind of round; the line
 *                                 is offered exactly where the board honours it
 *   what the line says           the same sentence the team panel says, from
 *                                 one function
 *   what a player is told        the rules sheet states the allowance on every
 *                                 individual net round, not only a changed one
 *
 * WHAT IT CANNOT SEE: that pressing Save re-scores the board. That is
 * `e2e/round-allowance.spec.ts`, which holds the board to the Rules at 95% and
 * at 100% from the stored cards.
 */

const TYPES: string[] = [...STAGE_TYPES];
const BASES = ["gross", "net", "both", "stableford"];
const INDIVIDUAL = ["Stroke Play", "Stableford", "Modified Stableford"];
const line = (format: string, type: string, scoringBasis: string, handicapAllowance = 0) =>
  individualAllowanceFor({ format, type, scoringBasis, handicapAllowance });

describe("which rounds have an allowance line of their own", () => {
  it("CONTROL: the three individual formats exist, and so do rounds that are matches", () => {
    for (const f of INDIVIDUAL) expect(FORMAT_NAMES).toContain(f);
    expect(TYPES).toContain("Stroke Play Round");
    expect(TYPES.some((t) => isHeadToHead(t))).toBe(true);
  });

  it("a net medal, a Stableford and a Modified Stableford, at 95%", () => {
    expect(line("Stroke Play", "Stroke Play Round", "net")).toEqual({ allowance: 95, recommended: 95, overridden: false });
    expect(line("Stroke Play", "Stroke Play Round", "both")).toEqual({ allowance: 95, recommended: 95, overridden: false });
    // Stableford is always off handicap, whatever "result calculation" is stored beside it.
    for (const basis of BASES) {
      expect(line("Stableford", "Stroke Play Round", basis), basis).toEqual({ allowance: 95, recommended: 95, overridden: false });
      expect(line("Modified Stableford", "Stroke Play Round", basis), basis).toEqual({ allowance: 95, recommended: 95, overridden: false });
    }
  });

  it("the committee's own figure, said to be theirs", () => {
    expect(line("Stroke Play", "Stroke Play Round", "net", 100)).toEqual({ allowance: 100, recommended: 95, overridden: true });
    expect(line("Stableford", "Stroke Play Round", "stableford", 90)).toEqual({ allowance: 90, recommended: 95, overridden: true });
    // Typed, and the usual figure: still theirs.
    expect(line("Stroke Play", "Stroke Play Round", "net", 95)).toEqual({ allowance: 95, recommended: 95, overridden: true });
  });

  it("not a gross medal, which gives no strokes", () => {
    expect(line("Stroke Play", "Stroke Play Round", "gross")).toBeNull();
    expect(line("Stroke Play", "Stroke Play Round", " Gross ")).toBeNull();
  });

  it("no team format, no match, no bet and no round scored by hand — on any kind of round", () => {
    // A round robin played at stroke play returns cards and is scored by the
    // stroke board, off the same resolver — so it has the line too. What has
    // none is a round whose result is a MATCH.
    expect(line("Stroke Play", "Round Robin", "net")).toEqual({ allowance: 95, recommended: 95, overridden: false });
    expect(line("Match Play", "Round Robin", "net")).toBeNull();
    // A kind of round nobody has taught the app about is offered nothing.
    expect(line("Stroke Play", "Qualifier", "net")).toBeNull();
    expect(line("Stroke Play", "", "net")).toBeNull();
    const offered: string[] = [];
    for (const format of FORMAT_NAMES) {
      for (const type of TYPES) {
        for (const basis of BASES) {
          if (line(format, type, basis)) offered.push(`${format} · ${type} · ${basis}`);
        }
      }
    }
    // Every cell that has the line is one of the three individual formats on a round whose result is strokes.
    for (const cell of offered) {
      const [format, type] = cell.split(" · ");
      expect(INDIVIDUAL, cell).toContain(format);
      expect(roundIsStroke(type, format), cell).toBe(true);
      expect(needsTeams(format), cell).toBe(false);
      expect(isManualFormat(format), cell).toBe(false);
    }
    expect(offered).toContain("Stroke Play · Stroke Play Round · net");
    expect(offered.some((c) => c.startsWith("Four-Ball"))).toBe(false);
    expect(offered.some((c) => c.startsWith("Skins") || c.startsWith("Nassau") || c.startsWith("Match Play"))).toBe(false);
    // And the formats left out are left out for a reason that is true of them.
    expect(findFormat("Skins").engine).toBe("skins");
    expect(findFormat("Other (scored by hand)").engine).toBe("stroke");
    expect(isManualFormat("Other (scored by hand)")).toBe(true);
  });
});

describe("what the server accepts is what a screen offers", () => {
  const takes = (format: string, type: string, scoringBasis: string) => roundTakesAllowance({ format, type, scoringBasis, handicapAllowance: 0 });

  it("a team round by its panel, an individual net round by its line, and nothing else", () => {
    for (const format of FORMAT_NAMES) {
      for (const type of TYPES) {
        for (const basis of BASES) {
          const offered = needsTeams(format) || line(format, type, basis) !== null;
          expect(takes(format, type, basis), `${format} · ${type} · ${basis}`).toBe(offered);
        }
      }
    }
    expect(takes("Four-Ball", "Round Robin", "net")).toBe(true);
    expect(takes("Stroke Play", "Stroke Play Round", "net")).toBe(true);
    expect(takes("Stroke Play", "Stroke Play Round", "gross")).toBe(false);
    expect(takes("Match Play", "Round Robin", "net")).toBe(false);
    expect(takes("Skins", "Stroke Play Round", "net")).toBe(false);
  });

  it("and the action asks that question before it stores a figure", () => {
    const src = readSource("src/app/actions/teams.ts");
    const body = src.slice(src.indexOf("export async function setStageAllowance("), src.indexOf("export async function setStageCountBest("));
    expect(body.length).toBeGreaterThan(200);
    const refuses = body.indexOf("!roundTakesAllowance(current)");
    const writes = body.indexOf("prisma.stage.update(");
    expect(refuses, "the action does not ask whether the round takes an allowance").toBeGreaterThan(0);
    expect(writes).toBeGreaterThan(refuses);
  });
});

describe("what the line says", () => {
  it("the Rules' figure, the committee's, the committee's when it is also the Rules', and a convention", () => {
    expect(allowanceSaid({ allowance: 95, recommended: 95, overridden: false, isConvention: false })).toBe(" — the recommended allowance for this format.");
    expect(allowanceSaid({ allowance: 100, recommended: 95, overridden: true, isConvention: false })).toBe(" — set by your committee, in place of the usual 95%.");
    expect(allowanceSaid({ allowance: 95, recommended: 95, overridden: true, isConvention: false })).toBe(" — set by your committee; it is also the usual figure for this format.");
    expect(allowanceSaid({ allowance: 85, recommended: 85, overridden: false, isConvention: true })).toBe(" — the common club convention for this format, not a published standard.");
    expect(allowanceSaid({ allowance: 40, recommended: 25, overridden: true, isConvention: false, replacesSplit: true })).toBe(" — set by your committee, in place of the split below.");
  });

  it("is drawn with its figure, its sentence, the field-size note and a Change button", async () => {
    const { RoundAllowance } = await import("@/components/RoundAllowance");
    const html = renderToStaticMarkup(<RoundAllowance stageId="s1" info={{ allowance: 95, recommended: 95, overridden: false }} />);
    expect(html).toContain("Handicap allowance");
    expect(html).toContain("95%");
    expect(html).toContain("the recommended allowance for this format.");
    expect(html).toContain("Change");
    // The explanation is behind the i, which says what it explains.
    expect(html).toContain("the handicap allowance");
    const src = readSource("src/components/RoundAllowance.tsx");
    expect(src).toContain("for a field of thirty or more");
    expect(src).toContain("a committee may play at 100%");
    // The box is not there until somebody asks for it.
    expect(html).not.toContain("Handicap allowance percent");

    const theirs = renderToStaticMarkup(<RoundAllowance stageId="s1" info={{ allowance: 100, recommended: 95, overridden: true }} />);
    expect(theirs).toContain("set by your committee, in place of the usual 95%.");
  });

  it("both panels take the sentence from the one function", () => {
    for (const file of ["src/components/RoundAllowance.tsx", "src/components/RoundTeamScoring.tsx"]) {
      const src = readSource(file);
      expect(src, file).toContain("allowanceSaid({");
      expect(src, file).not.toContain("the recommended allowance for this format");
      expect(src, file).not.toContain("it is also the usual figure for this format");
    }
  });

  it("the Rounds screen draws it from the rule, and only where the rule gives one", () => {
    expect(readSource("src/app/(app)/stages/page.tsx")).toContain("allowance: individualAllowanceFor(s),");
    const screen = readSource("src/components/StagesClient.tsx");
    expect(screen).toContain("{stage.allowance && (");
    expect(screen).toContain("<RoundAllowance stageId={stage.id} info={stage.allowance} locked={locked} />");
  });
});

describe("what a player is told on the rules sheet", () => {
  const terms = (over: Partial<Parameters<typeof tournamentTerms>[0]>) =>
    tournamentTerms({
      format: "Stroke Play",
      type: "Stroke Play Round",
      holes: 18,
      scoringBasis: "net",
      handicapAllowance: 0,
      countBest: 0,
      tiebreakers: [],
      cutAfter: null,
      carryForwardEnabled: false,
      carryForwardPct: 0,
      ...over,
    }).find((t) => t.label === "Handicap allowance")?.value;

  it("a medal at the usual figure says 95%, which it used not to say at all", () => {
    expect(terms({})).toBe("95% of course handicap");
    expect(terms({ format: "Stableford", scoringBasis: "stableford" })).toBe("95% of course handicap");
  });

  it("a committee's figure is said to be the committee's", () => {
    expect(terms({ handicapAllowance: 100 })).toBe("100% of course handicap, set by the committee");
  });

  it("a gross medal says nothing about an allowance", () => {
    expect(terms({ scoringBasis: "gross" })).toBeUndefined();
  });

  it("a team round says its figure when a committee has set one, as before", () => {
    expect(terms({ format: "Foursomes" })).toBeUndefined();
    expect(terms({ format: "Foursomes", handicapAllowance: 60 })).toBe("60% of course handicap");
  });
});
