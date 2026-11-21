import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { LOCK_SCOPES } from "@/lib/domain/tournament-status";
import { readSource } from "./source";

/**
 * EVERY LOCK SCOPE THE MACHINE KNOWS IS ASKED BY SOMETHING (state machine PR L; phase 2 design, 2.3).
 *
 * The machine said `cup` was locked from launch and `money` was a scope, and for two months nothing asked either:
 * `actions/cup.ts` asked only who the caller was, and a completed tournament's prize table could be edited. A banner
 * that says "Locked" over a control that still writes is worse than no banner. This sweep is what would have caught
 * both: each of `LOCK_SCOPES` has at least one action that asks it (`refuseIfLocked`) or a rule that is the scope's
 * own (`teeSheetChangeAllowed`, `flightsOpenForChange`), and a scope added tomorrow with no asker is red the day it lands.
 *
 * It also holds the money rule Ajay ruled on 19 Nov 2026 to the files: what was OFFERED (the prize table, one prize per
 * player, a pot's and a contest's definition, the money mode) asks `money` and is shut at completion with Reopen the way
 * out; the LEDGER (who has paid, who is in, who won, the kitty, expenses, settling up, awarding a prize) asks nothing, so a
 * completed tournament can still be settled. Every exported action of the money files and the cup file is CLASSIFIED
 * below, so a new action cannot arrive without somebody saying which side it is on.
 */

const ACTIONS = "src/app/actions";
const files = readdirSync(ACTIONS).filter((f) => f.endsWith(".ts"));
const sources: Record<string, string> = Object.fromEntries(files.map((f) => [f, readSource(`${ACTIONS}/${f}`)]));

/** The scopes `refuseIfLocked` is asked for anywhere in these sources: `refuseIfLocked(eventId, "<scope>", …)`. */
export function scopesAsked(srcs: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const src of Object.values(srcs)) for (const m of src.matchAll(/refuseIfLocked\(\s*[\w.]+,\s*"(\w+)"/g)) out.add(m[1]);
  return out;
}

/**
 * The scopes with a rule of their own, which an action asks instead of `refuseIfLocked`. Each names the file the asker
 * is in and what must be there, so a rule deleted from its action is red.
 *   teeSheet: `teeSheetVerdictFor` is `teeSheetChangeAllowed` for a round (its twin in `locksOf` is held to it in
 *             `scoped-locks.test.ts`, over every step).
 *   draw:     `flightsOpenForChange` is the draw lock's own spelling (completed, or the knockout has results); the
 *             machine's `locks.draw` is drawn by the Bracket screen. A hand-written twin, not a call of the machine.
 */
const RULES: Record<string, { file: string; pattern: RegExp; what: string }> = {
  teeSheet: { file: "tee-sheet.ts", pattern: /teeSheetVerdictFor\(/, what: "the one tee-sheet rule" },
  draw: {
    file: "tournament.ts",
    pattern: /async function flightsOpenForChange[\s\S]*?isFinished\(event\.status\)[\s\S]*?bracketWinner\.count/,
    what: "the knockout's draw rule: completed, or results",
  },
};

/** The scopes nothing asks, given the sources and the rule table. */
export function unasked(srcs: Record<string, string>, scopes: readonly string[], rules = RULES): string[] {
  const asked = scopesAsked(srcs);
  return scopes.filter((s) => !asked.has(s) && !(rules[s] && rules[s].pattern.test(srcs[rules[s].file] ?? "")));
}

/** An exported action's body, up to the next export. */
function body(file: string, name: string): string {
  const src = sources[file];
  const at = src.indexOf(`export async function ${name}(`);
  expect(at, `${name} is not in ${file}`).toBeGreaterThan(-1);
  const next = src.indexOf("export ", at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}
const exportsOf = (file: string) => [...sources[file].matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
const FIRST_WRITE = /prisma\.\w+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$transaction\(/;

describe("every lock scope is asked by something", () => {
  it("CONTROL: the sweep sees an asked scope, and misses one nothing asks", () => {
    const planted = { "a.ts": `const l = await refuseIfLocked(eventId, "cup", "x"); if (l) return l;`, "b.ts": `await refuseIfLocked(eventId, "rounds", "y");` };
    expect([...scopesAsked(planted)].sort()).toEqual(["cup", "rounds"]);
    expect(unasked(planted, ["cup", "rounds", "money"], {})).toEqual(["money"]);
    // A comment that names the call is no ask — `readSource` strips it before this reads anything.
    expect(unasked({ "a.ts": "" }, ["cup"], {})).toEqual(["cup"]);
  });

  it("each of the machine's scopes has an asker in the actions", () => {
    expect(unasked(sources, LOCK_SCOPES)).toEqual([]);
  });

  it("the scopes with a rule of their own really are asked by it, and that rule is the only way they are asked", () => {
    for (const [scope, r] of Object.entries(RULES)) {
      expect(r.pattern.test(sources[r.file] ?? ""), `${scope}: ${r.what} is not in ${r.file}`).toBe(true);
      expect(scopesAsked(sources).has(scope), `${scope} is asked by refuseIfLocked now: drop its rule from this table`).toBe(false);
    }
  });

  it("the scope this PR added the asker to is red without it (cup and money, the two that nothing asked)", () => {
    const without = { ...sources, "cup.ts": sources["cup.ts"].replace(/refuseIfLocked\(eventId, "cup"/g, "noop(eventId, 'x'") };
    expect(unasked(without, LOCK_SCOPES)).toEqual(["cup"]);
    const noMoney = Object.fromEntries(Object.entries(sources).map(([f, s]) => [f, s.replace(/refuseIfLocked\(eventId, "money"/g, "noop(eventId, 'x'")]));
    expect(unasked(noMoney, LOCK_SCOPES)).toEqual(["money"]);
  });
});

/**
 * WHICH SIDE EACH ACTION IS ON. `asks` actions ask the named scope, return the refusal and do it before the first write;
 * `open` actions ask no lock at all. The reason for each open one is a FACT about when the action is needed.
 */
type Site = { file: string; name: string; scope: string };
const ASKS: Site[] = [
  // The cup's teams: making them, naming one, who is on it (the `cup` scope). Setting how the cup is decided is the rounds'.
  { file: "cup.ts", name: "createCupTeams", scope: "cup" },
  { file: "cup.ts", name: "renameCupTeam", scope: "cup" },
  { file: "cup.ts", name: "setCupPlayerTeam", scope: "cup" },
  { file: "cup.ts", name: "setCupSettings", scope: "rounds" },
  // Money, what was OFFERED.
  { file: "tournament.ts", name: "addPrize", scope: "money" },
  { file: "tournament.ts", name: "updatePrize", scope: "money" },
  { file: "tournament.ts", name: "removePrize", scope: "money" },
  { file: "tournament.ts", name: "applyPrizeStructure", scope: "money" },
  { file: "tournament.ts", name: "setOnePrizePerPlayer", scope: "money" },
  { file: "tournament.ts", name: "setPrizeCounts", scope: "money" },
  { file: "contests.ts", name: "addContest", scope: "money" },
  { file: "contests.ts", name: "removeContest", scope: "money" },
  { file: "skins.ts", name: "saveSkinsPot", scope: "money" },
  { file: "skins.ts", name: "removeSkinsPot", scope: "money" },
  { file: "side-games.ts", name: "saveSideGame", scope: "money" },
  { file: "side-games.ts", name: "removeSideGame", scope: "money" },
  { file: "money-setup.ts", name: "setEventMoneyMode", scope: "money" },
  { file: "money-setup.ts", name: "setPotEntryMode", scope: "money" },
];

const OPEN: Record<string, { file: string; why: string }> = {
  // The cup's day: the afternoon foursomes are named at lunch, points are awarded as they are won.
  nameCupSession: { file: "cup.ts", why: "a session's name is the captains' to settle on the day" },
  addCupMatch: { file: "cup.ts", why: "the lineup is the day's work" },
  publishCupLineup: { file: "cup.ts", why: "the lineup is the day's work" },
  hideCupLineup: { file: "cup.ts", why: "the lineup is the day's work" },
  removeCupMatch: { file: "cup.ts", why: "the lineup is the day's work (refused itself once a shot is recorded)" },
  addCupPoint: { file: "cup.ts", why: "points are the day's work" },
  awardCupPoint: { file: "cup.ts", why: "points are the day's work" },
  removeCupPoint: { file: "cup.ts", why: "points are the day's work" },
  saveReportRecap: { file: "cup.ts", why: "the report's words are written after the last match" },
  // The ledger: settled after the result is final.
  setPrizeWinner: { file: "tournament.ts", why: "awarding a prize is done once the result is final" },
  setContestEntrants: { file: "contests.ts", why: "who is in a pot is the ledger's" },
  setContestWinners: { file: "contests.ts", why: "who won is a result" },
  requestContestEntry: { file: "contests.ts", why: "a player asks to be in, an intention not a definition" },
  confirmContestEntry: { file: "contests.ts", why: "who has paid is settled after the result" },
  setContestSponsor: { file: "contests.ts", why: "a thank-you on the board, never money" },
  requestSkinsEntry: { file: "skins.ts", why: "a player asks to be in, an intention not a definition" },
  confirmSkinsEntry: { file: "skins.ts", why: "who has paid is settled after the result" },
  setSideGameEntrants: { file: "side-games.ts", why: "who is in a pot is the ledger's" },
  requestSideGameEntry: { file: "side-games.ts", why: "a player asks to be in, an intention not a definition" },
  confirmSideGameEntry: { file: "side-games.ts", why: "who has paid is settled after the result" },
  setPotExcluded: { file: "money-setup.ts", why: "who is in an opt-out pot is the ledger's" },
  setExpenseEntry: { file: "money-setup.ts", why: "who may write a cost down is the ledger's: costs are added after the day" },
  setOrgMoneyMode: { file: "money-setup.ts", why: "the club's default, no tournament; a tournament that chose its own is not touched" },
  addFundLine: { file: "money-setup.ts", why: "the kitty is the ledger" },
  removeFundLine: { file: "money-setup.ts", why: "the kitty is the ledger" },
  addExpense: { file: "expenses.ts", why: "expenses are the ledger" },
  updateExpense: { file: "expenses.ts", why: "expenses are the ledger" },
  removeExpense: { file: "expenses.ts", why: "expenses are the ledger" },
  recordSettlement: { file: "expenses.ts", why: "settling up happens after the result is final" },
  removeSettlement: { file: "expenses.ts", why: "settling up happens after the result is final" },
  renameBet: { file: "bet-name.ts", why: "a bet's name is a label on the ledger's lines; the players' own, on their own bet" },
};

const CLASSIFIED_FILES = ["cup.ts", "contests.ts", "skins.ts", "side-games.ts", "money-setup.ts", "expenses.ts", "bet-name.ts"];

describe("money and the cup: which side each action is on (PR L)", () => {
  for (const s of ASKS) {
    it(`${s.name} asks the ${s.scope} lock, returns it, and before it writes anything`, () => {
      const b = body(s.file, s.name);
      const m = b.match(new RegExp(`const locked = await refuseIfLocked\\(eventId, "${s.scope}", "([^"]+)"\\);\\s*if \\(locked\\) return locked;`));
      expect(m, `${s.name} does not ask ${s.scope} and return its lock`).not.toBeNull();
      const write = b.search(FIRST_WRITE);
      if (write > -1) expect(b.indexOf("refuseIfLocked("), `${s.name} writes before it asks the lock`).toBeLessThan(write);
      // A refusal on a screen is said in plain words: the lock's own sentence, "…to <what>.", never the word "bet".
      expect(m![1]).not.toMatch(/\bbet/i);
    });
  }

  for (const [name, o] of Object.entries(OPEN)) {
    it(`${name} asks no lock: ${o.why}`, () => {
      expect(body(o.file, name), `${name} asks a lock; it is the ledger's / the day's`).not.toMatch(/refuseIfLocked\(/);
    });
  }

  /**
   * BOTH SIDES IN ONE ACTION: `setSkinsEntrants` upserts its pot, so naming entrants for a pot that is not there STARTS it
   * (the offer's, shut at completion) while changing the entrants of a pot that is there is the ledger's and stays open.
   * It asks `money` only when no pot exists, and before the upsert.
   */
  it("setSkinsEntrants asks money only when no pot exists yet, and before it creates one", () => {
    const b = body("skins.ts", "setSkinsEntrants");
    const m = b.match(/const existing = await prisma\.skinsPot\.findUnique\([\s\S]*?\);\s*if \(!existing\) \{\s*const locked = await refuseIfLocked\(eventId, "money", "start a skins game"\);\s*if \(locked\) return locked;\s*\}/);
    expect(m, "setSkinsEntrants does not ask money for a pot that does not exist").not.toBeNull();
    expect(b.indexOf("refuseIfLocked("), "asked after the upsert").toBeLessThan(b.indexOf("skinsPot.upsert("));
    expect(b.match(/refuseIfLocked\(/g)?.length).toBe(1);
  });

  it("every exported action of the money and cup files is classified, once", () => {
    const classified = new Set([...ASKS.map((s) => s.name), "setSkinsEntrants", ...Object.keys(OPEN)]);
    const missing: string[] = [];
    for (const f of CLASSIFIED_FILES) for (const n of exportsOf(f)) if (!classified.has(n)) missing.push(`${f}: ${n}`);
    expect(missing, "an action in a money or cup file with no side: add it to ASKS or OPEN with its reason").toEqual([]);
    expect(ASKS.length + Object.keys(OPEN).length).toBe(new Set([...ASKS.map((s) => s.name), ...Object.keys(OPEN)]).size);
  });

  it("CONTROL: the classification sees the files' actions (so 'nothing missing' is not 'nothing read')", () => {
    expect(exportsOf("cup.ts").length).toBeGreaterThanOrEqual(13);
    expect(exportsOf("expenses.ts")).toEqual(expect.arrayContaining(["addExpense", "recordSettlement"]));
    expect(exportsOf("money-setup.ts")).toContain("setEventMoneyMode");
  });

  it("an action that asks a lock for money is never one the ledger needs after the result: the offered/ledger split is the only one", () => {
    const asksMoney = new Set(ASKS.filter((s) => s.scope === "money").map((s) => s.name));
    for (const n of Object.keys(OPEN)) expect(asksMoney.has(n), `${n} is on both sides`).toBe(false);
  });
});

describe("the screens hand their controls the lock the actions ask (PR L)", () => {
  it("the cup screen reads the cup and rounds locks into the one banner and hands them to its controls", () => {
    const page = readSource("src", "app", "(app)", "cup", "page.tsx");
    expect(page).toMatch(/screenLocksFor\(session\.eventId, \["cup", "rounds"\]\)/);
    expect(page).toMatch(/<ScopeLockBanner locks=\{locks\.locks\} correction=\{locks\.correction\}/);
    expect(page).toMatch(/<CreateCupTeams locked=\{teamsLocked\} \/>/);
    expect(page).toMatch(/<CupTeams[\s\S]*?locked=\{teamsLocked\}/);
    expect(page).toMatch(/<CupLineup[\s\S]*?locked=\{settingsLocked\}/);
  });

  it("every screen that draws a money definition reads the money lock and hands it over", () => {
    const prizes = readSource("src", "app", "(app)", "prizes", "page.tsx");
    expect(prizes).toMatch(/screenLocksFor\(session\.eventId, \["money"\]\)/);
    for (const c of ["PrizesClient", "SkinsPotClient", "ContestsClient", "MoneySetup"]) {
      expect(prizes, `${c} on Prizes & payouts is not handed the lock`).toMatch(new RegExp(`<${c}[\\s\\S]*?locked=\\{moneyLocked\\}`));
    }
    const games = readSource("src", "app", "(app)", "group-games", "page.tsx");
    expect(games).toMatch(/screenLocksFor\(session\.eventId, \["money"\]\)/);
    const drawn = games.match(/<(SkinsPotClient|ContestsClient|SideBetStart)\b/g)?.length ?? 0;
    const handed = games.match(/<(SkinsPotClient|ContestsClient|SideBetStart) locked=\{moneyLocked\}/g)?.length ?? 0;
    expect(drawn, "the screen draws none of its controls").toBeGreaterThan(3);
    expect(handed, "a control on Side games is not handed the lock").toBe(drawn);
    const mine = readSource("src", "app", "(player)", "me", "money", "page.tsx");
    expect(mine).toMatch(/screenLocksFor\(session\.eventId, \["money"\]\)/);
    expect(mine).toMatch(/<SideBetStart\s+locked=\{moneyLock\.locks\.length > 0\}/);
  });

  it("a refusal is said where the press was: role=alert, brought into view (rule 3)", () => {
    for (const f of ["CupTeams", "CupLineup", "PrizesClient", "ContestsClient", "SkinsPotClient", "SideBetStart", "MoneySetup"]) {
      const src = readSource("src", "components", `${f}.tsx`);
      const alerts = src.match(/<p\b[^>]*role="alert"[^>]*>/g) ?? [];
      expect(alerts.length, `${f} says no refusal`).toBeGreaterThan(0);
      // Every <p role="alert"> either carries the ref, or is a short-lived line beside a field (`said`).
      for (const a of alerts) expect(a, `${f}: ${a}`).toMatch(/ref=\{bringIntoView\}/);
    }
  });

  it("the ledger's own controls are not shut by the money lock: entrants, payments and winners ask `pending` alone", () => {
    const contests = readSource("src", "components", "ContestsClient.tsx");
    expect(contests).toMatch(/const offerBusy = pending \|\| locked;/);
    // The winner and confirm controls (`setContestWinners`, `confirmContestEntry`) are not disabled by `offerBusy`.
    for (const line of contests.split("\n").filter((l) => /offerBusy/.test(l))) {
      expect(line, "the ledger's controls must not ask offerBusy").not.toMatch(/Winners|confirm|Entrants|Excluded/);
    }
    const prizes = readSource("src", "components", "PrizesClient.tsx");
    expect(prizes).toMatch(/aria-label=\{`Winner of \$\{p\.category\}`\}/);
    const winner = prizes.slice(prizes.indexOf("const winnerPick"), prizes.indexOf("const remove ="));
    expect(winner).toMatch(/disabled=\{pending\}/);
    expect(winner).not.toMatch(/offerBusy/);
  });
});
