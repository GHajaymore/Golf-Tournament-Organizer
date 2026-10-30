import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource, stripComments } from "./source";
import {
  CLUB_WORD_TOKEN,
  GOLF_REGISTERS,
  GOLF_TERMS,
  casualRoundKinds,
  golfTermsFor,
  inClubWords,
  type GolfRegister,
} from "@/lib/domain/golf-terms";
import { GUIDE_STEPS, guideInClubWords } from "@/lib/guide-steps";
import { PLAYER_HELP_TOPICS, helpInClubWords } from "@/lib/player-help";
import { HONOURS_LOCKED, PLANS, planBlurb, planTagline, upgradeBenefits } from "@/lib/plans";
import { INTEREST_COPY, INTEREST_ROLES, checkInterest, interestWords, roleLabel } from "@/lib/domain/interest";

/**
 * EVERY COUNTRY'S GOLF, FROM ONE TABLE (Ajay, 2026-10-24: "we are using
 * societies a lot. in US its Leagues. We need to represent all geographies").
 *
 * `golf-terms.ts` holds the words a golfer reads differently by country —
 * league or society, outing or society day or golf day, foursome or fourball,
 * cart or buggy — and `docs/country-words.md` is the table they came from. This
 * file holds the rest of the app to it: a word from that table typed into a
 * screen is one country's golf shown to every club, which is how a US league
 * came to be told about "Leagues and societies" on its own guide.
 *
 * BAN THE SHAPE, NOT THE SPELLING (the lesson of the handicap sweep in
 * CLAUDE.md). The guard does not look for a list of known sentences; it reads
 * every piece of TEXT a person can see — string literals and JSX text, after
 * `readSource` has taken the comments out — and refuses any of the table's
 * words in it, in any register, wherever it sits. A string that is one bare
 * word ("society", "foursome") is a code value, not a sentence, and is left
 * alone; so is an identifier (`PLANS.society`), which is never inside text.
 *
 * What it cannot see, said plainly:
 *  - "foursomes" in the plural, which is also the Rules' FORMAT (alternate
 *    shot). The singular is the group and is refused; the plural is left to
 *    the reader, and to the format sweep that keeps format names whole.
 *  - "organizer" in the US spelling, outside the guide and the Help. It is in
 *    some two thousand places, most of them code and prose; the screens a
 *    person reads most were converted earlier (`golf-words-come-from-the-club`)
 *    and the rest is in `docs/country-words.md` as owed. "organiser" — the UK
 *    spelling typed by hand — IS refused everywhere.
 *  - A word built from pieces at runtime. The table is the only source, so a
 *    piece would have to come from it anyway.
 */

const ROOT = process.cwd();

/** Every source file a screen, an email, a sheet or a guide is drawn from. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(relative(ROOT, p).replace(/\\/g, "/"));
    }
  }
  return out;
}

/**
 * THE TEXT IN A FILE: what a person could read — every string literal, every
 * piece of a template literal and every run of JSX text, read by the
 * TypeScript parser rather than by a pattern, so an apostrophe in "don't" or a
 * quote inside a regular expression cannot knock it out of step. Comments are
 * not text (and `readSource` has taken them out already). One bare word with
 * no space in it is a code value — `kind === "society"` — and is dropped.
 */
export function readableText(code: string, file = "x.tsx"): string[] {
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, false, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push(node.text);
    } else if (ts.isJsxText(node)) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out
    // A token (`{golfGroup}`) is the table speaking, not a word typed here.
    .map((t) => t.replace(CLUB_WORD_TOKEN, " "))
    .filter((t) => /\s/.test(t.trim()) || /^[A-Z]/.test(t.trim()));
}

/** A word as a reader sees it: not part of a class name, a path or an identifier. */
const word = (body: string) => new RegExp(`(?<![\\w.#/-])(?:${body})(?![\\w-])`, "i");

/** Every word of the table, in every register. */
const ANY_REGISTER: readonly RegExp[] = [
  word("societ(?:y|ies)"),
  word("golf groups?"),
  word("fourballs?"),
  word("foursome"),
  word("(?:three|two)somes?"),
  word("bugg(?:y|ies)"),
  word("carts?"),
  word("outings?"),
  word("(?:golf|away|society|charity) days?"),
  word("honou?rs boards?"),
  word("organis(?:er|ers)"),
];

/**
 * The front door and its pages are AUTHORED IN US WORDS and swapped per
 * edition (`landing/edition.ts`, `inDialect`), so a US word there is right and
 * becomes the visitor's. What must never be typed there is the OTHER
 * registers' words, which no swap turns back into US golf.
 */
const NOT_US: readonly RegExp[] = [
  word("societ(?:y|ies)"),
  word("fourballs?"),
  word("bugg(?:y|ies)"),
  word("organis(?:er|ers)"),
  word("(?:golf|away|society|charity) days?"),
  word("honours boards?"),
];

const LANDING_FAMILY = [
  "src/app/page.tsx",
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/faq/page.tsx",
  "src/app/interest/page.tsx",
  "src/lib/landing/",
  "src/components/landing/",
];

/**
 * THE ALLOW-LIST, and why each is on it. Short on purpose: every entry is a
 * place that HOLDS the words for a reason, never a screen that prints them.
 */
const ALLOWED: Record<string, string> = {
  "src/lib/domain/golf-terms.ts": "the table itself — the one source",
  "src/lib/domain/org-profile.ts":
    "COMMUNITY_VOICES: the words of each name a club may choose for itself (society, league, association); the default comes from GOLF_TERMS.community",
  "src/components/OrgNounPicker.tsx":
    "the picker that explains the choice between society and league names both, on purpose",
  "src/lib/domain/play-kind.ts":
    "the word an organizer CHOOSES for one tournament (Outing, Society day, Charity day…); every country's words are offered on purpose",
  "src/lib/domain/expense-categories.ts":
    "the matcher that reads what anybody types (cart, buggy, trolley) and the category's own key; screens label it from the club's terms",
  "src/lib/domain/org-name-match.ts": "a word list that reads club names (\"golf society\" → \"gs\")",
};

/**
 * One line the front door deliberately leaves unswapped: the list of things
 * the app follows per club, which names both words so either reader sees it
 * can.
 */
const ALLOWED_LINES: ReadonlyArray<{ file: string; text: string; why: string }> = [
  { file: "src/app/page.tsx", text: "Carts or buggies", why: "names both on purpose: the app follows the club's word" },
];

function bannedFor(file: string): readonly RegExp[] {
  return LANDING_FAMILY.some((p) => file === p || (p.endsWith("/") && file.startsWith(p))) ? NOT_US : ANY_REGISTER;
}

function hitsIn(file: string, code: string): string[] {
  const banned = bannedFor(file);
  const hits: string[] = [];
  for (const text of readableText(code, file)) {
    if (ALLOWED_LINES.some((a) => a.file === file && text.includes(a.text))) continue;
    for (const re of banned) {
      const m = text.match(re);
      if (m) hits.push(`${file}: "${m[0]}" in ${JSON.stringify(text.trim().slice(0, 120))}`);
    }
  }
  return hits;
}

describe("a country's golf word is never typed into a screen", () => {
  it("CONTROL: the shape is caught — in JSX, a label, a template and a sentence", () => {
    const code = stripComments(`
      const a = <p>Run your society day here</p>;
      const b = { label: "Society settings" };
      const c = \`Thursday Society \${x}\`;
      const d = "Put one in every cart and one on the first tee.";
      const e = <span>Leagues and societies</span>;
      const f = "Ask your organiser.";
    `);
    const hits = hitsIn("src/components/Example.tsx", code);
    // Six sentences, every one caught ("society day" is caught twice over).
    expect(new Set(hits.map((h) => h.slice(h.indexOf(" in ")))).size).toBe(6);
    // The guide's plan card and the plan panel's tagline, as they were.
    expect(hitsIn("src/app/(app)/guide/page.tsx", stripComments(`{ where: "Leagues and societies" }`))).toHaveLength(1);
    expect(hitsIn("src/lib/plans.ts", stripComments(`blurb: "For a league, society or golf group running a full season"`))).toHaveLength(2);
  });

  it("CONTROL: code is not text — keys, identifiers, class names and a comment", () => {
    const code = stripComments(`
      // A society day is a comment.
      const k = PLANS.society.name;
      if (kind === "society") {}
      const icons = { foursome: "ph ph-users-four" };
      const css = ".foursome-card { border: 1px }";
      const t = terms.cart;
    `);
    expect(hitsIn("src/components/Example.tsx", code)).toEqual([]);
  });

  it("CONTROL: the front door may say US words and may not say British ones", () => {
    expect(hitsIn("src/app/page.tsx", stripComments(`<li>Golf outings</li>`))).toEqual([]);
    expect(hitsIn("src/app/page.tsx", stripComments(`<li>Society days</li>`))).toHaveLength(2);
  });

  const files = sourceFiles(join(ROOT, "src"));

  it("reads the whole of src", () => {
    // A sweep that finds nothing may be reading nothing.
    expect(files.length).toBeGreaterThan(400);
    expect(files).toContain("src/lib/guide-steps.ts");
    expect(files).toContain("src/components/PlanPanel.tsx");
  });

  it("no file outside the allow-list types one", () => {
    const hits = files.filter((f) => !ALLOWED[f]).flatMap((f) => hitsIn(f, readSource(f)));
    expect(hits).toEqual([]);
  });

  it("every allow-list entry is a real file that still holds a word", () => {
    for (const [file, why] of Object.entries(ALLOWED)) {
      expect(files, file).toContain(file);
      expect(why.length, file).toBeGreaterThan(20);
      const banned = ANY_REGISTER;
      const holds = readableText(readSource(file), file).some((t) => banned.some((re) => re.test(t)));
      expect(holds, `${file} holds none of the words — take it off the list`).toBe(true);
    }
    for (const a of ALLOWED_LINES) expect(readSource(a.file)).toContain(a.text);
  });
});

/** Every token-bearing table a screen fills, with the club's words. */
function tokenTables(): string[] {
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(GUIDE_STEPS);
  walk(PLAYER_HELP_TOPICS);
  walk(Object.values(PLANS).map((p) => [p.tagline, p.blurb]));
  walk(INTEREST_COPY.labels);
  walk([INTEREST_COPY.sentPlayer, INTEREST_COPY.share]);
  walk(INTEREST_ROLES);
  walk([HONOURS_LOCKED, ...upgradeBenefits("free")]);
  return strings;
}

describe("the tokens the tables carry", () => {
  it("are all terms of the table", () => {
    const unknown = new Set<string>();
    for (const s of tokenTables()) {
      for (const m of s.matchAll(CLUB_WORD_TOKEN)) {
        const key = m[1].charAt(0).toLowerCase() + m[1].slice(1);
        if (!(key in GOLF_TERMS)) unknown.add(m[0]);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("CONTROL: a token that is not a term stays on the page, where this test sees it", () => {
    expect(inClubWords("Ask your {organiser}", golfTermsFor("uk"))).toBe("Ask your {organiser}");
  });

  for (const r of GOLF_REGISTERS) {
    it(`are all filled in for ${r}, with nothing left in braces`, () => {
      const words = golfTermsFor(r);
      const left = [
        ...JSON.stringify(guideInClubWords(words)).matchAll(CLUB_WORD_TOKEN),
        ...JSON.stringify(helpInClubWords(words)).matchAll(CLUB_WORD_TOKEN),
        ...Object.values(PLANS).flatMap((p) => [...`${planTagline(p, words)} ${planBlurb(p, words)}`.matchAll(CLUB_WORD_TOKEN)]),
      ].map((m) => m[0]);
      expect(left).toEqual([]);
    });
  }
});

describe("what each register reads, where Ajay looked", () => {
  const cases: Record<GolfRegister, { tagline: string; club: string; help: RegExp; casual: string }> = {
    us: {
      tagline: "Leagues and golf groups",
      club: "Club or golf group",
      help: /Ask your organizer\./,
      casual: "A match, a stroke-play round or a foursome",
    },
    uk: {
      tagline: "Leagues and societies",
      club: "Club or society",
      help: /Ask your organiser\./,
      casual: "A match, a medal or a fourball",
    },
    au: {
      tagline: "Leagues and golf groups",
      club: "Club or golf group",
      help: /Ask your organiser\./,
      casual: "A match, a stroke round or a fourball",
    },
  };
  for (const r of GOLF_REGISTERS) {
    it(`${r}: the plan, the interest form, the Help and a casual round`, () => {
      const words = golfTermsFor(r);
      expect(planTagline(PLANS.society, words)).toBe(cases[r].tagline);
      expect(interestWords(INTEREST_COPY.labels.club, words)).toBe(cases[r].club);
      expect(JSON.stringify(helpInClubWords(words))).toMatch(cases[r].help);
      expect(casualRoundKinds(words)).toBe(cases[r].casual);
    });
  }

  it("a refusal the server sends is filled in by the form, and the owner reads US words", () => {
    const refused = checkInterest({ name: "Zz Pat", email: "zz-pat@example.invalid", club: "", role: "player" });
    expect(refused.ok).toBe(false);
    const error = !refused.ok && "error" in refused ? refused.error : "";
    expect(interestWords(error, golfTermsFor("uk"))).toMatch(/your club or society/);
    expect(interestWords(error, golfTermsFor("us"))).toMatch(/your club or golf group/);
    expect(roleLabel("society")).toBe("League or golf group organizer");
  });
});

describe("the screens that read the words have them", () => {
  it("the console, the player app and a casual round each provide the club's register", () => {
    for (const f of ["src/app/(app)/layout.tsx", "src/app/(player)/layout.tsx", "src/app/match/new/page.tsx"]) {
      expect(readSource(f), f).toMatch(/<GolfTermsProvider register=\{register\}>/);
    }
  });

  it("the guide, its search and the Help draw the club's words, not the raw tables", () => {
    const steps = readSource("src/app/(app)/guide/steps/page.tsx");
    expect(steps).toMatch(/guideInClubWords\(words\)/);
    expect(steps).not.toMatch(/GUIDE_STEPS/);
    const help = readSource("src/app/(player)/me/help/page.tsx");
    expect(help).toMatch(/helpInClubWords\(words\)/);
    expect(help).not.toMatch(/PLAYER_HELP_TOPICS/);
  });

  it("a plan's line is read through planTagline everywhere it is drawn", () => {
    // `.tagline` read bare prints "{golfGroups}" on the screen.
    for (const f of sourceFiles(join(ROOT, "src")).filter((f) => !f.endsWith("src/lib/plans.ts"))) {
      expect(readSource(f), f).not.toMatch(/PLANS\.\w+\.(tagline|blurb)\b|tagline: p\.tagline|\bplan\.tagline\b/);
    }
  });
});
