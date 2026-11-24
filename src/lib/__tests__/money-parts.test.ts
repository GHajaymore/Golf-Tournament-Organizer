import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import { groupGamesMovedTo } from "../domain/group-games-door";
import { mergesShown, MOVES, type ScreenKey } from "../domain/console-merges";
import { canAccessScreen, type Role } from "../roles";
import { screenAppliesToMatch } from "../nav";
import { potStatusLine } from "../domain/pot-status";
import {
  OFFER_CONTROLS,
  SETTLE_CONTROLS,
  SETTLE_ON_THE_PLAYERS_SCREEN,
  SETTLE_ON_WINNERS_AND_MONEY,
  fieldGamesHome,
  moneyPartOf,
  moneyPartProblems,
  moneyScreenOf,
  moneyScreenProblems,
  prizeTableHalf,
} from "../domain/money-parts";

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

  /** Every exported action of the money files, plus the prize actions of tournament.ts (the files `every-lock-scope-is-asked` classifies, without the cup). */
  const moneyActions = (srcs: Record<string, string>): string[] => {
    const out: string[] = [];
    for (const f of ["contests.ts", "skins.ts", "side-games.ts", "money-setup.ts", "expenses.ts", "bet-name.ts"]) {
      for (const m of (srcs[f] ?? "").matchAll(/export async function (\w+)\(/g)) out.push(m[1]);
    }
    for (const m of (srcs["tournament.ts"] ?? "").matchAll(/export async function (\w*Prize\w*)\(/g)) out.push(m[1]);
    return out.filter((n) => n !== "setOrgMoneyMode");
  };
  const unplaced = (names: string[]) => names.filter((n) => !(OFFER_CONTROLS as readonly string[]).includes(n) && !(SETTLE_CONTROLS as readonly string[]).includes(n));

  it("no money action is in NEITHER part (a new ledger action that asks no lock is placed too)", () => {
    const names = moneyActions(sources);
    expect(names.length, "no money actions found: this test is reading nothing").toBeGreaterThan(25);
    expect(unplaced(names)).toEqual([]);
  });

  it("CONTROL: a planted money action nobody placed is found", () => {
    const planted = { ...sources, "expenses.ts": `${sources["expenses.ts"]}\nexport async function zzPlantedLedgerAction() {}` };
    expect(unplaced(moneyActions(planted))).toEqual(["zzPlantedLedgerAction"]);
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
  const gamesPage = readSource("src", "components", "money", "GroupGames.tsx");

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
    const to = prizesPage.indexOf("<SettleHalf");
    expect(from).toBeGreaterThan(-1);
    for (const m of prizesPage.matchAll(/<(SkinsPotClient|ContestsClient)\b/g)) {
      expect(m.index!, `${m[1]} is mounted on Prizes outside the field-games guard`).toBeGreaterThan(from);
      expect(m.index!).toBeLessThan(to);
      // …and the guard is IN ITS OWN condition, the lines just before the mount (not some other mount's).
      expect(prizesPage.slice(Math.max(0, m.index! - 160), m.index!), `${m[1]} on Prizes is not behind fieldGamesHere`).toContain("fieldGamesHere");
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

/**
 * WINNERS & MONEY, THE SETTLE HALF (R8b). Each control is drawn on ONE screen once it is shown, each mount is behind the one
 * boolean (`shown.has("money")`), and the groups' own games are drawn once for each person in each state.
 */
describe("every money control is drawn on exactly one screen (R8b)", () => {
  const ALL = [...OFFER_CONTROLS, ...SETTLE_CONTROLS] as string[];

  it("the two settle-screen lists have no control twice, in both, or empty", () => {
    expect(moneyScreenProblems(SETTLE_ON_WINNERS_AND_MONEY, SETTLE_ON_THE_PLAYERS_SCREEN)).toEqual([]);
  });

  it("CONTROL: a planted control on both screens, listed twice or empty is caught", () => {
    expect(moneyScreenProblems([...SETTLE_ON_WINNERS_AND_MONEY, "addExpense"], SETTLE_ON_THE_PLAYERS_SCREEN)).toEqual([
      "addExpense is drawn on Winners & money and on the player's screen",
    ]);
    expect(moneyScreenProblems([...SETTLE_ON_WINNERS_AND_MONEY, "recordSettlement"], [])).toEqual(["a control is listed twice for Winners & money"]);
    expect(moneyScreenProblems([""], [])).toEqual(["an empty control for Winners & money"]);
  });

  it("every control has a screen, and only a settle control is drawn off Prizes & side games", () => {
    for (const c of ALL) expect(["prizes", "money", "player"], c).toContain(moneyScreenOf(c));
    for (const c of OFFER_CONTROLS) expect(moneyScreenOf(c), `${c} is offered and must be drawn on Prizes & side games`).toBe("prizes");
    for (const c of SETTLE_ON_WINNERS_AND_MONEY) expect(moneyScreenOf(c), c).toBe("money");
    for (const c of SETTLE_ON_THE_PLAYERS_SCREEN) expect(moneyScreenOf(c), c).toBe("player");
    expect(() => moneyScreenOf("notAControl")).toThrow(/no part/);
  });

  it("the controls drawn on Winners & money are the ones its components import, and no page draws a second copy", () => {
    const component = (name: string) => readSource("src", "components", `${name}.tsx`);
    const drawnBy: Record<string, string> = {
      setPrizeWinner: "PrizesClient",
      addFundLine: "FloatClient",
      removeFundLine: "FloatClient",
      recordSettlement: "OrganizerLedger",
      removeSettlement: "OrganizerLedger",
    };
    for (const c of SETTLE_ON_WINNERS_AND_MONEY) {
      expect(drawnBy[c], `${c} has no component named for it here`).toBeTruthy();
      expect(component(drawnBy[c]), `${drawnBy[c]} does not draw ${c}`).toMatch(new RegExp(`\\b${c}\\b`));
    }
    // The settle components reach a page only through `SettleHalf` and the prize table's `settle` half.
    const half = readSource("src", "components", "money", "SettleHalf.tsx");
    for (const c of ["SkinsSeason", "FloatClient", "OrganizerLedger"]) expect(half, `${c} is not drawn by SettleHalf`).toContain(`<${c}`);
    for (const page of ["prizes", "money"]) {
      const src = readSource("src", "app", "(app)", page, "page.tsx");
      for (const c of ["<FloatClient", "<OrganizerLedger", "<SkinsSeason"]) expect(src, `${page} draws ${c} on its own, a second copy of the settle half`).not.toContain(c);
    }
  });
});

describe("Winners & money's settle half is mounted once, by one boolean (R8b)", () => {
  const prizesPage = readSource("src", "app", "(app)", "prizes", "page.tsx");
  const moneyPage = readSource("src", "app", "(app)", "money", "page.tsx");
  const gamesPage = readSource("src", "app", "(app)", "group-games", "page.tsx");

  it("prizeTableHalf: Winners & money draws the winners, Prizes the lines, and the old screen the whole table", () => {
    expect(prizeTableHalf("money", true)).toBe("settle");
    expect(prizeTableHalf("prizes", true)).toBe("offer");
    expect(prizeTableHalf("prizes", false)).toBe("both");
    // Whatever the switch, a prize's winner picker is on one screen and its amount box on one screen.
    for (const moneyShown of [false, true]) {
      const halves = [prizeTableHalf("prizes", moneyShown), ...(moneyShown ? [prizeTableHalf("money", true)] : [])];
      const winnerScreens = halves.filter((h) => h !== "offer");
      const amountScreens = halves.filter((h) => h !== "settle");
      expect(winnerScreens.length, `moneyShown=${moneyShown}: a winner picker on ${winnerScreens.length} screens`).toBe(1);
      expect(amountScreens.length, `moneyShown=${moneyShown}: an amount box on ${amountScreens.length} screens`).toBe(1);
    }
  });

  it("Prizes reads the settle half only while it draws it, and mounts SettleHalf once behind that", () => {
    expect(prizesPage).toContain('const moneyShown = shown.has("money");');
    expect(prizesPage).toMatch(/const settle = moneyShown\s*\? null\s*: await settleHalfFor\(/);
    expect((prizesPage.match(/<SettleHalf\b/g) ?? []).length).toBe(1);
    expect(prizesPage).toMatch(/\{settle && \(\s*<SettleHalf/);
    expect(prizesPage).toContain('part={prizeTableHalf("prizes", moneyShown)}');
  });

  it("Winners & money opens on the switch's own guard, draws each half once, and asks the same readers", () => {
    expect(moneyPage).toMatch(/const session = await requireScreen\("prizes"\);\s*const shown = await screensShownFor\(session\);\s*if \(!shown\.has\("money"\)\) redirect\("\/prizes"\);/);
    expect((moneyPage.match(/<PrizesClient\b/g) ?? []).length).toBe(1);
    expect(moneyPage).toContain('part={prizeTableHalf("money", true)}');
    expect((moneyPage.match(/<SettleHalf\b/g) ?? []).length).toBe(1);
    expect(moneyPage).toMatch(/<GroupGames session=\{session\} round=\{params\.round\} asSection\b/);
    expect(moneyPage).toContain("settleHalfFor(");
    expect(moneyPage).toContain("prizeFieldFor(state)");
    expect(prizesPage).toContain("prizeFieldFor(state)");
    // The statement of how money works is above what it decides, here as on Prizes.
    for (const after of ["<PrizesClient", "<SettleHalf", "<GroupGames"]) expect(moneyPage.indexOf("<MoneyModeLine"), after).toBeLessThan(moneyPage.indexOf(after));
  });

  it("outside the groups' section, the money page offers no control to change what is offered", () => {
    for (const offer of OFFER_CONTROLS) expect(moneyPage, `Winners & money mentions the offer control ${offer}`).not.toMatch(new RegExp(`\\b${offer}\\b`));
    for (const c of ["<MoneySetup", "<SkinsPotClient", "<ContestsClient"]) expect(moneyPage, `${c} is mounted on Winners & money, a second copy of the offer's card`).not.toContain(c);
  });

  it("the groups' games are drawn once for every person and state of the switch, by the rules that decide it", () => {
    const BUILD = mergesShown("stepper=1&build=1", { owner: false }, "development");
    const OFF = new Set<ScreenKey>();
    for (const role of ["admin", "assistant", "player"] as Role[]) {
      for (const casual of [false, true]) {
        for (const shown of [OFF, BUILD]) {
          // `/group-games` draws its body unless the one rule (`relocate`) says the door moved.
          const bodyOnOldDoor = groupGamesMovedTo(role, casual, shown) === null;
          // `/money` is opened by the REAL gates: `requireScreen("prizes")` (the role's access; a casual round is sent to its one screen),
          // its switch guard, and then the same rule. Nothing here restates the rule's own conditions.
          const moneyOpens = shown.has("money") && canAccessScreen(role, "prizes") && (screenAppliesToMatch("prizes") || !casual);
          const sectionOnMoney = moneyOpens && groupGamesMovedTo(role, false, shown) !== null;
          const mounts = (bodyOnOldDoor ? 1 : 0) + (sectionOnMoney ? 1 : 0);
          const canSee = canAccessScreen(role, "group-games");
          expect(mounts, `role=${role} casual=${casual} money shown=${shown.has("money")}: the groups' games are drawn ${mounts} times`).toBe(canSee ? 1 : 0);
        }
      }
    }
  });

  it("CONTROL: the rule is the MOVES row, and loosening it (a casual round let through) is seen", () => {
    const BUILD = mergesShown("stepper=1&build=1", { owner: false }, "development");
    expect(groupGamesMovedTo("admin", false, BUILD)).toMatch(/^\/money/);
    expect(groupGamesMovedTo("admin", true, BUILD)).toBeNull();
    expect(groupGamesMovedTo("player", false, BUILD)).toBeNull();
    expect(groupGamesMovedTo("admin", false, new Set<ScreenKey>())).toBeNull();
    const row = MOVES.find((m) => m.from === "/group-games");
    expect(row?.notCasual, "the MOVES row no longer keeps a casual round on its one screen").toBe(true);
  });

  it("/group-games opens (200) and points at the section, asking the rule; /money gates the section on the same rule", () => {
    expect(gamesPage).toMatch(/groupGamesMovedTo\(session\.viewRole, isMatch\(event\?\.shape\), shown, params\.round\)/);
    expect(gamesPage).not.toMatch(/redirect\(/);
    expect(gamesPage).toContain("<GroupGames session={session} round={params.round} asSection={false} />");
    expect(moneyPage).toMatch(/const groupsHere = groupGamesMovedTo\(session\.viewRole, false, shown, params\.round\) !== null;/);
    expect(moneyPage).toMatch(/\{groupsHere \? \(\s*<GroupGames /);
  });

  it("says how far the field's pots and contests have got, in stored counts", () => {
    expect(potStatusLine({ contests: 3, contestsWithWinner: 2, stakes: 12, stakesPaid: 5 })).toBe("2 of 3 contests have a winner. 5 of 12 stakes paid.");
    expect(potStatusLine({ contests: 1, contestsWithWinner: 0, stakes: 1, stakesPaid: 1 })).toBe("0 of 1 contest has a winner. 1 of 1 stake paid.");
    expect(potStatusLine({ contests: 0, contestsWithWinner: 0, stakes: 0, stakesPaid: 0 })).toBe("No contests or stakes have been set up yet.");
    // A count of rows, not an amount: the line has no currency or decimal figure.
    expect(potStatusLine({ contests: 3, contestsWithWinner: 2, stakes: 12, stakesPaid: 5 })).not.toMatch(/[$£€]|\d\.\d/);
    expect(moneyPage).toContain("potStatusLine(await potStatusFor(session.eventId))");
  });
});
