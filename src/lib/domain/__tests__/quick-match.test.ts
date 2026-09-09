import { describe, it, expect } from "vitest";
import {
  planMatch,
  parseHandicap,
  matchNeedsCard,
  matchTitle,
  exactPlayersFor,
  sidesFrom,
  QUICK_ROUND_FORMATS,
  QUICK_MONEY_GAMES,
  MAX_QUICK_STAKE,
  HANDICAP_MIN,
  HANDICAP_MAX,
} from "../quick-match";
import { GOLF_FORMATS } from "@/lib/formats";
import { resolveMatch } from "../match";
import { isMatch, capabilitiesOf, shapeOption, isTournamentShape } from "@/lib/tournament-shape";

/**
 * The whole of the decision this screen makes, asserted against VALUES.
 *
 * Shape assertions are what this file must not settle for — a plan with two
 * players and eighteen holes is satisfied by almost any wrong answer, and the
 * matrix suite has four documented cases where exactly that passed. So every
 * case below either names the number it expects or is built so the wrong
 * answer looks different from the right one.
 */
describe("planning a match", () => {
  it("takes two names and nothing else", () => {
    const r = planMatch({ players: [{ name: "Alex" }, { name: "Sam" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.players.map((p) => p.name)).toEqual(["Alex", "Sam"]);
    expect(r.plan.name).toBe("Alex v Sam");
    expect(r.plan.holes).toBe(18);
    expect(r.plan.format).toBe("Match Play");
    // Level, because nobody asked for strokes. A net match with two zeros is a
    // level match wearing the wrong label, and it is the label the card and
    // the leaderboard read.
    expect(r.plan.scoringBasis).toBe("gross");
    expect(r.plan.courseId).toBeNull();
  });

  it("refuses one player, and says what is missing", () => {
    const r = planMatch({ players: [{ name: "Alex" }, { name: "  " }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/two players/i);
  });

  it("refuses two players with the same name, and says which name", () => {
    // Not pedantry: the match is stored as A against B and read back as a name
    // on each side of a card, so two identical names produce a scorecard on
    // which no hole can be attributed. Case-insensitive, because "sam" and
    // "Sam" are one person typing quickly.
    const r = planMatch({ players: [{ name: "Sam" }, { name: "sam" }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // NAMED, which matters more the longer the list gets: "two players have
    // the same name" sends somebody hunting through eight rows for the pair.
    // As FIRST entered — "both called sam" is the spelling they did not type.
    expect(r.error).toContain("Sam");
  });

  it("catches a duplicate anywhere in the list, not just in the first two", () => {
    // The check was written for a pair and read only the pair. A fourball with
    // two Daves has exactly the same unattributable card, and the third and
    // fourth rows were where it went unnoticed.
    const r = planMatch({
      players: [{ name: "A" }, { name: "B" }, { name: "Dave" }, { name: "dave" }],
      format: "Stroke Play",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Dave");
  });

  it("refuses a third player at MATCH play, and takes them at stroke play", () => {
    /**
     * The pair of assertions is the test — either alone is satisfied by a
     * wrong rule.
     *
     * "Three is refused" alone passes the old code, which refused a third
     * player at every format. "Three is accepted" alone passes a rule that
     * dropped the two-player limit entirely, and match play between three
     * people is not a game — it is a fixture with a spare player standing on
     * the tee.
     */
    const asMatch = planMatch({
      players: [{ name: "A" }, { name: "B" }, { name: "C" }],
      format: "Match Play",
    });
    expect(asMatch.ok).toBe(false);
    if (!asMatch.ok) expect(asMatch.error).toContain("Match Play");

    const asStroke = planMatch({
      players: [{ name: "A" }, { name: "B" }, { name: "C" }],
      format: "Stroke Play",
    });
    expect(asStroke.ok).toBe(true);
    if (asStroke.ok) expect(asStroke.plan.players).toHaveLength(3);
  });

  it("gives shots only when asked, and calls that net", () => {
    const level = planMatch({ players: [{ name: "A" }, { name: "B" }], useHandicaps: false });
    const net = planMatch({ players: [{ name: "A" }, { name: "B" }], useHandicaps: true });
    expect(level.ok && level.plan.scoringBasis).toBe("gross");
    expect(net.ok && net.plan.scoringBasis).toBe("net");
    // The two answers must differ, or a passing test proves nothing about
    // which branch produced them.
    expect(level.ok && net.ok && level.plan.scoringBasis).not.toBe(net.ok && net.plan.scoringBasis);
  });

  it("only a net match needs the course's card", () => {
    expect(matchNeedsCard({ scoringBasis: "net" })).toBe(true);
    // Gross match play is the one format that genuinely needs no par and no
    // stroke index: who won the hole is not a question the card answers.
    expect(matchNeedsCard({ scoringBasis: "gross" })).toBe(false);
  });

  it("forces 'which nine' to full over eighteen holes", () => {
    // A stored "back" on an eighteen-hole round is not a preference; it is a
    // contradiction that reaches the scorecard as holes scored against the
    // wrong stroke indexes.
    const eighteen = planMatch({ players: [{ name: "A" }, { name: "B" }], holes: 18, nine: "back" });
    expect(eighteen.ok && eighteen.plan.nine).toBe("full");
    const nine = planMatch({ players: [{ name: "A" }, { name: "B" }], holes: 9, nine: "back" });
    expect(nine.ok && nine.plan.holes).toBe(9);
    expect(nine.ok && nine.plan.nine).toBe("back");
  });

  it("takes a title when given one, and names the match after the players when not", () => {
    const given = planMatch({ players: [{ name: "A" }, { name: "B" }], name: "  The Ryder Mug " });
    expect(given.ok && given.plan.name).toBe("The Ryder Mug");
    expect(matchTitle("A", "B")).toBe("A v B");
  });

  it("seeds the two players in the order they were entered", () => {
    // Seed decides which side of the card each name appears on, so it must not
    // depend on anything but the order they were typed.
    const r = planMatch({ players: [{ name: "Zed" }, { name: "Abe" }] });
    expect(r.ok && r.plan.players.map((p) => p.seed)).toEqual([1, 2]);
    expect(r.ok && r.plan.players[0].name).toBe("Zed");
  });
});

/**
 * The three structural answers, which are invisible on the screen that sets
 * the round up and decide whether it can be scored at all.
 *
 * Every one of these has a wrong answer that looks completely normal until
 * somebody finishes a round: a stroke round left at the event's default format
 * has an EMPTY leaderboard, a stroke round typed as a round robin draws
 * pairings for a game nobody is playing, and a stroke round carrying a `Match`
 * row shows a fixture that was halved before anyone teed off. None of the
 * three is visible in the plan's name, holes or format.
 */
describe("what a round type actually builds", () => {
  const plan = (format: string, players = 3) => {
    const r = planMatch({
      players: Array.from({ length: players }, (_, i) => ({ name: `P${i + 1}` })),
      format,
    });
    if (!r.ok) throw new Error(`expected a plan for ${format}: ${r.error}`);
    return r.plan;
  };

  it("builds match play as a head-to-head", () => {
    const p = plan("Match Play", 2);
    expect(p.stageType).toBe("Round Robin");
    expect(p.eventFormat).toBe("match");
    expect(p.drawsMatch).toBe(true);
  });

  it("builds a medal as cards, with no fixture and no match-format event", () => {
    for (const name of ["Stroke Play", "Modified Stableford"]) {
      const p = plan(name);
      // "Stroke Play Round" and not "Round Robin": `stage-types.ts` records
      // what the confused version did — a full set of pairings for a round in
      // which nobody plays anybody.
      expect(p.stageType, name).toBe("Stroke Play Round");
      // `isStroke` is `event.format === "stroke"` and nothing else. The stage
      // saying Stroke Play does not set it, and a round that misses this has
      // no ranked standings at all.
      expect(p.eventFormat, name).toBe("stroke");
      expect(p.drawsMatch, name).toBe(false);
    }
  });

  it("answers differently for the two, or the assertions above prove nothing", () => {
    // Both blocks pass a constant. This is the one that cannot.
    const m = plan("Match Play", 2);
    const s = plan("Stroke Play");
    expect(m.stageType).not.toBe(s.stageType);
    expect(m.eventFormat).not.toBe(s.eventFormat);
    expect(m.drawsMatch).not.toBe(s.drawsMatch);
  });

  it("takes up to eight, and sends a ninth to the tournament builder", () => {
    // Two fourballs is the most that goes out together. Past it somebody is
    // running a competition and wants a field, flights and a tee sheet.
    const eight = planMatch({
      players: Array.from({ length: 8 }, (_, i) => ({ name: `P${i + 1}` })),
      format: "Stroke Play",
    });
    expect(eight.ok).toBe(true);

    const nine = planMatch({
      players: Array.from({ length: 9 }, (_, i) => ({ name: `P${i + 1}` })),
      format: "Stroke Play",
    });
    expect(nine.ok).toBe(false);
    if (!nine.ok) expect(nine.error).toMatch(/tournament/i);
  });

  it("refuses a format it does not offer rather than quietly playing match play", () => {
    // The list is the offer. Falling back to the default here would create a
    // Match Play round for somebody who asked for a scramble, and say nothing.
    const r = planMatch({ players: [{ name: "A" }, { name: "B" }], format: "Scramble" });
    expect(r.ok).toBe(false);
  });

  it("names a multi-player round without pretending it is a match", () => {
    // "A v B v C" would be a match between three, which is not a thing.
    const p = plan("Stroke Play", 3);
    expect(p.name).not.toContain(" v ");
    expect(p.name).toContain("P1");
  });
});

/**
 * Pairs, which is the half of this screen that can write the wrong COLUMN.
 *
 * The schema is explicit that a team round leaves the player columns empty and
 * an individual round leaves the team columns empty, "deliberately not
 * repurposed … because a column whose meaning depends on the round's format is
 * the kind of thing that silently mis-joins a year later". Everything below is
 * about the plan being unambiguous enough that the action cannot get that
 * wrong.
 */
describe("a round played in pairs", () => {
  const four = (format: string, n = 4) =>
    planMatch({
      players: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}` })),
      format,
    });

  it("draws two sides from the names in the order they were entered", () => {
    const r = four("Four-Ball");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.sideSize).toBe(2);
    // Named as a pair would name itself, and NOT with a "v" — `Team.name`
    // appears on the card, the board and the entry screen, so "P1 v P2" would
    // read as a match inside a match everywhere it is shown.
    expect(r.plan.sides.map((s) => s.name)).toEqual(["P1 & P2", "P3 & P4"]);
    // Order within a side is not cosmetic: foursomes alternate who tees off.
    expect(r.plan.sides.map((s) => s.seeds)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    // And every player knows which side they are on, so nothing has to pair
    // them up a second time.
    expect(r.plan.players.map((p) => p.side)).toEqual([0, 0, 1, 1]);
    expect(r.plan.name).toBe("P1 & P2 v P3 & P4");
  });

  it("leaves an individual round with no sides at all", () => {
    const r = planMatch({ players: [{ name: "A" }, { name: "B" }], format: "Match Play" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // NOT "one side per player". The action asks `sides.length` to decide
    // whether to write teams, so a singles round carrying two one-person teams
    // would fill the fixture's TEAM columns instead of its player columns.
    expect(r.plan.sides).toEqual([]);
    expect(r.plan.sideSize).toBe(1);
    // -1, not 0. Zero is a real side, and "everybody on side 0" is a fixture
    // with four players on one team that looks plausible in the database.
    expect(r.plan.players.every((p) => p.side === -1)).toBe(true);
  });

  it("needs four for a pairs match — not two, and not three", () => {
    // A match is two sides, so a pairs match is four people. Asserting all
    // three counts, because "refuses two" alone is satisfied by a rule that
    // refuses everything.
    expect(four("Four-Ball", 2).ok).toBe(false);
    expect(four("Four-Ball", 3).ok).toBe(false);
    expect(four("Four-Ball", 4).ok).toBe(true);
    expect(four("Four-Ball", 5).ok).toBe(false);
  });

  it("says how many, and how the number was arrived at", () => {
    const r = four("Four-Ball", 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // "Four-Ball needs 4 players" is true and unhelpful the second time you
    // read it. The reason is the game: two against two.
    expect(r.error).toContain("4");
    expect(r.error).toMatch(/two against two/i);
    // And in words rather than arithmetic. Composing this sentence from
    // sideSize gave "played between two sides of 1 — that is 2 players",
    // which is correct and not English.
    expect(r.error).not.toMatch(/sides of \d/i);
  });

  it("derives the required count rather than storing it", () => {
    // The regression this replaces: `exactPlayers: 2` written by hand next to
    // match play. A second head-to-head entry needing a different number is
    // where a hand-kept figure and the rule come apart.
    for (const f of QUICK_ROUND_FORMATS) {
      expect(exactPlayersFor(f), f.name).toBe(f.headToHead ? f.sideSize * 2 : null);
    }
    expect(exactPlayersFor(QUICK_ROUND_FORMATS.find((f) => f.name === "Match Play")!)).toBe(2);
    expect(exactPlayersFor(QUICK_ROUND_FORMATS.find((f) => f.name === "Four-Ball")!)).toBe(4);
  });

  it("groups by side size and drops nobody", () => {
    expect(sidesFrom([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    // An individual round has no sides — see the plan test above.
    expect(sidesFrom([1, 2], 1)).toEqual([]);
    // A leftover player is never quietly folded into an existing side, which
    // would put three people in a pair. `planMatch` refuses the count before
    // this is ever reached; this asserts the function does not paper over it.
    expect(sidesFrom([1, 2, 3], 2)).toEqual([[1, 2]]);
  });
});

/**
 * The offer matches the catalogue.
 *
 * `Stage.format` is read back through `lookupFormat`, so a name in this list
 * that the catalogue does not carry produces a round with no engine — set up,
 * played, and with nowhere to enter a card. The catalogue is the authority;
 * this asserts the short list defers to it rather than restating it.
 */
describe("every round type on offer is a real, playable format", () => {
  it("names a playable entry in the catalogue", () => {
    for (const f of QUICK_ROUND_FORMATS) {
      const entry = GOLF_FORMATS.find((c) => c.name === f.name);
      expect(entry, `${f.name} is not in formats.ts`).toBeDefined();
      // `scored` is not enough and the catalogue says why: the two were once
      // one flag, and a picker reading "an engine exists" as "you can run
      // this" hands somebody a format with nowhere to enter a card.
      expect(entry!.playable, f.name).toBe(true);
      // The side size has to agree, or the screen takes four names for a
      // format the engine scores as singles.
      expect(entry!.sideSize, f.name).toBe(f.sideSize);
    }
  });

  it("offers both an individual and a pairs round type", () => {
    // Otherwise the grouping on the screen renders an empty heading, and the
    // assertions above are satisfied by a list with one entry in it.
    expect(QUICK_ROUND_FORMATS.some((f) => f.sideSize === 1)).toBe(true);
    expect(QUICK_ROUND_FORMATS.some((f) => f.sideSize === 2)).toBe(true);
  });
});

/**
 * Members and guests, which is the difference that decides whether a CLUB's
 * roster is written to.
 *
 * The old behaviour pushed every name typed on this screen into the club by
 * `upsertMember`, which is wrong twice: it fills a member list with people who
 * are not members, and — because a member with no email is matched BY NAME — a
 * second, different Dave entered months later lands on the first Dave's row
 * and overwrites his handicap index. The second failure is silent and corrupts
 * a real member's data.
 */
describe("picking a member, or bringing a guest", () => {
  it("carries the member through, so the round can link to the roster", () => {
    const r = planMatch({
      players: [
        { name: "Ines", memberId: "mem_1", handicap: "8.2" },
        { name: "Tobias", memberId: "mem_2", handicap: "14" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.players.map((p) => p.memberId)).toEqual(["mem_1", "mem_2"]);
  });

  it("marks a guest as a guest rather than inventing a member for them", () => {
    // "" and not null/undefined, so the action's check is a plain lookup with
    // nothing to null-juggle — and a guest is never accidentally truthy.
    const r = planMatch({ players: [{ name: "Ines", memberId: "mem_1" }, { name: "A mate" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.players[1].memberId).toBe("");
    // Both answers present, so this cannot pass on a plan that returns "" for
    // everybody — which is exactly what a dropped field would look like.
    expect(r.plan.players[0].memberId).toBe("mem_1");
  });

  it("takes a guest's handicap as readily as a member's", () => {
    // The guest is somebody's mate off 18, and a net round they are in has to
    // give them their shots. Refusing to hold a handicap for a non-member
    // would make "guest" mean "cannot play net", which is not what it means.
    const r = planMatch({ players: [{ name: "Ines", memberId: "m" }, { name: "A mate", handicap: "18.1" }] });
    expect(r.ok && r.plan.players[1].handicap).toBe(18.1);
    expect(r.ok && r.plan.players[1].memberId).toBe("");
  });
});

/**
 * The money agreed on the first tee.
 *
 * Every case here is about a wrong answer that SETTLES — a stake nobody typed,
 * a bet with no opponent, a slipped decimal — because this app records what
 * people owe each other and a wrong number here becomes a demand.
 */
describe("setting up a round with money on it", () => {
  const round = (money: { game: string; stakeCents: number } | null, format = "Match Play") =>
    planMatch({ players: [{ name: "A" }, { name: "B" }], format, money });

  it("plays for nothing unless somebody says otherwise", () => {
    // The default, and it stays the default. A setup screen that asks "how
    // much?" before anything else has made a bet the condition of playing.
    const none = round(null);
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.plan.money).toBeNull();
    // An empty choice from an untouched form is the same thing, not an error.
    const untouched = round({ game: "", stakeCents: 0 });
    expect(untouched.ok).toBe(true);
    if (untouched.ok) expect(untouched.plan.money).toBeNull();
  });

  it("carries the game and the stake through in minor units", () => {
    const r = round({ game: "skins", stakeCents: 500 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.money?.game.key).toBe("skins");
    expect(r.plan.money?.stakeCents).toBe(500);
    // Skins is its own model; the others are side games. The action branches
    // on this, so a wrong value writes the bet into the wrong table.
    expect(r.plan.money?.game.pot).toBe("skins");
  });

  it("refuses a game with no stake rather than creating a bet for nothing", () => {
    // The one combination that looks deliberate and settles to zero for
    // everybody — a pot somebody believes they are in, worth nothing.
    const r = round({ game: "skins", stakeCents: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/stake/i);
  });

  it("refuses a slipped decimal", () => {
    // Not a moral position about stakes — a Sunday game can be whatever the
    // players agree. But a typo of 50000 for 500 becomes a settle-up demanding
    // a hundred times what anybody said, recorded as fact.
    expect(round({ game: "skins", stakeCents: MAX_QUICK_STAKE }).ok).toBe(true);
    expect(round({ game: "skins", stakeCents: MAX_QUICK_STAKE + 1 }).ok).toBe(false);
  });

  it("refuses a game nobody offered", () => {
    const r = round({ game: "spread-betting", stakeCents: 500 });
    expect(r.ok).toBe(false);
  });

  it("allows a Nassau on a match and refuses one on a medal", () => {
    /**
     * A Nassau is three bets on ONE match — front nine, back nine, overall —
     * so it needs two sides to be between. On a four-person medal it names a
     * wager with no opponent in it.
     *
     * Both directions asserted: "refuses on a medal" alone passes a rule that
     * refuses Nassau everywhere, which would be removing the game rather than
     * placing it.
     */
    expect(round({ game: "nassau", stakeCents: 500 }, "Match Play").ok).toBe(true);

    const medal = planMatch({
      players: [{ name: "A" }, { name: "B" }, { name: "C" }],
      format: "Stroke Play",
      money: { game: "nassau", stakeCents: 500 },
    });
    expect(medal.ok).toBe(false);
    if (!medal.ok) expect(medal.error).toMatch(/two sides|match/i);

    // And a game that is not match-only is fine on that same medal, so the
    // refusal above is about the Nassau rather than about money on a medal.
    expect(
      planMatch({
        players: [{ name: "A" }, { name: "B" }, { name: "C" }],
        format: "Stroke Play",
        money: { game: "skins", stakeCents: 500 },
      }).ok,
    ).toBe(true);
  });

  it("only offers games the rest of the app can actually settle", () => {
    // Skins is a `SkinsPot`; the others are `SideGame` rows whose `kind` has
    // to be one the settle-up knows. A kind invented here would create a bet
    // that no engine ever resolves — money recorded and never paid out.
    const SIDE_KINDS = ["low-gross", "low-net", "birdies", "eagles", "nassau"];
    for (const g of QUICK_MONEY_GAMES) {
      if (g.pot === "side") {
        expect(SIDE_KINDS, g.key).toContain(g.kind);
      } else {
        expect(g.pot, g.key).toBe("skins");
      }
    }
  });
});

describe("reading a handicap somebody typed", () => {
  it("reads a plus-handicap as better than scratch", () => {
    // The one that matters. A +2 player is two shots BETTER than scratch, and
    // reading "+2" as 2 hands two shots to the best player in the match — a
    // wrong result that looks completely normal on the card.
    expect(parseHandicap("+2")).toBe(-2);
    expect(parseHandicap("+1.4")).toBe(-1.4);
    expect(parseHandicap("2")).toBe(2);
    // And the two readings must differ, or the assertion above is satisfied by
    // a parser that ignores the sign entirely.
    expect(parseHandicap("+2")).not.toBe(parseHandicap("2"));
  });

  it("treats an unknown handicap as zero rather than refusing", () => {
    // Half the people who play a Sunday match do not know their index, and
    // stopping the setup to demand one is the obstacle this whole path exists
    // to remove. Zero is a level match, which is what happens on the tee.
    expect(parseHandicap("")).toBe(0);
    expect(parseHandicap(null)).toBe(0);
    expect(parseHandicap("no idea")).toBe(0);
  });

  it("clamps a typo instead of allocating a stroke and a half a hole", () => {
    expect(parseHandicap("180")).toBe(HANDICAP_MAX);
    expect(parseHandicap("-99")).toBe(HANDICAP_MIN);
    expect(parseHandicap(12.44)).toBe(12.4);
  });
});

describe("a match is not a tournament", () => {
  it("is recorded as its own shape", () => {
    expect(isTournamentShape("match")).toBe(true);
    expect(isMatch("match")).toBe(true);
    expect(isMatch("series")).toBe(false);
    // An unknown value still falls back to a tournament rather than to a
    // match: guessing "match" would take a tournament's controls away.
    expect(isMatch("nonsense")).toBe(false);
    expect(isMatch(null)).toBe(false);
  });

  it("chains no rounds, so two friends are never offered a cut line", () => {
    const c = capabilitiesOf("match");
    expect(c.chainsRounds).toBe(false);
    expect(c.multipleRounds).toBe(false);
    expect(c.hasBracket).toBe(false);
    // Not the fallback's answer. `capabilitiesOf` ends in a `default` that
    // returns the series capabilities, so a missing case here would silently
    // report a match as a season.
    expect(c).not.toEqual(capabilitiesOf("series"));
  });

  it("describes itself rather than falling through to a series", () => {
    const opt = shapeOption("match");
    expect(opt.key).toBe("match");
    expect(opt.openingRound.format).toBe("Match Play");
    expect(opt.openingRound.type).not.toBe("Bracket Stage");
  });
});

describe("a match that has not been played", () => {
  it("is not finished, and is not a half", () => {
    /**
     * The column default for `Match.holes` is `"[]"`, and `resolveMatch` reads
     * an empty array as nought played out of nought remaining — a COMPLETE,
     * halved match. A match created on that default therefore arrived on the
     * dashboard already halved, already awaiting review, and already counted
     * as a result in, before either player had left the first tee.
     *
     * So the setup writes one null per hole, as every other path that creates
     * a match does. This asserts the difference between the two, because the
     * bug is invisible from the plan alone.
     */
    const asDefault = resolveMatch(JSON.parse("[]"));
    expect(asDefault.complete).toBe(true);

    const asCreated = resolveMatch(JSON.parse(JSON.stringify(new Array(18).fill(null))));
    expect(asCreated.complete).toBe(false);
    expect(asCreated.winner).toBeNull();
  });
});
