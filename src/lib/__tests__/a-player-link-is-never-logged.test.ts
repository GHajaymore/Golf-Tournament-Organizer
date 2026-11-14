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
 *     action never calls `checkRateLimit` or `clearRateLimit` at all;
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

describe("S2: the limit is the client's, never the code's", () => {
  const action = readSource("src/app/actions/player-link.ts");
  it("never hands the code to a per-code limit, and never clears a limit on success", () => {
    expect(action).not.toContain("checkRateLimit(");
    expect(action).not.toContain("clearRateLimit(");
  });
  it("counts the client before the lookup, and gives back only on a found pass", () => {
    const gate = action.indexOf('clientGuessGate("player-link-client", client)');
    const lookup = action.indexOf("passForCode(normal)");
    const back = action.indexOf("guess.succeeded()");
    expect(gate, "the per-client gate is keyed on the client").toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(gate);
    expect(back).toBeGreaterThan(lookup);
    expect(action).toMatch(/if \(!pass\) return \{ ok: false, error: PLAYER_LINK_WORDS\.dead \};\s*await Promise\.all\(\[guess\.succeeded\(\)/);
  });
  it("has a fallback bucket where no client address can be read, and a platform alarm that acts", () => {
    expect(action).toMatch(/\(await clientAddress\(\)\) \?\? NO_ADDRESS/);
    expect(action).toContain('clientGuessGate("player-link-alarm", PLATFORM)');
    expect(action).toContain('clientGuessGate("player-link-slow", client)');
  });
  it("CONTROL: the check would see a per-code limit", () => {
    expect('await checkRateLimit("round-code", code);').toContain("checkRateLimit(");
  });
});

describe("S1: /p opens nothing on load", () => {
  const page = readSource("src/components/PlayerLinkOpener.tsx");
  /** The body of the first useEffect. */
  const effect = calls(page, /\buseEffect\(/g)[0] ?? "";
  it("its effect reads and strips the fragment, and never posts the code", () => {
    expect(effect).toContain("history.replaceState");
    expect(effect).not.toContain("openPlayerLink");
    expect(effect).not.toContain("press(");
  });
  it("the code is posted only from a press", () => {
    expect(calls(page, /\bopenPlayerLink\(/g)).toHaveLength(1);
    expect(page).toMatch(/onClick=\{\(\) => press\(fromLink\)\}/);
  });
  it("its typed box has no name, so a press before the script posts no code", () => {
    const input = page.slice(page.indexOf("<input"), page.indexOf("/>", page.indexOf("<input")));
    expect(input).toContain('id="player-link-code"');
    expect(input).not.toMatch(/\bname=/);
  });
  it("CONTROL: an effect that opens the link is seen", () => {
    const bad = calls("useEffect(() => { openPlayerLink(code); }, []);", /\buseEffect\(/g)[0];
    expect(bad).toContain("openPlayerLink");
  });
});

/**
 * SF-2 (security review): the platform alarm is fed only by requests the
 * client's OWN limit let through, so one client already refused cannot hold the
 * alarm on for everybody; a request the slow limit refuses gives its alarm
 * count back; and the alarm is reported once a window, not once a request.
 */
describe("SF-2: one client cannot hold the platform alarm on", () => {
  const action = readSource("src/app/actions/player-link.ts");
  const body = action.slice(action.indexOf("export async function openPlayerLink("), action.indexOf("export async function forgetThisPhone("));
  it("the client's own limit refuses BEFORE the alarm is counted", () => {
    const clientGate = body.indexOf('clientGuessGate("player-link-client", client)');
    const refused = body.indexOf("if (!guess.decision.allowed) return");
    const alarm = body.indexOf('clientGuessGate("player-link-alarm", PLATFORM)');
    expect(clientGate).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(clientGate);
    expect(alarm, "the alarm is counted before the client's refusal").toBeGreaterThan(refused);
  });
  it("a slow-limit refusal gives its alarm count back, and the alarm is logged once a window", () => {
    expect(body).toMatch(/if \(slow && !slow\.decision\.allowed\) \{\s*(\/\/[^\n]*\n\s*)?await alarm\.succeeded\(\);\s*return/);
    expect(body).toMatch(/if \(window !== alarmReportedIn\) \{\s*alarmReportedIn = window;\s*console\.error\(/);
  });
  it("CONTROL: the order check sees an alarm counted first", () => {
    const bad = 'clientGuessGate("player-link-alarm", PLATFORM); clientGuessGate("player-link-client", client); if (!guess.decision.allowed) return';
    expect(bad.indexOf('clientGuessGate("player-link-alarm", PLATFORM)')).toBeLessThan(bad.indexOf("if (!guess.decision.allowed) return"));
  });
});
