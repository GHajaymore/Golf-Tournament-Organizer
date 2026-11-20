import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
// Server actions pull in Prisma; a component only holds them until a press. (`then` stays undefined: see render.test.tsx.)
function actionModule() {
  return new Proxy({}, { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) }) as Record<string, unknown>;
}
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/round-day", actionModule);
vi.mock("@/app/actions/billing", actionModule);

const { RoundDeadlineControl } = await import("@/components/RoundDeadlineControl");
const { EntryTermsCard } = await import("@/components/EntryTermsCard");
const { RoundDaySetup } = await import("@/components/RoundDaySetup");
const { PlanBilling } = await import("@/components/PlanBilling");
const { ScopeLockBanner, SCOPE_LOCK_REASON_ID, scopeLockBannerDrawn } = await import("@/components/ScopeLockBanner");
const { locksFor, scopeLockOf } = await import("@/lib/domain/tournament-status");
const { facts, launched } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");

/**
 * A GREYED CONTROL SAYS WHY, BY MARKUP, AND A CARD HAS ONE FILLED BUTTON
 * (the console sweep's findings, J51, fixed on the screens).
 *
 * `e2e/console-sweep.spec.ts` walks the console in a browser at 320 pixels and
 * is the proof on the whole screen. This holds the same two promises where no
 * browser runs, on the components that were fixed: every disabled control in
 * the markup names, with `aria-describedby`, an element that is IN the markup
 * and holds a sentence; and the filled button (`btn-primary`) is one to a card
 * or row. It reads the markup the component draws, so taking a link away, or
 * the sentence it points at, goes red here in seconds.
 */
const draw = (el: ReactElement) => renderToStaticMarkup(el);

/** Every opening tag of a control, with its attributes as written. */
const controls = (html: string) => [...html.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)].map((m) => ({ tag: m[1], attrs: m[2] }));
const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];
const isOff = (attrs: string) => /(?:^|\s)disabled=""/.test(attrs);
/** The words of the element with this id, tags taken out; null when the id is nowhere in the markup. */
const wordsAt = (html: string, id: string): string | null => {
  const open = new RegExp(`<([a-z0-9]+)\\b[^>]*\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`).exec(html);
  if (!open) return null;
  const rest = html.slice(open.index + open[0].length);
  // To the tag that closes THIS element: one of its own kind nested inside it opens and closes on the way.
  let depth = 1;
  let end = rest.length;
  for (const m of rest.matchAll(new RegExp(`<(/?)${open[1]}\\b[^>]*>`, "g"))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      end = m.index;
      break;
    }
  }
  return rest.slice(0, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};
/** The disabled controls that point at no sentence in the markup, as written; `[]` is the promise kept. */
const silent = (html: string, opts: { except?: RegExp } = {}) =>
  controls(html)
    .filter((c) => isOff(c.attrs) && !(opts.except && opts.except.test(c.attrs)))
    .filter((c) => {
      const ids = (attr(c.attrs, "aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      return !ids.some((id) => (wordsAt(html, id) ?? "").split(/\s+/).length >= 4);
    })
    .map((c) => `<${c.tag}${c.attrs}>`);
const disabledCount = (html: string) => controls(html).filter((c) => isOff(c.attrs)).length;
const filled = (html: string) => (html.match(/class="[^"]*\bbtn-primary\b[^"]*"/g) ?? []).length;

describe("the helper can see a silent control (control)", () => {
  it("finds a disabled box with no link, a link to nothing, and a link to a caption; passes one that points at a sentence", () => {
    expect(silent(`<input disabled=""/>`)).toHaveLength(1);
    expect(silent(`<input disabled="" aria-describedby="why"/>`)).toHaveLength(1);
    expect(silent(`<input disabled="" aria-describedby="why"/><p id="why">Round one</p>`)).toHaveLength(1);
    expect(silent(`<input disabled="" aria-describedby="why"/><p id="why">Round 1 has scores, so it is locked.</p>`)).toEqual([]);
    expect(silent(`<input aria-describedby="nowhere"/>`)).toEqual([]);
    expect(filled(`<button class="btn btn-primary">a</button><button class="btn btn-secondary">b</button><button class="btn btn-primary btn-block">c</button>`)).toBe(2);
  });
});

describe("the scoring window: the greyed button of the three is the choice in force, and points at what it does", () => {
  const base = { stageId: "s1", roundLabel: "Round 2", deadline: "2099-01-01", today: "2026-10-11" };
  for (const [override, deadline, button, says] of [
    [null, "2099-01-01", "Follow the date", "Scoring follows the Play by date."],
    [true, "2099-01-01", "Close Round 2 now", "No further scores for this round, whatever the date says."],
    [false, "2026-08-01", "Keep it open", "Scores are still being accepted even though the date has passed."],
    // Kept open before the date: not yet extended, and not following the date either. The sentence must not say it follows.
    [false, "2099-01-01", "Keep it open", "Scoring will stay open after the Play by date passes."],
  ] as const) {
    it(`${button}, with the date ${deadline < base.today ? "passed" : "ahead"}`, () => {
      const html = draw(<RoundDeadlineControl {...base} deadline={deadline} override={override} />);
      expect(disabledCount(html)).toBe(1);
      expect(silent(html)).toEqual([]);
      const off = controls(html).find((c) => isOff(c.attrs))!;
      expect(wordsAt(html, attr(off.attrs, "aria-describedby")!)).toContain(says);
    });
  }
});

describe("the pin sheet: an off-side box greyed by C points at the sentence that says so", () => {
  it("every greyed box on a blank sheet, and none once a side is chosen", () => {
    const blank = draw(<RoundDaySetup stageId="s1" roundLabel="Round 1" holes={9} pars={[4, 4, 3, 5, 4, 4, 3, 5, 4]} sheet={[]} paceMinutes={0} />);
    expect(disabledCount(blank)).toBe(9);
    expect(silent(blank)).toEqual([]);
    expect(blank).toContain("A pin on C, the middle, has no off side.");
    const set = draw(<RoundDaySetup stageId="s1" roundLabel="Round 1" holes={1} pars={[4]} sheet={[{ on: 22, side: "R", off: 6 }]} paceMinutes={0} />);
    expect(disabledCount(set)).toBe(0);
  });
});

describe("the entry terms", () => {
  const entries = (over: Record<string, unknown>) =>
    ({ open: false, linkPublished: false, state: "not-published", label: "Not open", line: "Entries are not open yet.", status: {}, action: { do: "open", label: "Open entries" }, ...over }) as never;
  const card = (over: Record<string, unknown> = {}) => ({
    entries: entries({}), regOpens: "", regDeadline: "", capacity: 32, planLimit: null, approveMode: false, showApproval: () => {}, locked: false, canAdd: true, ...over,
  });
  // The save button with nothing to save is its own reason (the sweep's exemption); everything else greyed must point somewhere.
  const SAVE = /btn-(primary|secondary)/;

  it("locked: every greyed term points at the sentence beside the save button", () => {
    const html = draw(<EntryTermsCard {...card({ locked: true })} />);
    expect(disabledCount(html)).toBeGreaterThanOrEqual(7);
    expect(silent(html, { except: SAVE })).toEqual([]);
    expect(html).toContain("The field is locked, so the terms are read-only.");
  });

  it("an assistant: the terms point at who can change them", () => {
    const html = draw(<EntryTermsCard {...card({ isAdmin: false })} />);
    expect(disabledCount(html)).toBeGreaterThanOrEqual(5);
    expect(silent(html, { except: SAVE })).toEqual([]);
    expect(html).toContain("Only an organizer can change the entry terms.");
  });

  it("open for change: nothing but the idle save button is greyed, and nothing points at a missing sentence", () => {
    const html = draw(<EntryTermsCard {...card()} />);
    expect(disabledCount(html)).toBe(1);
    expect(html).not.toContain("aria-describedby");
  });

  it("one filled button, whichever state: Open entries while shut, the save button once open", () => {
    const shut = draw(<EntryTermsCard {...card()} />);
    expect(filled(shut)).toBe(1);
    expect(shut).toMatch(/class="btn btn-primary"[^>]*>(<[^>]+>)*\s*Open entries/);
    const open = draw(<EntryTermsCard {...card({ entries: entries({ open: true, linkPublished: true, state: "open", label: "Open", action: { do: "close", label: "Close entries" } }) })} />);
    expect(filled(open)).toBe(1);
    expect(open).toMatch(/class="btn btn-secondary"[^>]*>(<[^>]+>)*\s*Close entries/);
    const finished = draw(<EntryTermsCard {...card({ entries: entries({ state: "closed-finished", action: null }) })} />);
    expect(filled(finished)).toBe(1);
  });
});

describe("the plan buttons: one plan to a row, the year filled and the month outlined", () => {
  it("two plans are two rows of one filled button each", () => {
    const html = draw(
      <PlanBilling
        offers={[
          { plan: "birdie", interval: "year", label: "Birdie · $490/yr" },
          { plan: "birdie", interval: "month", label: "Birdie · $49/mo" },
          { plan: "eagle", interval: "year", label: "Eagle · $1,750/yr" },
          { plan: "eagle", interval: "month", label: "Eagle · $175/mo" },
        ]}
        hasSubscription={false}
        pastDue={false}
        canEdit
      />,
    );
    const rows = html.match(/<li\b[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.map(filled)).toEqual([1, 1]);
    expect(rows[0]).toContain("Birdie · $490/yr");
    expect(rows[0]).toContain("Birdie · $49/mo");
    expect(rows[1]).toContain("Eagle · $1,750/yr");
    // …and no filled button outside a row.
    expect(filled(html)).toBe(2);
  });
});

describe("the lock banner's words have an address, for the controls the lock shuts", () => {
  const sides = scopeLockOf(locksFor(launched(facts())), "sides")!;

  it("the reason id is on the words, and the correction button is not inside it", () => {
    const html = draw(<ScopeLockBanner locks={[sides]} isAdmin />);
    const words = wordsAt(html, SCOPE_LOCK_REASON_ID)!;
    expect(words).toContain("Locked because the tournament is live.");
    // The words' own column only: the button's words are not part of the reason a control is described by.
    const column = html.slice(html.indexOf(`id="${SCOPE_LOCK_REASON_ID}"`));
    expect(column.slice(0, column.indexOf("<button"))).toContain("Locked because the tournament is live.");
    expect(html.indexOf("<button")).toBeGreaterThan(html.indexOf("Locked because the tournament is live."));
  });

  it("under way with no lock line: the day's two sentences are the reason", () => {
    const html = draw(<ScopeLockBanner locks={[]} isAdmin open={["You can withdraw a player or put one back.", "The format, rounds and players’ details stay locked."]} />);
    expect(wordsAt(html, SCOPE_LOCK_REASON_ID)).toContain("players’ details stay locked.");
  });

  it("`scopeLockBannerDrawn` is the banner's own answer: a screen points at the id only where it is drawn", () => {
    const cases: Array<[Parameters<typeof scopeLockBannerDrawn>, boolean]> = [
      [[[], null, null], false],
      [[[], undefined, undefined], false],
      [[[sides], null, null], true],
      [[[], null, ["Under way."]], true],
      [[[], { scope: "field" }, null], true],
    ];
    for (const [args, drawn] of cases) {
      expect(scopeLockBannerDrawn(...args), JSON.stringify(args)).toBe(drawn);
      const html = draw(<ScopeLockBanner locks={args[0] as never} correction={(args[1] as never) ?? null} open={args[2]} isAdmin />);
      expect(html.includes(`id="${SCOPE_LOCK_REASON_ID}"`), JSON.stringify(args)).toBe(drawn);
    }
  });
});
