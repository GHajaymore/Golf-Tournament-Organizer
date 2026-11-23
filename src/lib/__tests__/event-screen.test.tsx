import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
function actionModule() {
  return new Proxy({}, { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) }) as Record<string, unknown>;
}
vi.mock("@/app/actions/courses", actionModule);
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/settings", actionModule);

import { EventScreen, type EventScreenProps } from "@/components/event/EventScreen";

/**
 * EVENT, AS REDESIGNED (R3): ONE SCREEN, ONE SAVE, AND EACH THING DRAWN ONCE.
 *
 * The screen asks what, when and where, and keeps them with one Save. The old screen and the new are never
 * drawn together: the page chooses by `shown.has("event")`, and every block that has a room of its own is drawn
 * there only while that room is not shown (R3-1's booleans; `event-blocks-are-mounted-once.test.tsx`).
 */

const TEE = { id: "t1", name: "White", courseRating: 71.2, slopeRating: 125, rated: true };

const base = (over: Partial<EventScreenProps> = {}): EventScreenProps => ({
  initial: {
    name: "zz-Spring Medal", playKind: "tournament", startOn: "2099-06-12", endOn: "2099-06-13", dates: "Jun 12 - 13, 2099",
    datesTentative: false, format: "stroke", course: "zz Hollins Moss", courseId: "c1", courseMode: "fixed", city: "Leeds",
    address: "", playerCountMode: "registration",
  },
  locked: false,
  canEdit: true,
  courses: [
    { id: "c1", name: "zz Hollins Moss", city: "Leeds", address: "" },
    { id: "c2", name: "zz Green Crest", city: "York", address: "" },
  ],
  venueIds: ["c1"],
  where: "one",
  tees: [TEE],
  defaultTeeId: null,
  teesDoor: null,
  teePolicy: "one",
  roundFormats: ["Stroke Play"],
  marks: { name: null, dates: null, where: null },
  lock: { locks: [], correction: null, isAdmin: true, open: null },
  addCourseHref: null,
  coursesAnchor: true,
  formatting: <div data-formatting />,
  ...over,
});

const draw = (over: Partial<EventScreenProps> = {}) => renderToStaticMarkup(<EventScreen {...base(over)} />);
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the Event screen asks what, when and where, and has one Save", () => {
  const html = draw();

  it("draws the three jobs and the tees beside the course", () => {
    for (const section of ["event-what", "event-when", "event-where"]) expect(count(html, `data-section="${section}"`), section).toBe(1);
    expect(count(html, 'id="default-tee"')).toBe(1);
    expect(html.indexOf('data-section="event-where"')).toBeLessThan(html.indexOf('id="default-tee"'));
  });

  it("has ONE Save button, and the dates have none of their own", () => {
    const primary = html.match(/<button[^>]*btn-primary[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(primary).toHaveLength(1);
    expect(primary[0]).toMatch(/Saved?\b/);
    expect(html).not.toContain("Save dates");
  });

  it("does not draw the player count, the entry terms or the old summary and journey cards", () => {
    for (const gone of ["Player count", "Target player count", "Where the field size comes from", "Tournament identity"]) expect(html, gone).not.toContain(gone);
  });

  it("offers two courses to every kind of event", () => {
    for (const kind of ["tournament", "league", "outing"]) {
      const h = draw({ initial: { ...base().initial, playKind: kind }, where: "several", venueIds: ["c1", "c2"] });
      expect(h, kind).toContain("More than one course");
    }
    expect(draw({ where: "several", venueIds: ["c1", "c2"] })).toContain("data-event-venues");
  });

  it("puts 'the players arrange their own' under More, and says so where the course would be", () => {
    const h = draw({ initial: { ...base().initial, courseMode: "open", course: "", courseId: "" }, where: "open" });
    expect(h).toContain("The players arrange their own course");
    expect(h).not.toContain('id="default-tee"');
    expect(h).toContain("No fixed course: the players arrange their own");
  });

  it("a name that is missing carries the machine's mark", () => {
    const h = draw({ marks: { name: "required", dates: null, where: "required-before-launch" } });
    expect(h).toContain('data-mark="required"');
    expect(h).toContain("Required before launch");
  });
});

describe("a locked event shows its details as text and keeps only the dates", () => {
  const lock = {
    locks: [{ scope: "details", by: "launch", because: "Locked because the tournament is live.", wayOut: { says: "Open a correction", href: "/dashboard" }, correctable: true }] as EventScreenProps["lock"]["locks"],
    correction: null,
    isAdmin: true,
    open: null,
  };
  const html = draw({ locked: true, lock });

  it("draws the lock once, with no field repeating it", () => {
    expect(count(html, 'data-locked-once="locked"')).toBe(1);
  });

  it("reads the name and the course as text, with no control for them", () => {
    expect(html).toContain("zz-Spring Medal");
    expect(html).not.toContain('placeholder="Name your tournament"');
    expect(html).not.toContain('name="event-where"');
  });

  it("still lets the dates and the tees change", () => {
    expect(html).toContain('aria-label="Tournament dates, first day"');
    expect(html).toContain("The days and the tees can still change after launch.");
  });
});

describe("the page mounts the old screen or the new, never both", () => {
  const page = readSource("src/app/(app)/event/page.tsx");

  it("chooses by the one question", () => {
    expect(page).toMatch(/const eventShown = shown\.has\("event"\)/);
    expect(page).toMatch(/\{eventShown \? \(\s*<EventScreen[\s\S]*?\) : \(\s*<>\s*<EventSetupClient/);
    expect(count(page, "<EventScreen")).toBe(1);
    expect(count(page, "<EventSetupClient")).toBe(1);
  });

  it("draws the lock's banner once: the old page's only while the new screen is not shown", () => {
    expect(page).toMatch(/\{!eventShown && <ScopeLockBanner/);
    expect(count(page, "<ScopeLockBanner")).toBe(1);
  });

  it("leaves the course library to Courses once that is shown", () => {
    expect(page).toMatch(/const libraryHere = !eventShown \|\| !shown\.has\("courses"\)/);
    expect(page).toMatch(/\{libraryHere && \(\s*<SettingsSectionAnchor id="courses">/);
  });

  it("runs the one plan (event-save-plan.test.ts holds what is in it)", () => {
    const screen = readSource("src/components/event/EventScreen.tsx");
    expect(screen).toMatch(/eventSavePlan\(\{/);
    expect(screen).toMatch(/runSavePlan\(/);
  });
});

describe("the review's states", () => {
  it("the event's own course is ticked and shut among the venues", () => {
    const h = draw({ where: "several", venueIds: ["c1", "c2"] });
    const venues = h.slice(h.indexOf("data-event-venues"));
    const own = venues.match(/<label[^>]*>(<input[^>]*>)<span[^>]*>zz Hollins Moss([\s\S]*?)<\/label>/);
    expect(own, "the event's own course is not in the list").not.toBeNull();
    expect(own![1]).toMatch(/checked/);
    expect(own![1]).toMatch(/disabled/);
    expect(own![2]).toMatch(/the event.{1,8}s course/);
    // CONTROL: another course is neither ticked nor shut.
    const other = venues.match(/<label[^>]*>(<input[^>]*>)<span[^>]*>zz Green Crest/);
    expect(other![1]).not.toMatch(/disabled/);
  });

  it("'One course' is shut, and says why, while more than one venue is stored", () => {
    const h = draw({ where: "several", venueIds: ["c1", "c2"] });
    const radios = h.match(/<input[^>]*name="event-where"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios.filter((r) => /disabled/.test(r))).toHaveLength(1);
    expect(radios.find((r) => /disabled/.test(r))).toMatch(/type="radio"/);
    expect(h).toContain("Played on 2 courses. Untick all but one to play on one course.");
    expect(draw()).not.toContain("data-one-course-shut");
  });

  it("a locked event keeps the tees as a control and reads the stored name, not a typed one", () => {
    const h = draw({ locked: true, lock: { locks: [{ scope: "details", by: "launch", because: "x", wayOut: { says: "y", href: "/z" }, correctable: true }] as EventScreenProps["lock"]["locks"], correction: null, isAdmin: true, open: null } });
    expect(h).toContain('id="default-tee"');
    expect(h).toContain("zz-Spring Medal");
  });
});
