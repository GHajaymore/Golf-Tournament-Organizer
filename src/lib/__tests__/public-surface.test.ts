import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards for the surface reachable with no login at all: the public
 * leaderboard at /live/<token>, and the Round Code play session.
 *
 * These read the source rather than the behaviour, for the same reason the
 * guards in audit-guards.test.ts do — every failure they catch is invisible in
 * the happy path. A leaderboard that ships player emails in its payload looks
 * perfect on screen. A play cookie with no server-side expiry works exactly
 * like one that has it, right up until someone replays a captured cookie a
 * month later.
 *
 * Each case below corresponds to a finding from the public-surface audit.
 */

const SRC = join(process.cwd(), "src");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the public leaderboard ships no contact details", () => {
  /**
   * The threat is not the JSX. Next serialises whatever a page hands to a
   * client component into the HTML, so a page that selects whole Player rows
   * and renders only names still puts every email and phone number on the
   * wire. The defence is that the row builders project onto a narrow shape,
   * so this pins that shape.
   */
  const CONTACT_FIELDS = ["email", "phone"];

  it("StandingRow carries no contact field", () => {
    const src = read("components", "LeaderboardTable.tsx");
    const shape = src.slice(src.indexOf("export interface StandingRow"), src.indexOf("}", src.indexOf("export interface StandingRow")));
    for (const field of CONTACT_FIELDS) {
      expect(shape, `StandingRow exposes ${field}`).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("TeamStanding carries no contact field", () => {
    const src = read("lib", "services", "teams.ts");
    const start = src.indexOf("export interface TeamStanding");
    const shape = src.slice(start, src.indexOf("}", start));
    for (const field of CONTACT_FIELDS) {
      expect(shape, `TeamStanding exposes ${field}`).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("standingRows projects rather than spreading a Player row", () => {
    // `...s.player` would satisfy the interface above and still serialise
    // every column on the row, which is the exact shape of the bug.
    const src = stripComments(read("lib", "services", "tournament.ts"));
    const fn = src.slice(src.indexOf("export function standingRows"));
    expect(fn.slice(0, fn.indexOf("\nexport "))).not.toMatch(/\.\.\.\w*[Pp]layer/);
  });

  it("the live page hands no raw database row to a client component", () => {
    const src = stripComments(read("app", "live", "[token]", "page.tsx"));
    // The whole Event row is fetched (settings, share token and all). It must
    // stay on the server: rendered fields only, never passed down as an object.
    expect(src).not.toMatch(/event=\{event\}/);
    expect(src).not.toMatch(/\{\.\.\.event\}/);
  });
});

describe("the public leaderboard honours leaderboardVisibility", () => {
  const src = stripComments(read("app", "live", "[token]", "page.tsx"));

  it("404s unless the tournament is explicitly public", () => {
    expect(src).toMatch(/isLeaderboardPublic\(settingsOf\(event\)\)/);
    expect(src).toMatch(/notFound\(\)/);
  });

  it("does not leak the tournament name through the tab title", () => {
    // generateMetadata runs before the page guard and would otherwise title a
    // blind event's 404 with its real name.
    const meta = src.slice(src.indexOf("generateMetadata"), src.indexOf("export default"));
    expect(meta).toMatch(/leaderboardVisibility !== "public"/);
  });
});

describe("the Round Code play session expires on the server", () => {
  const src = stripComments(read("lib", "play-auth.ts"));

  it("signs a deadline into the cookie, not just a maxAge", () => {
    // maxAge is advice to the browser. Anyone who copies the cookie string
    // ignores it, and a signature over "stage:player" alone never goes stale.
    expect(src).toMatch(
      /sign\(`\$\{stageId\}:\$\{playerId\}:\$\{Date\.now\(\) \+ PLAY_SESSION_TTL_MS\}:\$\{codeFingerprint\(accessCode\)\}`\)/,
    );
  });

  it("signs WHICH code opened the session, and checks it on every request", () => {
    /**
     * Non-emptiness is not revocation. `regenerateRoundCode` writes a new
     * non-empty code onto the same row, so `!stage.accessCode` was false
     * before and after a reissue and every outstanding cookie kept working —
     * while the app told the organizer in three places that reissuing ends
     * them. The behaviour is proved in `play-score-entry.audit.test.ts`; this
     * pins the two lines it depends on.
     */
    expect(src).toMatch(/codeFingerprint\(stage\.accessCode\) !== codePrint/);
    // A fingerprint, not the code: the shared secret stays out of the cookie.
    expect(src).not.toMatch(/\$\{stage\.accessCode\}/);
  });

  it("refuses a session past its deadline", () => {
    expect(src).toMatch(/Date\.now\(\) > deadline/);
  });

  it("refuses a cookie missing any field of the payload", () => {
    // Old-format cookies are precisely the sessions being retired — the
    // never-expiring ones, and now the ones bound to no code.
    expect(src).toMatch(/!stageId \|\| !playerId \|\| !expiresAt \|\| !codePrint/);
  });

  it("re-checks that the tournament still runs on codes", () => {
    expect(src).toMatch(/usesAccessCodes\(cleanSettings\(stage\.event\)\)/);
  });
});

describe("response headers protect the tokens that live in URLs", () => {
  const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");

  it("states a referrer policy rather than inheriting the browser's", () => {
    // /live/<token> and /reset-password?token= are both credentials in a URL,
    // on pages that make cross-origin requests for stylesheets.
    expect(config).toMatch(/"Referrer-Policy"/);
    expect(config).toMatch(/strict-origin-when-cross-origin/);
  });

  it("sets nosniff and a frame rule", () => {
    expect(config).toMatch(/"X-Content-Type-Options"/);
    expect(config).toMatch(/"X-Frame-Options"/);
  });
});
