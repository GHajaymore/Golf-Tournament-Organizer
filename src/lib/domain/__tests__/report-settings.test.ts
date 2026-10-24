import { describe, expect, it } from "vitest";
import {
  NAME_WITHHELD,
  amountsShownTo,
  publicName,
  reportAmountsOf,
  reportOpenToPublic,
  reportSettingsLine,
  reportVisibilityOf,
  withholdNames,
} from "../report-settings";

/**
 * THE REPORT'S SETTINGS AND A PLAYER'S PUBLIC NAME (2026-10-24), worked by hand.
 */

describe("who can open the report", () => {
  it("is never more public than the board", () => {
    expect(reportOpenToPublic(true, "board")).toBe(true);
    expect(reportOpenToPublic(true, "players")).toBe(false);
    expect(reportOpenToPublic(false, "board")).toBe(false);
    expect(reportOpenToPublic(false, "players")).toBe(false);
  });

  it("reads anything unknown as the default, and the default is the rule before the setting", () => {
    expect(reportVisibilityOf(undefined)).toBe("board");
    expect(reportVisibilityOf("everybody")).toBe("board");
    expect(reportAmountsOf(undefined)).toBe("players");
    expect(reportAmountsOf("all")).toBe("players");
  });
});

describe("who sees an amount", () => {
  const table = (s: string) => (["staff", "player", "public"] as const).map((a) => amountsShownTo(a, s));
  it("players: the organizer and the field; the public sees the winners", () => expect(table("players")).toEqual([true, true, false]));
  it("none: the organizer's copy only", () => expect(table("none")).toEqual([true, false, false]));
  it("everyone: the public link too", () => expect(table("everyone")).toEqual([true, true, true]));
  it("unset is 'players'", () => expect(table("")).toEqual([true, true, false]));
});

describe("the line beside Share", () => {
  it("says the settings in words, and the board's limit", () => {
    expect(reportSettingsLine(true, "board", "players")).toBe("Anyone with the board link can see this report · Side-game amounts: players only");
    expect(reportSettingsLine(false, "board", "everyone")).toBe(
      "Only the players in this tournament can see this report · Side-game amounts: everyone with the link",
    );
    expect(reportSettingsLine(true, "players", "none")).toBe("Only the players in this tournament can see this report · Side-game amounts: nobody — winners only");
  });

  it("never says closed, private or locked", () => {
    for (const b of [true, false]) for (const v of ["board", "players"]) for (const a of ["players", "none", "everyone"]) {
      expect(reportSettingsLine(b, v, a)).not.toMatch(/closed|private|lock/i);
    }
  });
});

describe("a player's public name", () => {
  it("is the one reader of the flag", () => {
    expect(publicName({ name: "Ann Lee", publicNameWithheld: true })).toBe(NAME_WITHHELD);
    expect(publicName({ name: "Ann Lee", publicNameWithheld: false })).toBe("Ann Lee");
    expect(publicName({ name: "Ann Lee" })).toBe("Ann Lee");
  });

  it("is withheld in every string of a surface's data — whole, and as the ladder shortens it", () => {
    const data = {
      lead: [{ names: ["Ann Lee", "Bob Roe"], how: "ahead of Ann Lee on countback" }],
      hero: { rows: [{ name: "Ann Lee" }], caption: "Ann Lee led after every round." },
      svg: "Ann L. · Bob R.",
      n: 3,
      flag: true,
      none: null,
    };
    const out = withholdNames(data, ["Ann Lee"]);
    expect(JSON.stringify(out)).not.toMatch(/Ann/);
    expect(out.lead[0].names).toEqual([NAME_WITHHELD, "Bob Roe"]);
    expect(out.hero.caption).toBe(`${NAME_WITHHELD} led after every round.`);
    expect(out.svg).toBe(`${NAME_WITHHELD} · Bob R.`);
    expect([out.n, out.flag, out.none]).toEqual([3, true, null]);
    // Control: with nobody withheld, nothing changes.
    expect(withholdNames(data, [])).toEqual(data);
  });

  it("matches a whole name only, longest first: Ann Lee is not Ann Leech", () => {
    expect(withholdNames("Ann Leech beat Ann Lee", ["Ann Lee"])).toBe(`Ann Leech beat ${NAME_WITHHELD}`);
    expect(withholdNames("Ann Leech beat Ann Lee", ["Ann Lee", "Ann Leech"])).toBe(`${NAME_WITHHELD} beat ${NAME_WITHHELD}`);
    // A name with a character a pattern would read as syntax.
    expect(withholdNames("Jo (Jr.) Smith won", ["Jo (Jr.) Smith"])).toBe(`${NAME_WITHHELD} won`);
  });
});
