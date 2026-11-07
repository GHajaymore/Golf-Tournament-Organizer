import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { importedNames } from "./imported-names";

/**
 * THE ACTIONS ASK THE STATE MACHINE (proposal 3 Nov, PR 4).
 *
 * Launch, a status move, the eight doors into scoring and closing a round
 * each held their own answer: `launchCheckFor` (which let through a knockout
 * of one that the dashboard's button refused), `statusMove` with
 * `finishRefusal` and `completingCheckFor` beside it, and `playRefusalFor`'s
 * own four-table "has anybody played" (D2). They now ask `refusals.launch`,
 * `statusRequestOf`, `playRefusedBecause` (`refusals.play`) and
 * `roundCloseCheck`.
 *
 * `the-tournament-is-asked-one-way.test.ts` keeps the old readers out of
 * `src/app` file by file, and `actions/tournament.ts` stays on its list until
 * the scoped locks (PR 5) free it of `assertUnlocked` — so a retired name could
 * come back into that file unseen. This holds the names PR 4 retired out of
 * the action files now, by name.
 */

const RETIRED_BY_PR4 = ["launchCheckFor", "statusMove", "finishRefusal", "completingCheckFor", "playRefusalFor", "playRefusal"] as const;
const ACTIONS = ["src/app/actions/tournament.ts", "src/app/actions/play.ts"];

const retiredIn = (src: string) => importedNames(src).filter((n) => (RETIRED_BY_PR4 as readonly string[]).includes(n));

describe("the actions ask the machine", () => {
  it("CONTROL: the matcher sees a retired reader, renamed or on a middle line", () => {
    expect(retiredIn(`import { statusMove } from "@/lib/domain/phase-gate";`)).toEqual(["statusMove"]);
    expect(retiredIn(`import {\n  logAudit,\n  playRefusalFor as gate,\n} from "@/lib/services/action-shared";`)).toEqual(["playRefusalFor"]);
    expect(retiredIn(`import { statusRequestOf } from "@/lib/domain/tournament-status";`)).toEqual([]);
  });

  for (const file of ACTIONS) {
    it(`${file} imports none of the readers PR 4 retired`, () => {
      expect(retiredIn(readSource(file)), `${file} asks an old reader again — ask the machine`).toEqual([]);
    });
  }

  it("every door into scoring asks the machine's play refusal — six on the course, two in the console", () => {
    expect(readSource("src/app/actions/play.ts").match(/await playRefusedBecause\(session\.eventId\)/g)?.length).toBe(6);
    const tournament = readSource("src/app/actions/tournament.ts");
    expect(tournament.match(/await playRefusedBecause\((session\.eventId|eventId)\)/g)?.length).toBe(2);
  });

  it("playRefusalFor's private 'played' rule is gone, not left beside the machine (D2)", () => {
    expect(readSource("src/lib/services/action-shared.ts")).not.toMatch(/function playRefusalFor/);
    // The machine's one definition is what it is told.
    expect(readSource("src/lib/domain/tournament-status.ts")).toMatch(
      /return playRefusal\(\{ status: f\.status, anyResult: f\.rounds\.some\(\(r\) => r\.hasResult\) \}\);/,
    );
    expect(readSource("src/lib/services/tournament-status.ts")).toMatch(/return facts \? playRefusalOf\(facts\) : null;/);
  });

  it("launch and a status move read the machine's refusals; closing a round reads its check", () => {
    const src = readSource("src/app/actions/tournament.ts");
    expect(src).toMatch(/const refusal = told\.status\.refusals\.launch;\s*if \(refusal\) return \{ ok: false, error: refusal \};/);
    expect(src).toMatch(/const request = statusRequestOf\(told\.status, current\.status, status\);/);
    expect(src).toMatch(/if \(request\.asks && !confirmUnplayed\) return \{ ok: false, needsUnplayedConfirm: true, error: request\.asks \};/);
    const close = src.slice(src.indexOf("export async function setRoundClosed("));
    const cut = close.indexOf("await strokeCutRefusal(eventId, stage.id)");
    const check = close.indexOf("roundCloseCheck(facts)");
    const write = close.indexOf("prisma.stage.update(");
    // The cut's refusal stays, and is asked first; both before anything is written.
    expect(cut).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(cut);
    expect(write).toBeGreaterThan(check);
    expect(close).toMatch(/if \(check && "ask" in check && !confirmUnsigned\) return \{ ok: false, needsUnsignedConfirm: true, error: check\.ask \};/);
  });
});
