import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";

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

/**
 * Every route says whether a search engine may keep it, and only two say yes.
 *
 * Swept from the filesystem rather than listed, for the reason the layout sweep
 * in `e2e/layout.spec.ts` gives: a hand-written list covered 14 of 22 routes
 * and the eight it missed had no assertion at all. A page added next year is
 * the exact case that matters, and it will not be added to a list.
 *
 * What this protects is not ranking. `/live/<token>` renders real club members
 * by name, with their positions and scores — its own docblock says so — and
 * until now nothing in the app asked a crawler to leave it alone. The token
 * keeps it out of a crawler's reach only until somebody posts a board link on a
 * club website or through a service that follows links to build a preview.
 * After that, a member's name and score can sit in a public index for as long
 * as the index keeps it, which is not a thing this app can undo.
 *
 * `robots.txt` is the other half and cannot replace this one: a Disallowed URL
 * can still be listed from an external link, built out of the anchor text
 * alone. Only the page itself can refuse to be kept.
 *
 * Inheritance counts. `(app)` and `(player)` declare it once on their layouts,
 * which is the right shape — twenty-two console screens should not each have to
 * remember — so this walks a page's ancestor layouts before failing it.
 */
describe("nothing but the marketing pages invites indexing", () => {
  const APP = join(SRC, "app");

  /** Route groups are organisational — `(app)/dashboard` serves `/dashboard`. */
  const routeOf = (pageFile: string) =>
    "/" +
    relative(APP, dirname(pageFile))
      .split(sep)
      .filter((seg) => seg && !seg.startsWith("("))
      .join("/");

  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "page.tsx") pages.push(full);
    }
  };
  walk(APP);

  /**
   * The pages that exist to be found. Everything else is either credentialed by
   * a token in its URL or behind a session, and none of it benefits from being
   * in an index.
   */
  const INDEXABLE = new Set(["/", "/privacy"]);

  /** A page's own file, plus every layout above it up to src/app. */
  const chainFor = (pageFile: string) => {
    const files = [pageFile];
    let dir = dirname(pageFile);
    for (;;) {
      const layout = join(dir, "layout.tsx");
      try {
        readFileSync(layout, "utf8");
        files.push(layout);
      } catch {
        // No layout at this level, which is ordinary.
      }
      if (dir === APP) break;
      dir = dirname(dir);
    }
    return files;
  };

  it("finds the routes", () => {
    // A broken walk would make every assertion below vacuous.
    expect(pages.length).toBeGreaterThan(30);
    expect(pages.map(routeOf)).toContain("/live/[token]");
  });

  for (const pageFile of pages) {
    const route = routeOf(pageFile);
    if (INDEXABLE.has(route)) continue;

    it(`${route} refuses to be indexed`, () => {
      const declared = chainFor(pageFile).some((f) => /robots:\s*NOINDEX/.test(readFileSync(f, "utf8")));
      expect(
        declared,
        `${route} may be indexed. Add \`robots: NOINDEX\` to its metadata, or to the layout above it.`,
      ).toBe(true);
    });
  }

  it("the two marketing pages are left indexable on purpose", () => {
    // Asserted so the rule above cannot be satisfied by blanketing everything —
    // which would quietly delist the only pages the product wants found.
    for (const route of INDEXABLE) {
      const file = pages.find((p) => routeOf(p) === route);
      expect(file, `${route} should exist`).toBeTruthy();
      expect(readFileSync(file!, "utf8")).not.toMatch(/robots:\s*NOINDEX/);
    }
  });

  it("robots.txt allows only those two, and names the sitemap", () => {
    const robots = stripComments(read("app", "robots.ts"));
    expect(robots).toMatch(/allow:\s*\["\/", "\/privacy"\]/);
    for (const p of ["/live/", "/register/", "/reset-password", "/play"]) {
      expect(robots, `robots.txt should disallow ${p}`).toContain(`"${p}"`);
    }
    expect(robots).toMatch(/sitemap:/);
    // A preview deployment must not invite indexing at all.
    expect(robots).toMatch(/isProductionSite\(\)/);
  });

  it("no canonical is declared on the root layout", () => {
    /**
     * A canonical says "THIS url is the real one for this content", and Next
     * inherits it — so one on the root layout is claimed by every page that
     * does not override it. Set to "/" there, it told a crawler that /privacy
     * was a duplicate of the landing page.
     *
     * It renders identically on every page and looks correct on the only page
     * it IS correct for, so nothing on screen shows the fault. Found by
     * building and reading the emitted HTML; pinned here so the next person to
     * add SEO metadata to the layout does not reach for it again.
     */
    expect(stripComments(read("app", "layout.tsx"))).not.toMatch(/alternates/);
    // And each indexable page names its own.
    expect(stripComments(read("app", "page.tsx"))).toMatch(/canonical:\s*"\/"/);
    expect(stripComments(read("app", "privacy", "page.tsx"))).toMatch(/canonical:\s*"\/privacy"/);
  });

  it("the sitemap lists only the marketing pages", () => {
    const sitemap = stripComments(read("app", "sitemap.ts"));
    // A token-bearing URL in a sitemap publishes the credential in a file whose
    // whole purpose is to be read by strangers.
    for (const bad of ["/live", "/register", "/play", "reset-password", "token"]) {
      expect(sitemap, `the sitemap must not mention ${bad}`).not.toContain(bad);
    }
    expect(sitemap).toContain('siteUrl("/")');
    expect(sitemap).toContain('siteUrl("/privacy")');
  });
});

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
