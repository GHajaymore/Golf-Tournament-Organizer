import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Does an action check that the row it was handed belongs to the caller?
 *
 * A guard proves the caller is *an* organizer. It says nothing about whether
 * they organize the tournament whose stage id they just posted. Every export
 * in these files is a public HTTP endpoint taking arguments straight off the
 * wire, so an id parameter is an attacker-chosen row until something narrows
 * it — and the failure is invisible in the happy path, because the real UI
 * only ever sends ids the caller does own.
 *
 * The rule enforced here is structural: an action that accepts a row id must
 * either look it up with a scope key in the same where clause, or compare the
 * row's own eventId/organizationId afterwards. Structural rather than
 * behavioural because behaviour can only test the cases someone thought of,
 * and this catches the next action written as well as the ones here now.
 */

const ACTIONS_DIR = join(process.cwd(), "src", "app", "actions");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

interface Action {
  file: string;
  name: string;
  params: string;
  body: string;
}

function actionsIn(file: string): Action[] {
  const src = stripComments(readFileSync(join(ACTIONS_DIR, file), "utf8"));
  const out: Action[] = [];
  const re = /export async function (\w+)\s*\(([\s\S]*?)\)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const next = src.indexOf("\nexport ", m.index + 1);
    out.push({
      file,
      name: m[1],
      params: m[2],
      body: src.slice(m.index, next === -1 ? undefined : next),
    });
  }
  return out;
}

/** Parameter names that identify a row the caller does not necessarily own. */
const ROW_ID =
  /^\w*(stage|match|player|team|course|tee|series|member|account|event|flight|prize|group|announcement|card|organization)Id$/i;

function rowIdParams(a: Action): string[] {
  return [...a.params.matchAll(/(\w+)\s*[?]?\s*:\s*string/g)]
    .map((m) => m[1])
    .filter((n) => ROW_ID.test(n));
}

/**
 * Whether the body narrows the row to something the caller owns.
 *
 * Both shapes count: a scope key inside the lookup's where clause, and an
 * explicit comparison after fetching. Shorthand properties (`{ id, eventId }`)
 * are the common style here and must match, which an earlier version of this
 * check missed — it reported eight clean actions as holes.
 */
function isScoped(body: string): boolean {
  return (
    // A scope key inside the lookup that fetches the row.
    /where:\s*\{[\s\S]{0,240}?\b(eventId|organizationId)\b/.test(body) ||
    // Or an explicit comparison once it's fetched.
    /\b\w*\.?(eventId|organizationId)\s*(!==|===)/.test(body) ||
    // Or a helper that does one of those and throws — `stageInEvent` in
    // teams.ts is the pattern: findUnique, then `stage.eventId !== eventId`.
    /\b\w+InEvent\s*\(/.test(body) ||
    // Or an access check run against the target id itself, which is a
    // stronger answer than ownership — switchEvent asks whether this caller
    // may open this tournament at all.
    /effectiveAccess\s*\(/.test(body)
  );
}

/**
 * Actions that legitimately take an id needing no ownership check, each with
 * the reason. Anything added here is a deliberate decision on the record — an
 * unexplained entry is how this test would quietly stop protecting anything.
 */
const EXEMPT: Record<string, string> = {
  "auth.ts:signInWithPassword": "pre-auth by definition; resolves its own scope from credentials",
  "auth.ts:claimPassword": "pre-auth; the token is the authorization",
  "auth.ts:resetPassword": "pre-auth; the token is the authorization",
  "auth.ts:signUp": "pre-auth; creates the scope rather than entering one",
  "play.ts:redeemRoundCode": "the code IS the credential; rate limited separately",
  "play.ts:claimPlayerSlot": "same code-based auth, same shared rate limit",
};

describe("no action trusts a row id it was handed", () => {
  const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"));

  it("finds the action files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("finds actions that take row ids at all", () => {
    // If the parser broke, every assertion below would pass vacuously.
    const withIds = files.flatMap(actionsIn).filter((a) => rowIdParams(a).length > 0);
    expect(withIds.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    it(`${file} — every row id is narrowed to the caller's scope`, () => {
      for (const a of actionsIn(file)) {
        const ids = rowIdParams(a);
        if (!ids.length) continue;
        if (EXEMPT[`${file}:${a.name}`]) continue;
        expect(
          isScoped(a.body),
          `${file}:${a.name}(${ids.join(", ")}) accepts a row id without checking it belongs to the caller`,
        ).toBe(true);
      }
    });
  }

  it("keeps every exemption explained", () => {
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${key} needs a real reason`).toBeGreaterThan(20);
      const [file, name] = key.split(":");
      const found = actionsIn(file).some((a) => a.name === name);
      expect(found, `${key} is exempted but no longer exists — remove it`).toBe(true);
    }
  });
});

describe("the club theme cannot inject CSS", () => {
  // saveOrganizationTheme stores a hex a club typed, and the layout renders the
  // theme through dangerouslySetInnerHTML. The hex never reaches the output —
  // themeCss regenerates every value — but both halves of that need pinning.
  const themes = readFileSync(join(process.cwd(), "src", "lib", "themes.ts"), "utf8");
  const layout = readFileSync(
    join(process.cwd(), "src", "app", "(app)", "layout.tsx"),
    "utf8",
  );

  it("filters every emitted declaration through a value whitelist", () => {
    expect(themes).toMatch(/SAFE_CSS_VALUE/);
    expect(themes).toMatch(/\.filter\(\(\[, v\]\) => SAFE_CSS_VALUE\.test\(v\)\)/);
  });

  it("renders the theme from themeCss and nothing else", () => {
    // A stylesheet built anywhere but themeCss would skip the whitelist.
    expect(layout).toMatch(/dangerouslySetInnerHTML=\{\{ __html: themeStyleSheet \}\}/);
    expect(layout).toMatch(/const themeStyleSheet = themeCss\(/);
  });

  it("validates both colours and the appearance on save", () => {
    const org = stripComments(
      readFileSync(join(ACTIONS_DIR, "organization.ts"), "utf8"),
    );
    const body = org.slice(org.indexOf("export async function saveOrganizationTheme"));
    expect(body).toMatch(/hexToHsl\(themeHex\)/);
    expect(body).toMatch(/hexToHsl\(secondaryHex\)/);
    expect(body).toMatch(/isThemeKey\(themeKey\)/);
    expect(body).toMatch(/SECONDARY_PRESETS\.some/);
    expect(body).toMatch(/isAppearance\(appearance\)/);
    // And it is still an organizer-only write.
    expect(body).toMatch(/org\.canEdit/);
  });
});
