import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import { OFFER_CONTROLS, SETTLE_CONTROLS, moneyPartOf, moneyPartProblems, fieldGamesHome } from "../domain/money-parts";

/**
 * THE TWO HALVES OF MONEY, AND WHERE A FIELD'S GAMES ARE OFFERED (R8a).
 *
 * Every money control is in exactly ONE part, offer (before play) or settle (after the result): held here to the server
 * actions themselves, so a control cannot be named that is not one, and an action that asks the `money` lock cannot be left
 * out of the offer. A field's pots and contests are mounted ONCE: `fieldGamesHome` is the one answer, and both pages read it.
 */

const ACTIONS = "src/app/actions";
const sources = Object.fromEntries(readdirSync(ACTIONS).filter((f) => f.endsWith(".ts")).map((f) => [f, readSource(`${ACTIONS}/${f}`)]));
const all = Object.values(sources).join("\n");

/** The body of each exported action, by name. */
function bodies(): Map<string, string> {
  const out = new Map<string, string>();
  for (const src of Object.values(sources)) {
    const heads = [...src.matchAll(/export async function (\w+)\(/g)];
    heads.forEach((m, i) => out.set(m[1], src.slice(m.index!, i + 1 < heads.length ? heads[i + 1].index! : undefined)));
  }
  return out;
}

describe("every money control is in exactly one part", () => {
  it("the lists have no control twice, in both, or empty", () => {
    expect(moneyPartProblems(OFFER_CONTROLS, SETTLE_CONTROLS)).toEqual([]);
  });

  it("CONTROL: a planted control in both parts, or listed twice, is caught", () => {
    expect(moneyPartProblems([...OFFER_CONTROLS, "addExpense"], SETTLE_CONTROLS)).toEqual(["addExpense is in both parts"]);
    expect(moneyPartProblems([...OFFER_CONTROLS, "addPrize"], SETTLE_CONTROLS)).toEqual(["addPrize is listed twice in offer"]);
    expect(moneyPartProblems(["", "x"], [])).toEqual(["an empty control in offer"]);
  });

  it("answers for each control, and refuses one nobody placed", () => {
    for (const c of OFFER_CONTROLS) expect(moneyPartOf(c), c).toBe("offer");
    for (const c of SETTLE_CONTROLS) expect(moneyPartOf(c), c).toBe("settle");
    expect(() => moneyPartOf("notAControl")).toThrow(/no part/);
  });

  it("each control is a real server action (a renamed action leaves no ghost behind)", () => {
    const names = new Set(bodies().keys());
    for (const c of [...OFFER_CONTROLS, ...SETTLE_CONTROLS]) expect(names.has(c), `${c} is not an exported action`).toBe(true);
  });

  it("an action that asks the money lock is in the offer; one in the settle half never does", () => {
    // `setSkinsEntrants` asks `money` only to START a pot by naming its entrants (docs/claude/lock-scopes.md); changing who is in a pot that exists is the ledger's.
    const startsAPot = new Set(["setSkinsEntrants"]);
    const asksMoney = [...bodies()].filter(([, b]) => /refuseIfLocked\(\s*[\w.]+,\s*"money"/.test(b)).map(([n]) => n).filter((n) => !startsAPot.has(n));
    expect(asksMoney.length, "no action asks the money lock: this test is reading nothing").toBeGreaterThan(10);
    for (const n of asksMoney) expect(OFFER_CONTROLS as readonly string[], `${n} asks the money lock and is not in the offer part`).toContain(n);
    for (const c of SETTLE_CONTROLS) {
      if (startsAPot.has(c)) continue;
      expect(bodies().get(c), `${c} is the ledger's and must not ask the money lock`).not.toMatch(/refuseIfLocked\(\s*[\w.]+,\s*"money"/);
    }
  });

  it("changing how money is handled deletes nothing (the line on Prizes says a change keeps the prize list and side games)", () => {
    const body = bodies().get("setEventMoneyMode")!;
    expect(body).toMatch(/prisma\.event\.update\(/);
    expect(body).not.toMatch(/\.delete(Many)?\(/);
    expect(all).toContain("export async function setEventMoneyMode(");
  });
});

describe("a field's pots and contests are mounted once", () => {
  const prizesPage = readSource("src", "app", "(app)", "prizes", "page.tsx");
  const gamesPage = readSource("src", "app", "(app)", "group-games", "page.tsx");

  it("a tournament offers them on Prizes; a casual round keeps them on its one screen, whichever screens are shown", () => {
    for (const casual of [false, true]) {
      const homes = [fieldGamesHome({ casual }) === "prizes", fieldGamesHome({ casual }) === "group-games"];
      expect(homes.filter(Boolean).length, `casual=${casual}: the field's games have ${homes.filter(Boolean).length} homes`).toBe(1);
    }
    expect(fieldGamesHome({ casual: false })).toBe("prizes");
    expect(fieldGamesHome({ casual: true })).toBe("group-games");
  });

  it("both pages ask that one answer, and every field-level mount is behind it", () => {
    expect(prizesPage).toContain('fieldGamesHome({ casual: isMatch(state.event.shape) }) === "prizes"');
    expect(gamesPage).toContain('fieldGamesHome({ casual }) === "group-games"');
    // Prizes: every pot and contest mount sits between the first fieldGamesHere guard and the season's skins that follows them.
    const from = prizesPage.indexOf("fieldGamesHere && week && perPlayerPotRefusal");
    const to = prizesPage.indexOf("<SkinsSeason");
    expect(from).toBeGreaterThan(-1);
    for (const m of prizesPage.matchAll(/<(SkinsPotClient|ContestsClient)\b/g)) {
      expect(m.index!, `${m[1]} is mounted on Prizes outside the field-games guard`).toBeGreaterThan(from);
      expect(m.index!).toBeLessThan(to);
    }
    expect((prizesPage.match(/fieldGamesHere &&/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // Group games: the field's pot, its side games and the "Add a game" fold are the casual round's, asked as the same boolean.
    expect((gamesPage.match(/fieldGamesHere &&/g) ?? []).length).toBe(3);
    expect(gamesPage).not.toMatch(/\{casual && week/);
  });

  it("how money works is mounted once: at the top, folded, on the new screen; at the foot on the old one", () => {
    expect((prizesPage.match(/<MoneySetup\b/g) ?? []).length).toBe(1);
    expect(prizesPage).toMatch(/\{newScreen && moneySetup && \(\s*<SectionFold/);
    expect(prizesPage).toMatch(/\{!newScreen && moneySetup && \(/);
  });
});
