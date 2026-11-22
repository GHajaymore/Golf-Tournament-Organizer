import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";
import { EVENT_SCOPE_WORD } from "../domain/event-words";
import { GOLF_REGISTERS } from "../domain/golf-terms";
import { playKindWord, PLAY_KIND_KEYS } from "../domain/play-kind";
import { COMMUNITY_VOICE_KEYS, ORG_KINDS, orgProfile } from "../domain/org-profile";
import { lifecycleNav } from "../nav-lifecycle";
import { navForRole } from "../nav";
import { lifecycleTrack } from "../domain/lifecycle-track";
import { tournamentJob } from "../domain/needs-you-now";
import { tournamentStatus } from "../domain/tournament-status";
import { FAMILY_FIXTURES } from "../domain/__tests__/tournament-facts-fixtures";

/**
 * THE MENU'S SCOPE WORD IS ONE WORD IN ONE PLACE (W, 22 Nov 2026).
 *
 * "This event" is the word over the lifecycle menu's four stops. Two ways to get it wrong:
 *   1. a second copy of the literal somewhere in `src/`, so that one is reworded and the other is not;
 *   2. the word coinciding with the club's own heading, or with a kind's word, so the menu would say
 *      the same thing over the event's sections and the club's.
 */

const LITERAL = /(["'`])This event\1/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return e === "__tests__" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e) ? [p] : [];
  });

/** The files, under `src/` and not tests, whose code (comments stripped) holds the whole literal. */
function holdersOf(files: Array<[string, string]>): string[] {
  return files.filter(([, text]) => LITERAL.test(stripComments(text))).map(([name]) => name);
}

describe("the scope word has one home", () => {
  it("is a string literal in event-words.ts and nowhere else under src/", async () => {
    const { readFileSync } = await import("node:fs");
    const root = join(process.cwd(), "src");
    const all = sourceFiles(root).map((p): [string, string] => [p.slice(root.length + 1).split("\\").join("/"), readFileSync(p, "utf8")]);
    expect(holdersOf(all)).toEqual(["lib/domain/event-words.ts"]);
    expect(LITERAL.test(readSource("src", "lib", "domain", "event-words.ts"))).toBe(true);
  });

  it("control: a planted second copy is caught, and prose or a comment is not", () => {
    expect(holdersOf([["planted.ts", `const x = "This event";`]])).toEqual(["planted.ts"]);
    expect(holdersOf([["planted.ts", `const x = 'This event';`]])).toEqual(["planted.ts"]);
    expect(holdersOf([["prose.ts", `const x = "Everything in This event is shown";`]])).toEqual([]);
    expect(holdersOf([["comment.ts", `// "This event"\nconst x = 1;`]])).toEqual([]);
  });
});

describe("the scope word is never the club's heading or a kind's word", () => {
  const facts = { ...FAMILY_FIXTURES.stroke(), startOn: "2026-11-28", endOn: "2026-11-29" };
  const status = tournamentStatus(facts);
  const job = tournamentJob(
    { eventId: "e1", name: "zz-scope Quillstone Medal", awaitingApproval: 0, entriesClose: "", nextSheet: null, board: null, startOn: facts.startOn, endOn: facts.endOn, status },
    "2026-11-20",
    (iso: string) => iso,
  );
  const track = lifecycleTrack(status, job)!;

  const collides = (scope: string, label: string) => scope === label;

  /** The club's section label for an outfit: drawn as the menu draws it. */
  const clubLabel = (kind: string, country: string | null, voice: string | null) => {
    const outfit = orgProfile(kind, country, voice);
    const menu = lifecycleNav(navForRole("admin", undefined, { outfit }), track);
    return menu.find((s) => s.items.some((i) => i.href === "/organization"))?.label;
  };

  it("for every outfit and every register", () => {
    let checked = 0;
    for (const kind of ORG_KINDS) {
      for (const voice of [null, ...COMMUNITY_VOICE_KEYS]) {
        for (const country of [null, "US", "GB", "AU"]) {
          const label = clubLabel(kind, country, voice);
          expect(label, `${kind} / ${voice} / ${country}`).toBeTruthy();
          expect(collides(EVENT_SCOPE_WORD, label!), `${kind} / ${voice} / ${country}`).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("holds no kind's word, in any register", () => {
    for (const register of GOLF_REGISTERS) {
      for (const kind of PLAY_KIND_KEYS) {
        const word = playKindWord(kind, register).toLowerCase();
        expect(EVENT_SCOPE_WORD.toLowerCase(), `${kind} in ${register}`).not.toContain(word);
      }
    }
  });

  it("control: a scope of \"Club\" would be caught", () => {
    const label = clubLabel("club", "US", null);
    expect(label).toBe("Club");
    expect(collides("Club", label!)).toBe(true);
  });
});
