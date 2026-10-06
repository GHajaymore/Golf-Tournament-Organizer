import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { OrganizationClient } from "@/components/OrganizationClient";
import { ThemePicker } from "@/components/ThemePicker";
import { PlaySettings } from "@/components/PlaySettings";
import { HandicapSetup } from "@/components/HandicapSetup";
import { MoneySetup } from "@/components/MoneySetup";
import { OrganizationAccess } from "@/components/OrganizationAccess";
import { OrgKindPicker } from "@/components/OrgKindPicker";
import { LocalePicker } from "@/components/LocalePicker";
import { SeasonPicker } from "@/components/SeasonPicker";
import { OrgProfileProvider } from "@/components/OrgProfileProvider";
import { cleanSettings } from "@/lib/tournament-settings";
import { DEFAULT_CLUB_THEME } from "@/lib/themes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/organization",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Server actions stand in as no-ops, as in render.test.tsx.
function actionModule() {
  return new Proxy(
    {},
    { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) },
  ) as Record<string, unknown>;
}
vi.mock("@/app/actions/organization", actionModule);
vi.mock("@/app/actions/handicap-policy", actionModule);
vi.mock("@/app/actions/join", actionModule);
vi.mock("@/app/actions/money-setup", actionModule);
vi.mock("@/app/actions/settings", actionModule);
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/courses", actionModule);

/**
 * CLUB SETTINGS, SAID SHORT — the last screen of the organizer cleanup Ajay
 * approved on 2026-10-05 ("I just want a clean user experience"). Measured
 * first: 15.6 phone screens and 56 sentences of 12 words or more, the worst of
 * them a 68-word roles legend and a 59-word paragraph on logo files.
 *
 * Asserted as a RULE over every card on the screen rather than as a list of
 * sentences: nothing a reader sees without tapping runs past twenty words. The
 * long explanations are still in the page, one tap on an ⓘ away, and each test
 * below that moved one checks it is still there.
 *
 * Not swept, by reason: the plan panel's benefits are an upgrade list pinned
 * word for word by `metered-features` and `plan-copy`, and read on the pricing
 * screens too.
 */

/**
 * Two limits, because a wall can be built either way: one long sentence, or a
 * paragraph of short ones. The roles legend was the second kind — five
 * sentences, none over twenty words, sixty-eight together — and a sentence
 * rule alone passed it (mutation-tested: the first draft of this file did).
 */
const SENTENCE = 20;
const PARAGRAPH = 25;
const render = (el: ReactElement) => renderToStaticMarkup(<OrgProfileProvider kind="club">{el}</OrgProfileProvider>);

const words = (s: string) => s.replace(/\s+/g, " ").trim();
const BLOCK = /<\/?(p|div|li|label|button|option|th|td|summary|section|h\d)\b[^>]*>/g;

/** What a reader sees without tapping, one entry per block of text. */
function visibleBlocks(html: string): string[] {
  return html
    // A <details> shows its <summary> and hides the rest until tapped.
    .replace(/<details[^>]*>([\s\S]*?)<\/details>/g, (_m, inner: string) => {
      const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(inner);
      return summary ? `<p>${summary[1]}</p>` : " ";
    })
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .split("\n")
    .map(words)
    .filter(Boolean);
}
const visibleSentences = (html: string) =>
  visibleBlocks(html).flatMap((b) => b.split(/[.!?·]\s|\.$/).map(words).filter(Boolean));
/**
 * Paragraphs are `<p>` only. A choice card — a scheme, a kind of outfit — is
 * one button holding a name, a line and a consequence as separate spans laid
 * out one per line; summed, it reads as a paragraph it is not.
 */
const visibleParagraphs = (html: string) =>
  [...html.replace(/<details[^>]*>[\s\S]*?<\/details>/g, " ").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => words(m[1].replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")))
    .filter(Boolean);
const count = (s: string) => s.split(" ").length;
const tooLong = (html: string) => [
  ...visibleSentences(html).filter((s) => count(s) > SENTENCE),
  ...visibleParagraphs(html).filter((p) => count(p) > PARAGRAPH).map((p) => `paragraph: ${p}`),
];

const report = {
  events: [{ id: "e1", name: "zz-Spring Medal", dates: "" }],
  people: [
    {
      email: "pro@example.invalid", name: "zz-The Pro", orgRole: "owner", memberId: "m1",
      hasLogin: true, access: { e1: { role: "admin", source: "organization" } },
    },
    {
      email: "pl@example.invalid", name: "zz-A Player", orgRole: null, memberId: null,
      hasLogin: true, access: { e1: { role: "player", source: "event" } },
    },
  ],
};
const asks = [
  { id: "a1", name: "zz-Dana Ask", email: "zz-ask@example.invalid", note: "zz-one society, not two", createdAt: new Date() },
];

const CARDS: [string, () => string][] = [
  ["branding", () => render(
    <OrganizationClient
      name="zz-Ridgeline" shortName="" logoUrl="https://example.invalid/logo.png" city="" region="" country=""
      brandDisplay="short" kind="club" communityNoun="" plan="free" eventCount={2} memberCount={2} canEdit />,
  )],
  ["colour, dark", () => render(<ThemePicker theme={{ ...DEFAULT_CLUB_THEME, appearance: "dark" }} readOnly={false} />)],
  ["colour, light", () => render(<ThemePicker theme={{ ...DEFAULT_CLUB_THEME, appearance: "light" }} readOnly={false} />)],
  ["house defaults", () => render(<PlaySettings mode="organization" settings={cleanSettings({})} canEdit />)],
  ["handicaps", () => render(
    <HandicapSetup view={{
      policy: "club", canEdit: true,
      handicap: { providerId: "ghin", label: "GHIN", status: "unconfigured", howToEnable: "" },
      scores: { enabled: false, providerId: "ghin", label: "GHIN", status: "unconfigured", howToEnable: "" },
    }} />,
  )],
  ["what this is", () => render(<OrgKindPicker kind="club" country="" noun="" />)],
  ["dates", () => render(<LocalePicker locale="en-US" />)],
  ["season", () => render(<SeasonPicker startsOn="" endsOn="" />)],
  ["money", () => render(<MoneySetup mode="organization" orgMode="" orgKind="club" clubName="zz-Club" canEdit />)],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ["staff & access", () => render(<OrganizationAccess report={report as any} canEdit asks={asks as any} seats={2} />)],
];

describe("nothing on Club settings runs long before you tap", () => {
  it("the sweep can see a long sentence and a long paragraph — the control", () => {
    const run = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    expect(tooLong(`<p>${run(SENTENCE + 1)}.</p>`)).toHaveLength(1);
    // Short sentences, a long paragraph: the roles legend's shape.
    expect(tooLong(`<p><b>A</b> ${run(9)}. <b>B</b> ${run(9)}. <b>C</b> ${run(9)}.</p>`)).toHaveLength(1);
    // ...and neither counts what is behind an ⓘ.
    expect(tooLong(`<details><summary>Short</summary><div>${run(40)}.</div></details>`)).toEqual([]);
  });

  it.each(CARDS)("%s", (_name, html) => {
    const out = html();
    expect(visibleSentences(out).length, "rendered nothing").toBeGreaterThan(2);
    expect(tooLong(out)).toEqual([]);
  });
});

describe("the long explanations are still there, one tap away", () => {
  const card = (name: string) => CARDS.find(([n]) => n === name)![1]();

  it("the roles legend, billing and all", () => {
    const html = card("staff & access");
    expect(html).toMatch(/<summary[\s\S]*What each role means[\s\S]*<\/summary>/);
    expect(html).toContain("holds the billing");
    expect(html).toContain("Make them a Member if they join");
  });

  it("the seat count stays on the line; what a seat is, behind it", () => {
    const html = card("staff & access");
    expect(html).toMatch(/<summary[\s\S]*2 people hold a staff seat[\s\S]*<\/summary>/);
    expect(html).toContain("which is what your plan counts");
  });

  it("the posting warning keeps its irreversible half visible", () => {
    const html = card("handicaps");
    expect(html).toMatch(/<summary[\s\S]*can(&#x27;|')t be taken back[\s\S]*<\/summary>/);
    expect(html).toContain("official index at every club they play");
  });

  it("the logo help, and the not-showing hint only where a link is in use", () => {
    const html = card("branding");
    expect(html).toContain("resized and kept here");
    expect(html).toContain("Logo not showing?");
    const none = render(
      <OrganizationClient
        name="zz-Ridgeline" shortName="" logoUrl="" city="" region="" country=""
        brandDisplay="short" kind="club" communityNoun="" plan="free" eventCount={2} memberCount={2} canEdit />,
    );
    expect(none).not.toContain("Logo not showing?");
  });

  it("the sun warning on the schemes that need it", () => {
    const html = card("colour, dark");
    expect(html).toContain("switching Appearance to Light fixes every one of them");
  });

  it("what a new tournament inherits", () => {
    expect(card("house defaults")).toContain("never rewrites an event in progress");
    expect(card("money")).toContain("Prizes &amp; payouts");
  });
});
