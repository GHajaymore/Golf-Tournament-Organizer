import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A GUEST'S PLAYER LINK CODE NEVER LEAVES WHERE IT BELONGS (J39/J40 PR 1; the
 * review's S1, S2 and S3).
 *
 *   - no `console.*`, `logAudit`, `fetch` or error report in the link's files
 *     is handed the code (the code's variables: `code`, `normal`, `.code`);
 *   - the link builder puts the code in the FRAGMENT (`/p#`), and there is no
 *     `/p/[code]` route for a server to log it in;
 *   - S2: the per-client limit is keyed on the CLIENT, never the code — the
 *     one door never calls `checkRateLimit` or `clearRateLimit` with a twelve
 *     (one code box: those live only in the round code's branch);
 *   - S1: /p's page never posts the code from an effect, only from a press,
 *     and its typed box has no `name` (a press before the script arrives posts
 *     nothing, never `?code=` in an address).
 *
 * Each with a CONTROL that shows the check can see what it refuses.
 */

const LINK_FILES = [
  "src/app/actions/player-link.ts",
  "src/lib/services/player-link.ts",
  "src/lib/guest-auth.ts",
  "src/lib/player-viewer.ts",
  "src/lib/domain/player-link.ts",
  "src/components/PlayerLinkPanel.tsx",
  "src/components/PlayerLinkOpener.tsx",
  "src/components/GuestLinkControls.tsx",
  // PR 3: the slips hand every guest's code to a press at once, so they are swept too.
  "src/app/actions/player-link-slips.ts",
  "src/lib/services/player-link-slips.ts",
  "src/lib/domain/player-link-slips.ts",
  "src/components/print/PlayerLinkSlips.tsx",
  // One code box (2026-11-17): a personal code typed in ANY box, or tapped on /p, goes through these.
  "src/lib/services/code-door.ts",
  "src/app/actions/code-box.ts",
  "src/lib/domain/code-shape.ts",
  "src/components/PlayClient.tsx",
  // PR 3B: a guest who entered themselves is handed their own code once, and the waiting screen shows it.
  "src/app/actions/guest-entry.ts",
  "src/lib/services/guest-entry.ts",
  "src/components/GuestEntryForm.tsx",
  "src/components/GuestWaitingCard.tsx",
  "src/lib/guest-code-memory.ts",
];

/** Each call's own argument list, from its opening bracket to the one that closes it. */
function calls(text: string, callee: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(callee)) {
    let depth = 0;
    const from = (m.index ?? 0) + m[0].length - 1;
    for (let i = from; i < text.length; i += 1) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")" && --depth === 0) {
        out.push(text.slice(from, i + 1));
        break;
      }
    }
  }
  return out;
}

const SINKS = /\b(console\.\w+|logAudit|fetch|captureException|captureMessage|reportError)\(/g;
/** A sink's arguments that name the code. */
const namesTheCode = (args: string) => /\bcode\d?\b|\bnormal\b|\.code\b|\bfromLink\b|\btyped\b/.test(args);

function leaks(text: string): string[] {
  return calls(text, SINKS).filter(namesTheCode);
}

describe("the code reaches no log, no record and no report", () => {
  it("every link file exists (a renamed file would make the sweep vacuous)", () => {
    for (const f of LINK_FILES) expect(existsSync(f), f).toBe(true);
  });
  for (const f of LINK_FILES) {
    it(`${f} hands the code to no console, record, fetch or report`, () => {
      expect(leaks(readSource(f)), f).toEqual([]);
    });
  }
  it("CONTROL: a record or a console line that names the code is caught", () => {
    expect(leaks('await logAudit(eventId, "player-link.opened", `${normal} opened`);')).toHaveLength(1);
    expect(leaks('console.error("bad code", code);')).toHaveLength(1);
    expect(leaks("await logAudit(eventId, \"player-link.handed\", `${id}'s player link shown`);")).toEqual([]);
  });
});

describe("the link's address", () => {
  it("puts the code in the fragment", () => {
    const domain = readSource("src/lib/domain/player-link.ts");
    expect(domain).toMatch(/\$\{LINK_PATH\}#\$\{code\}/);
    expect(domain).toMatch(/LINK_PATH = "\/p"/);
  });
  it("has no /p/[code] route — only /p itself", () => {
    const dir = join("src", "app", "p");
    expect(existsSync(join(dir, "page.tsx"))).toBe(true);
    const nested = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(nested, "a route under /p would put a code in a path a server logs").toEqual([]);
  });
});

/**
 * S2, since one code box (2026-11-17): the link opens through the one door for
 * a typed code (services/code-door.ts). A personal code is never a per-code
 * key WITH A TWELVE: the per-code calls live only in the round code's branch
 * (`openEight`), never in the link's (`openTwelve`) nor in the twelve's half
 * of the gate the shape chooses (`guessGate`).
 */
const DOOR = readSource("src/lib/services/code-door.ts");
const between = (src: string, from: string, to: string) => {
  const at = src.indexOf(from);
  return at < 0 ? "" : src.slice(at, src.indexOf(to, at + from.length));
};
const TWELVE = between(DOOR, "async function openTwelve(", "async function publishedSheet(");
const EIGHT = between(DOOR, "async function openEight(", "async function openTwelve(");
const GATE = between(DOOR, "export async function guessGate(", "export async function lookupEight(");
/** The gate's twelve half: everything after the eight's own early return. */
const GATE_TWELVE = GATE.slice(GATE.indexOf("const who = client ?? NO_ADDRESS"));

describe("S2: the limit is the client's, never the code's", () => {
  it("the door's branches are where the sweep reads them (a renamed branch would make it vacuous)", () => {
    for (const part of [TWELVE, EIGHT, GATE, GATE_TWELVE]) expect(part.length).toBeGreaterThan(100);
  });
  it("never hands a personal code to a per-code limit, and never clears one for it", () => {
    for (const part of [TWELVE, GATE_TWELVE]) {
      expect(part).not.toContain("checkRateLimit(");
      expect(part).not.toContain("clearRateLimit(");
    }
    // Every per-code call in the door is the round code's.
    const all = DOOR.match(/\b(check|clear)RateLimit\(/g)?.length ?? 0;
    const eights = EIGHT.match(/\b(check|clear)RateLimit\(/g)?.length ?? 0;
    // The check, and the two clears: a round that opened and an entry page that opened (J39 PR 3B).
    expect(eights).toBe(3);
    expect(all).toBe(eights);
  });
  it("counts the client before the lookup, and gives back only on a found pass", () => {
    const gate = TWELVE.indexOf('guessGate("twelve", client)');
    const lookup = TWELVE.indexOf("passForCode(code)");
    const back = TWELVE.indexOf("gate.opened()");
    expect(gate, "the twelve asks the twelve's gate").toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(gate);
    expect(back).toBeGreaterThan(lookup);
    expect(TWELVE).toMatch(/if \(!pass\) return \{ ok: false, error: CODE_WORDS\.opensNothing \};\s*await gate\.opened\(\)/);
  });
  it("has a fallback bucket where no client address can be read, and a platform alarm that acts", () => {
    // The one gate takes its keys from the shape's lane (PR B: the eight has the same steps); the twelve's lane names the link's.
    expect(GATE_TWELVE).toContain("clientGuessGate(lane.client, who)");
    expect(GATE_TWELVE).toContain("clientGuessGate(lane.alarm, lane.platform)");
    expect(GATE_TWELVE).toContain("clientGuessGate(lane.slow, who)");
    const lanes = between(DOOR, "const LANES = {", "} as const;");
    expect(lanes).toContain('twelve: { client: "player-link-client", alarm: "player-link-alarm", slow: "player-link-slow"');
  });
  it("CONTROL: the check would see a per-code limit in the twelve's branch", () => {
    expect('async function openTwelve(code) { await checkRateLimit("round-code", code); }').toContain("checkRateLimit(");
    expect(between("x async function openTwelve(a) { checkRateLimit( } async function publishedSheet(", "async function openTwelve(", "async function publishedSheet(")).toContain("checkRateLimit(");
  });
});

describe("S1: /p opens nothing on load", () => {
  const page = readSource("src/components/PlayerLinkOpener.tsx");
  /** The body of the first useEffect. */
  const effect = calls(page, /\buseEffect\(/g)[0] ?? "";
  it("its effect reads and strips the fragment, and never posts the code", () => {
    expect(effect).toContain("history.replaceState");
    expect(effect).not.toContain("openCode");
    expect(effect).not.toContain("press(");
  });
  it("the code is posted only from a press", () => {
    expect(calls(page, /\bopenCode\(/g)).toHaveLength(1);
    expect(page).toMatch(/onClick=\{\(\) => press\(fromLink\)\}/);
  });
  it("a round code typed at /p leaves only after a `#`, never in an address a server logs", () => {
    // `boxStepFor(…, "p")` sends a round code on to /play#ABCD-EFGH, built by the sign's one address
    // builder (`roundCodeLink`), which puts the code after the `#` and escapes it there.
    expect(page).toMatch(/boxStepFor\(shape, "p"\)/);
    expect(readSource("src/lib/domain/code-shape.ts")).toMatch(/href: roundCodeLink\("", shape\.code/);
    expect(readSource("src/lib/code-format.ts")).toMatch(/\/play#\$\{encodeURIComponent\(formatAccessCode\(code\)\)\}/);
    expect(page).not.toMatch(/[?&]code=/);
  });
  it("/play's box posts a code in the BODY of a form, never in its address", () => {
    const play = readSource("src/components/PlayClient.tsx");
    const box = play.slice(play.lastIndexOf("<form", play.indexOf('id="play-round-code"')), play.indexOf('id="play-round-code"'));
    expect(box).toMatch(/action=\{postCode\}/);
    expect(box).not.toMatch(/method="get"/);
    expect(play).not.toMatch(/[?&]code=/);
  });
  it("/play's box is never kept by the browser: a personal code typed there is not form history", () => {
    const play = readSource("src/components/PlayClient.tsx");
    const at = play.indexOf('id="play-round-code"');
    const input = play.slice(play.lastIndexOf("<input", at), play.indexOf("/>", at));
    expect(input).toContain('autoComplete="off"');
  });
  it("its typed box has no name, so a press before the script posts no code", () => {
    const input = page.slice(page.indexOf("<input"), page.indexOf("/>", page.indexOf("<input")));
    expect(input).toContain('id="player-link-code"');
    expect(input).not.toMatch(/\bname=/);
  });
  it("CONTROL: an effect that opens the link is seen", () => {
    const bad = calls("useEffect(() => { openCode(code); }, []);", /\buseEffect\(/g)[0];
    expect(bad).toContain("openCode");
  });
});

/**
 * SF-2 (security review): the platform alarm is fed only by requests the
 * client's OWN limit let through, so one client already refused cannot hold the
 * alarm on for everybody; a request the slow limit refuses gives its alarm
 * count back; and the alarm is reported once a window, not once a request.
 */
describe("SF-2: one client cannot hold the platform alarm on", () => {
  // The twelve's half of the door's gate (one code box, 2026-11-17), where `openPlayerLink`'s lines moved.
  const body = GATE_TWELVE;
  it("the client's own limit refuses BEFORE the alarm is counted", () => {
    const clientGate = body.indexOf("clientGuessGate(lane.client, who)");
    const refused = body.indexOf("if (!guess.decision.allowed) return");
    const alarm = body.indexOf("clientGuessGate(lane.alarm, lane.platform)");
    expect(clientGate).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(clientGate);
    expect(alarm, "the alarm is counted before the client's refusal").toBeGreaterThan(refused);
  });
  it("a slow-limit refusal gives its alarm count back, and the alarm is logged once a window", () => {
    expect(body).toMatch(/if \(slow && !slow\.decision\.allowed\) \{\s*(\/\/[^\n]*\n\s*)?await alarm\.succeeded\(\);\s*return/);
    expect(body).toMatch(/if \(window !== alarmReportedIn\[shape\]\) \{\s*alarmReportedIn\[shape\] = window;\s*console\.error\(/);
  });
  it("CONTROL: the order check sees an alarm counted first", () => {
    const bad = "clientGuessGate(lane.alarm, lane.platform); clientGuessGate(lane.client, who); if (!guess.decision.allowed) return";
    expect(bad.indexOf("clientGuessGate(lane.alarm, lane.platform)")).toBeLessThan(bad.indexOf("if (!guess.decision.allowed) return"));
  });
});
