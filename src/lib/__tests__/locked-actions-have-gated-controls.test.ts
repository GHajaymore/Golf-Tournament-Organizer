import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { readSource } from "./source";
import { setupLockedByLaunch, tournamentFamily } from "@/lib/domain/tournament-status";

/**
 * A CONTROL THAT REACHES A LOCK-REFUSING ACTION KNOWS ABOUT THE LOCK.
 *
 * `assertUnlocked` THROWS when setup is locked, and a server action that throws
 * inside a transition takes the whole page down to Next's "Application error".
 * The rule this app runs on is that a locked screen does not offer the control
 * — `SetupLockBanner` says "setup is read-only" — and five screens did not
 * follow it: Rounds & formats, Teams & pairs, the bracket arrangement,
 * Tournament details and Clear scores. Walked 2026-09-27 on the live seeded
 * club (the Registration "Add" button, then the bracket's "Two flights"), then
 * swept: 45 actions refuse a locked tournament, and 34 of them were reachable
 * from a control that stayed live.
 *
 * Swept as a CLASS, so a control added tomorrow is covered the day it lands:
 * every client file that imports an action whose body calls `assertUnlocked`
 * must read the lock itself. Read through `readSource`, so a comment that
 * merely says "locked" cannot satisfy it.
 */

const ROOT = process.cwd();

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p, ext);
    return ext.test(name) ? [p] : [];
  });
}

/** Every exported action whose body refuses a locked tournament. */
function lockRefusingActions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files(join(ROOT, "src", "app", "actions"), /\.ts$/)) {
    const src = readSource(relative(ROOT, f));
    const parts = src.split(/export async function /).slice(1);
    for (const part of parts) {
      const name = part.slice(0, part.indexOf("(")).trim();
      // The body up to the next export — `split` already cut it there. A scoped
      // lock (`refuseIfLocked`, PR 5a) RETURNS its refusal rather than throwing,
      // but a live control that can only be refused is still an invitation to a
      // refused press, so its controls must know the lock all the same.
      if (/\b(assertUnlocked|refuseIfLocked)\(/.test(part)) out.set(name, relative(ROOT, f));
    }
  }
  return out;
}

/** Client files, and which lock-refusing actions each imports. */
function callers(locked: Map<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const client = [
    ...files(join(ROOT, "src", "components"), /\.tsx$/),
    ...files(join(ROOT, "src", "app"), /\.tsx$/),
  ];
  for (const f of client) {
    const src = readSource(relative(ROOT, f));
    if (!/^\s*["']use client["']/.test(src)) continue;
    const names: string[] = [];
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/app\/actions\/[^"']+["']/g)) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/)[0];
        if (locked.has(name)) names.push(name);
      }
    }
    if (names.length) out.set(relative(ROOT, f).split("\\").join("/"), names);
  }
  return out;
}

/**
 * Files that call a lock-refusing action and need no lock of their own, each
 * with the reason. A reason must be a FACT about where the file renders.
 */
const EXEMPT: Record<string, string> = {
  "src/components/rounds/RoundScoreInput.tsx":
    "`writeScoreInput` is a pass-through to the one action; its two callers hold the lock: the round card reads `SetupLocked` in `use-round-ctx.tsx` (the radios are `disabled={pending || locked}`), and `RoundTeamScoring` takes `locked` as a prop",
  // Renders only for a casual round, which never locks: the machine's family rule
  // (`setupLockedByLaunch`, proposal 8.2) — asserted below. Until state machine PR 9b
  // it was the blanket flag `createMatch` wrote; that flag is not read any more.
  "src/components/CasualRoundPanel.tsx": "casual rounds never lock",
  // Not rendered at all while setup is locked — asserted below.
  "src/components/DescribeTournament.tsx": "not rendered when locked",
};

describe("every control that reaches a lock-refusing action knows the lock", () => {
  const locked = lockRefusingActions();
  const found = callers(locked);

  it("finds the actions and the screens it is about (the control)", () => {
    // If the sweep's parsing broke, it would find nothing and pass. These are
    // known members of the class, from the walk and the sweep.
    // (`addStage` left this list on 2026-09-27: adding a round is running the
    // event, not setting it up. Deleting one still refuses.)
    // (`removeStage` left it on 2026-11-08, J12 PR 7b: deleting a round asks the rounds rule — swept below.)
    for (const a of ["setBracketMode", "saveEvent", "clearRoundScores", "createTeam", "setStageCarry", "setStageCut"]) {
      expect(locked.has(a), `${a} should refuse a locked tournament`).toBe(true);
    }
    for (const f of [
      "src/components/rounds/use-round-ctx.tsx",
      "src/components/TeamsClient.tsx",
      "src/components/BracketModePicker.tsx",
      "src/components/EventSetupClient.tsx",
      "src/components/ClearScores.tsx",
      "src/components/CutControl.tsx",
      "src/components/RegistrationClient.tsx",
    ]) {
      expect(found.has(f), `${f} should be found calling a lock-refusing action`).toBe(true);
    }
  });

  /**
   * RECEIVES the lock — a typed prop or the Rounds & formats context — not
   * merely mentions it. The first draft accepted the bare word and passed on
   * the broken screen: `StagesClient` said `locked: false` and `locked={false}`
   * while taking no lock at all.
   */
  const RECEIVES = /\b(locked|setupLocked)\??:\s*boolean\b|useContext\(SetupLocked\)/;

  it("each one receives the lock, or is exempt for a stated reason", () => {
    const blind = [...found.entries()]
      .filter(([f]) => !(f in EXEMPT))
      .filter(([f]) => !RECEIVES.test(readSource(f)))
      .map(([f, names]) => `${f} → ${names.join(", ")}`);
    expect(blind, "controls offered on a locked tournament whose action will throw").toEqual([]);
  });

  it("nobody hands a lock-aware control a constant instead of the lock", () => {
    // `locked={false}` on the single-match picker and `locked: false` into the
    // carry-forward prompt were how two of these controls were wired: a lock
    // the component understood and the caller would not give it.
    const constants = [...found.keys()].filter((f) => /\blocked(=\{false\}|:\s*false\b)/.test(readSource(f)));
    expect(constants).toEqual([]);
  });

  it("an exemption is still true", () => {
    const stages = readSource("src", "app", "(app)", "stages", "page.tsx");
    // Withheld when locked — and, since 2026-10-16, where the club has no
    // drafting at all; the lock is still the first thing asked.
    expect(stages).toMatch(/const describeTournament =\s*locked \|\| [^?]*\? null :/);
    /**
     * THE CASUAL PANEL'S EXEMPTION, REPINNED TO ITS GUARANTEE (state machine PR 9b, test plan B7).
     * It pinned that `createMatch` wrote the blanket flag; it pins now that the round it makes is a
     * casual one and that the machine never locks a casual round — the reason the panel's controls
     * need no lock, whatever any flag on the row says.
     */
    const setup = readSource("src", "app", "actions", "match-setup.ts");
    expect(setup).toMatch(/status: "live",\s*shape: "match",/);
    expect(setup).not.toMatch(/configUnlocked/);
    expect(tournamentFamily({ shape: "match", rounds: [], bracketMode: "single", league: false })).toBe("casual");
    for (const status of ["live", "completed"]) expect(setupLockedByLaunch(status, "casual"), status).toBe(false);
    // CONTROL: the same rule locks every other family at launch, so the line above is the family's doing.
    expect(setupLockedByLaunch("live", "stroke")).toBe(true);
  });

  /**
   * THE FIELD ACTIONS ASK THEIR OWN RULE (day-of field changes, PR A): after
   * launch Withdraw, Put back and a late entry stay open while setup is locked,
   * so a control reaching one of them takes the field's DOORS (`fieldDoors`, or
   * one door as a sentence), never the setup lock alone — the setup lock would
   * shut the very controls the morning needs. Swept as a class like the above.
   */
  it("each control reaching a field action receives the field's doors", () => {
    const fieldActions = new Set<string>();
    for (const f of files(join(ROOT, "src", "app", "actions"), /\.ts$/)) {
      for (const part of readSource(relative(ROOT, f)).split(/export async function /).slice(1)) {
        // `fieldVerdictFor` is the same rule with its warning (J12, PR 7a): addSignup asks it.
        if (/\bfield(?:Refusal|VerdictFor)\(/.test(part)) fieldActions.add(part.slice(0, part.indexOf("(")).trim());
      }
    }
    // The control: the sweep finds the actions it is about.
    for (const a of ["addSignup", "removeSignup", "reinstateWithdrawn", "approveSignup", "addMembersToEvent"]) {
      expect(fieldActions.has(a), `${a} should ask the field rule`).toBe(true);
    }
    const reaching = callers(new Map([...fieldActions].map((a) => [a, ""])));
    expect(reaching.has("src/components/RegistrationClient.tsx")).toBe(true);
    expect(reaching.has("src/components/WithdrawnList.tsx")).toBe(true);
    const DOORS = /\b(doors\??:\s*FieldDoors|door\??:\s*string \| null|fieldLocked\??:\s*string \| null)/;
    const FIELD_EXEMPT: Record<string, string> = {
      ...EXEMPT,
      // Handed `locked={!!doors.add}` by RegistrationClient — the add door, as a boolean (asserted below).
      "src/components/RosterPicker.tsx": "given the add door by its one caller",
      // The Flights board shuts every move on the setup lock (and on a confirmed draw). After launch the
      // field rule refuses "move-flight" too; the one move it allows — placing an unplaced late entrant —
      // is offered on Entries instead. Stricter than the rule, never looser, so no refused press is offered.
      "src/components/FlightBoard.tsx": "shuts every move on the setup lock, stricter than the field rule",
    };
    const blind = [...reaching.entries()]
      .filter(([f]) => !(f in FIELD_EXEMPT))
      .filter(([f]) => !DOORS.test(readSource(f)))
      .map(([f, names]) => `${f} → ${names.join(", ")}`);
    expect(blind, "controls reaching a field action without the field's doors").toEqual([]);
    expect(readSource("src", "components", "RegistrationClient.tsx")).toMatch(/<RosterPicker [^>]*locked=\{!!doors\.add\}/);
  });

  /**
   * THE ROUND ACTIONS ASK THEIR OWN RULE (J12, state machine PR 7b): after
   * launch a round's format, allowance, tees, day and delete stay open until
   * the round has scores, so a control reaching one of them on Rounds & formats
   * takes the round's DOORS (`roundDoors`, or one door as a sentence) — the
   * setup lock alone would shut the controls the rule leaves open. The tee
   * selects elsewhere (Flights, Entries, Settings) say the server's refusal where the
   * press was — a tee change after play is refused (option C, 8 Nov). Swept as a class.
   */
  it("each control reaching a round action on Rounds & formats receives the round's doors", () => {
    const roundActions = new Set<string>();
    for (const f of files(join(ROOT, "src", "app", "actions"), /\.ts$/)) {
      for (const part of readSource(relative(ROOT, f)).split(/export async function /).slice(1)) {
        if (/\b(beforeTermChange|roundVerdictFor|roundRefusal|acrossRoundsRefusal)\(/.test(part)) roundActions.add(part.slice(0, part.indexOf("(")).trim());
      }
    }
    // The control: the sweep finds the actions it is about.
    for (const a of ["setStageAllowance", "setStageAllowanceWeights", "setStageScoringBasis", "setStageFormat", "removeStage", "setStageCourse", "setFlightTee", "setPlayerTee", "setEventDefaultTee", "setStagePlayedOn", "setStageHoles"]) {
      expect(roundActions.has(a), `${a} should ask the rounds rule`).toBe(true);
    }
    const reaching = callers(new Map([...roundActions].map((a) => [a, ""])));
    const STAGES = ["src/components/StagesClient.tsx", "src/components/RoundAllowance.tsx", "src/components/RoundTeamScoring.tsx"];
    for (const f of STAGES) expect(reaching.has(f), `${f} should be found calling a round action`).toBe(true);
    const DOORS = /\b(doors\??:\s*RoundDoors|door\??:\s*string \| null|allowanceDoor\??:\s*string \| null)/;
    const blind = STAGES.filter((f) => !DOORS.test(readSource(f)));
    expect(blind, "Rounds & formats controls reaching a round action without the round's doors").toEqual([]);
    // And the page hands them over, from the machine's own facts.
    expect(readSource("src", "app", "(app)", "stages", "page.tsx")).toMatch(/doors: \(\(\) => \{\s*const one = told \? roundChangeFactsOf\(told\.facts, s\.id, cutsMade\) : null;\s*return one \? roundDoors\(one\) : null;/);
    // And the cuts it hands them are the one answer's (`cutsMadeAfter`, from `cutHasBeenMade`).
    expect(readSource("src", "app", "(app)", "stages", "page.tsx")).toMatch(/const cutsMade = cutsMadeAfter\(state\.stages\);/);
    // The tee selects elsewhere say a refusal where the press was: a tee change after play is refused (option C, 8 Nov).
    for (const [f, said] of [
      ["src/components/FlightTeeSelect.tsx", /setError\(res\.error \?\? "Couldn't set those tees\."\)/],
      ["src/components/FlightBoard.tsx", /refuse\(res\.error \?\? "Couldn't set those tees\.", g\.id\)/],
      ["src/components/PlaySettings.tsx", /setError\(teeResult\.error \?\? "Couldn't save the tees\."\)/],
      ["src/components/RegistrationClient.tsx", /setRowError\(result\.ok \? "" : result\.error \?\? "Couldn’t save those tees\.", playerId\)/],
    ] as const) {
      expect(readSource(f), `${f} drops a refused tee change`).toMatch(said);
    }
  });

  it("each page hands its screen the lock", () => {
    expect(readSource("src", "app", "(app)", "stages", "page.tsx")).toMatch(/<StagesClient[\s\S]*?locked=\{locked\}/);
    expect(readSource("src", "app", "(app)", "teams", "page.tsx")).toMatch(/<TeamsClient\s+locked=\{locked\}/);
    expect(readSource("src", "app", "(app)", "event", "page.tsx")).toMatch(/<EventSetupClient[\s\S]*?locked=\{locked\}/);
    // The machine's scoped lock (state machine PR 5b): the rounds' for the arrangement (as `setBracketMode` asks, and as
    // the same picker on Rounds & formats draws — never the draw's, which a knockout in flights keeps open while live),
    // the rounds' for clearing scores.
    expect(readSource("src", "app", "(app)", "bracket", "page.tsx")).toMatch(/<BracketModePicker[^>]*locked=\{\(await scopeLockFor\(session\.eventId, "rounds"\)\) !== null\}/);
    expect(readSource("src", "app", "(app)", "entry", "page.tsx")).toMatch(/<EntryModes\s+setupLocked=\{\(await scopeLockFor\(session\.eventId, "rounds"\)\) !== null\}/);
    expect(readSource("src", "components", "EntryModes.tsx")).toMatch(/<ClearScores[\s\S]*?locked=\{setupLocked\}/);
  });
});

/**
 * EVERY SCREEN THAT CAN BE REFUSED BY A SCOPE OFFERS THE WAY OUT WHERE THE PRESS ENDED (state
 * machine PR 9b, design §4f; test plan B21).
 *
 * After 9b a tournament that held the retired blanket unlock meets the launch lock for the first
 * time, and its way out is the committee correction — a BUTTON, with the refused part already
 * chosen. A refusal on a screen that draws none names a button that is not there: one hop from a
 * dead end. So every page whose components reach a lock-refusing action mounts `ScopeLockBanner`
 * somewhere in what it renders — or the refusing control draws `CorrectionButton` itself, beside
 * the lock it says (Clear scores on Score entry).
 *
 * Read as an import graph from each `page.tsx` down through `src/app` and `src/components`
 * (static imports, re-exports and `import()`; `readSource`, so a commented import is no edge).
 */
type Graph = { exists: (f: string) => boolean; read: (f: string) => string };

const IMPORT = /(?:^|[;\n])\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolved(g: Graph, from: string, spec: string): string | null {
  let p: string;
  if (spec.startsWith("@/")) p = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) p = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null;
  for (const c of [p, `${p}.tsx`, `${p}.ts`, `${p}/index.tsx`, `${p}/index.ts`]) if (g.exists(c)) return c;
  return null;
}

/** Everything a page renders or calls, through its imports, within the screens (not the actions). */
function reachOf(g: Graph, root: string): Set<string> {
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length) {
    const f = queue.shift()!;
    for (const m of g.read(f).matchAll(IMPORT)) {
      const to = resolved(g, f, m[1] ?? m[2]);
      if (!to || seen.has(to) || to.startsWith("src/app/actions/")) continue;
      if (!to.startsWith("src/app/") && !to.startsWith("src/components/")) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

/** "page → client" for each page that reaches a refusing client and offers no way out on the screen. */
export function pagesWithoutTheWayOut(g: Graph, pages: readonly string[], refusingClients: readonly string[]): string[] {
  const out: string[] = [];
  for (const page of pages) {
    const reach = reachOf(g, page);
    if ([...reach].some((f) => /<ScopeLockBanner\b/.test(g.read(f)))) continue;
    for (const c of refusingClients.filter((c) => reach.has(c))) {
      if (/<CorrectionButton\b/.test(g.read(c))) continue;
      out.push(`${page} → ${c}`);
    }
  }
  return out.sort();
}

describe("every screen a scope can refuse mounts the banner with the way out (PR 9b, B21)", () => {
  const disk: Graph = { exists: (f) => existsSync(f) && statSync(f).isFile(), read: (f) => readSource(f) };
  const pages = files(join(ROOT, "src", "app"), /^page\.tsx$/).map((f) => relative(ROOT, f).split("\\").join("/"));
  const refusing = [...callers(lockRefusingActions()).keys()].filter((f) => !(f in EXEMPT));

  it("CONTROL: a planted screen whose control a scope refuses, with no banner, is seen — and the banner or the button beside the control clears it", () => {
    const planted: Record<string, string> = {
      "src/app/(app)/zz/page.tsx": `import { ZzFlights } from "@/components/ZzFlights";\nexport default function Page() { return <ZzFlights />; }`,
      "src/components/ZzFlights.tsx": `"use client";\nimport { renameGroup } from "@/app/actions/tournament";\nexport function ZzFlights() { return <button onClick={() => renameGroup("a", "b")}>Rename</button>; }`,
    };
    const g = (extra: Record<string, string>): Graph => {
      const all = { ...planted, ...extra };
      return { exists: (f) => f in all, read: (f) => all[f] ?? "" };
    };
    const page = ["src/app/(app)/zz/page.tsx"];
    expect(pagesWithoutTheWayOut(g({}), page, ["src/components/ZzFlights.tsx"])).toEqual(["src/app/(app)/zz/page.tsx → src/components/ZzFlights.tsx"]);
    // The banner anywhere in what the page renders clears it…
    const withBanner = { "src/app/(app)/zz/page.tsx": `import { ZzFlights } from "@/components/ZzFlights";\nimport { ScopeLockBanner } from "@/components/ScopeLockBanner";\nexport default function Page() { return <><ScopeLockBanner locks={[]} isAdmin /><ZzFlights /></>; }`, "src/components/ScopeLockBanner.tsx": "" };
    expect(pagesWithoutTheWayOut(g(withBanner), page, ["src/components/ZzFlights.tsx"])).toEqual([]);
    // …and so does the button drawn beside the control.
    const withButton = { "src/components/ZzFlights.tsx": `"use client";\nexport function ZzFlights() { return <CorrectionButton scopes={["flights"]} />; }` };
    expect(pagesWithoutTheWayOut(g(withButton), page, ["src/components/ZzFlights.tsx"])).toEqual([]);
  });

  it("CONTROL: the sweep reads the real screens — the pages it is about reach their refusing clients", () => {
    expect(pages.length, "no pages found").toBeGreaterThan(40);
    for (const [page, client] of [
      ["src/app/(app)/stages/page.tsx", "src/components/StagesClient.tsx"],
      ["src/app/(app)/registration/page.tsx", "src/components/RegistrationClient.tsx"],
      ["src/app/(app)/teams/page.tsx", "src/components/TeamsClient.tsx"],
      ["src/app/(app)/grouping/page.tsx", "src/components/FlightBoard.tsx"],
      ["src/app/(app)/event/page.tsx", "src/components/EventSetupClient.tsx"],
      ["src/app/(app)/entry/page.tsx", "src/components/ClearScores.tsx"],
    ]) {
      expect(reachOf(disk, page).has(client), `${page} does not reach ${client}`).toBe(true);
    }
  });

  /**
   * A PAGE THAT REACHES A REFUSING CLIENT BUT CANNOT PRESS ITS EVENT-LEVEL ACTION (PR L). Club settings draws
   * `MoneySetup` in its club mode only, which sets the CLUB's default (`setOrgMoneyMode`, no event, no lock); the
   * tournament's own money mode (`setEventMoneyMode`, which asks the `money` lock) is drawn on Prizes & payouts,
   * which mounts the banner. Each exemption is asserted true below, so it cannot outlive its reason.
   */
  const PAGE_EXEMPT: Record<string, string> = {
    "src/app/(app)/organization/page.tsx → src/components/MoneySetup.tsx": 'MoneySetup mode="organization" only',
  };

  it("every page that reaches a refusing control offers the committee correction on the screen", () => {
    const missing = pagesWithoutTheWayOut(disk, pages, refusing).filter((x) => !(x in PAGE_EXEMPT));
    expect(missing, "mount <ScopeLockBanner> for the scope this screen's actions ask, or draw <CorrectionButton> beside the control").toEqual([]);
  });

  it("a page exemption is still true: club settings draws MoneySetup for the club only, and Prizes draws the tournament's with the banner", () => {
    const org = readSource("src", "app", "(app)", "organization", "page.tsx");
    expect(org).toMatch(/<MoneySetup\s+mode="organization"/);
    expect(org).not.toMatch(/mode="tournament"/);
    const prizes = readSource("src", "app", "(app)", "prizes", "page.tsx");
    expect(prizes).toMatch(/<MoneySetup\s+mode="tournament"/);
    expect(prizes).toMatch(/<ScopeLockBanner locks=\{moneyLock\.locks\}/);
    // CONTROL: the sweep without the exemption does see the page.
    expect(pagesWithoutTheWayOut(disk, pages, refusing)).toContain("src/app/(app)/organization/page.tsx → src/components/MoneySetup.tsx");
  });
});
