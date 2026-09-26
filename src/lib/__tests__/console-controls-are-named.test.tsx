import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { unnamedControls } from "./unnamed-controls";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Server actions stand in as no-ops, as in render.test.tsx.
function actionModule() {
  return new Proxy(
    {},
    {
      get: (_t, key) =>
        typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined,
    },
  ) as Record<string, unknown>;
}
vi.mock("@/app/actions/series", actionModule);
vi.mock("@/app/actions/courses", actionModule);
vi.mock("@/app/actions/teams", actionModule);
vi.mock("@/app/actions/organization", actionModule);
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/event", actionModule);
vi.mock("@/app/actions/stages", actionModule);
vi.mock("@/app/actions/roster", actionModule);
vi.mock("@/app/actions/messaging", actionModule);
vi.mock("@/app/actions/register", actionModule);

/**
 * THE REST OF THE CONSOLE'S FORM CONTROLS HAVE NAMES — the follow-up
 * `first-run-controls-are-named` promised, one screen at a time.
 *
 * Measured in the browser on 2026-09-26 before fixing: on an eight-player
 * tournament `/registration` had 18 of 92 controls unnamed — every row's
 * select box and handicap box, which is why the seeded club, with a bigger
 * field, counted 58. `/organization` 5, `/prizes` 3, `/access` 2,
 * `/announcements` 2 and the Format select on `/stages`. After: zero on each,
 * re-measured in the browser.
 *
 * Each screen is rendered WITH ROWS where it has rows, because the per-row
 * controls were most of the count — an empty table would pass this whatever
 * the rows said.
 */

const render = (el: ReactElement) => renderToStaticMarkup(el);

const player = (id: string, name: string, handicap: number) => ({
  id,
  name,
  handicap,
  handicapType: "18",
  handicapSource: "manual",
  seed: 1,
  email: `${id}@example.invalid`,
  phone: "",
});

describe("the public sign-up form is named", () => {
  it("every box a member fills in to enter a tournament", async () => {
    /**
     * Not the console and not the player app, which is how #627 missed it:
     * `/register/<token>` is the first page a member ever opens, signed out.
     * Measured in the browser on 2026-09-26 on three open tournaments: all six
     * boxes unnamed — name, email, handicap, index type, mobile, tee.
     */
    const { RegisterClient } = await import("@/components/RegisterClient");
    const html = render(
      <RegisterClient
        token="zz-tok" eventName="zz-Captain's Day" formatLabel="Stroke play" regDeadline=""
        waitlistOnly={false} spotsLeft={12} approvalMode="auto" prefill={null} requirePhone />,
    );
    expect(html).toContain("Handicap index");
    expect(html).toContain("Preferred tee");
    expect(unnamedControls(html)).toEqual([]);
  });
});

describe("console form controls are named", () => {
  it("Registration & field, with players in both lists", async () => {
    const { RegistrationClient } = await import("@/components/RegistrationClient");
    const html = render(
      <RegistrationClient
        confirmed={[player("p1", "zz-Ann Doyle", 8), player("p2", "zz-Rob Ferris", 14)]}
        waitlist={[player("p3", "zz-Cleo Green", 20)]}
        pendingEntries={[]} locked={false} isAdmin roster={[]}
        event={{
          name: "zz-Club Championship", capacity: 2, status: "registration", regDeadline: "", regOpens: "",
          registrationOverride: null, inviteMessage: "Come and play", organizationName: "zz-Club",
          dates: "", course: "", city: "", registrationOpen: false, registrationApproval: "auto",
          requirePhone: false, phoneLocked: false, registrationToken: "",
        }} />,
    );
    // The rows rendered — so the per-row controls were actually checked.
    expect(html).toContain("zz-Rob Ferris");
    expect(html).toContain("zz-Cleo Green");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("Club settings", async () => {
    const { OrganizationClient } = await import("@/components/OrganizationClient");
    const html = render(
      <OrganizationClient
        name="zz-Ridgeline" shortName="" logoUrl="" city="" region="" country=""
        brandDisplay="short" kind="club" communityNoun="" plan="free" eventCount={2} memberCount={9} canEdit />,
    );
    expect(html).toContain("Organization name");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("Club staff", async () => {
    const { OrganizationAccess } = await import("@/components/OrganizationAccess");
    const { OrgProfileProvider } = await import("@/components/OrgProfileProvider");
    const report = {
      events: [{ id: "e1", name: "zz-Spring Medal", dates: "" }],
      people: [
        {
          email: "pro@example.invalid", name: "zz-The Pro", orgRole: "owner", memberId: "m1",
          hasLogin: true, access: { e1: { role: "admin", source: "organization" } },
        },
      ],
    };
    const html = render(
      <OrgProfileProvider kind="club">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <OrganizationAccess report={report as any} canEdit asks={[]} seats={1} />
      </OrgProfileProvider>,
    );
    expect(html).toContain("Add staff");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("Access", async () => {
    const { AccessClient } = await import("@/components/AccessClient");
    const html = render(
      <AccessClient accounts={[{ id: "a1", name: "zz-Ann Doyle", email: "ann@example.invalid", role: "admin" }]} />,
    );
    expect(html).toContain("zz-Ann Doyle");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("Prizes & payouts", async () => {
    const { PrizesClient } = await import("@/components/PrizesClient");
    const html = render(<PrizesClient prizes={[]} players={[]} />);
    expect(html).toContain("Add a prize");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("Announcements", async () => {
    const { AnnouncementsClient } = await import("@/components/AnnouncementsClient");
    const html = render(<AnnouncementsClient items={[]} aiAvailable={false} />);
    expect(html).toContain("Post an announcement");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("Rounds & formats — the round's own Format", async () => {
    const { StagesClient } = await import("@/components/StagesClient");
    const html = render(
      <StagesClient
        rrMatchesPerPlayer={3}
        scoring={{ winPts: 1, tiePts: 0.5, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 0 }}
        tiebreakers={[] as never[]}
        qual={{ mode: "overall", perFlight: 2, overall: 8 }}
        confirmedCount={8}
        chainsRounds={false}
        stages={[{
          id: "r1", position: 0, type: "Stroke Play Round", description: "", format: "Scramble", closed: false,
          holes: 18, playedOn: "", deadline: "", scoringBasis: "net", scoreInput: "", carryEnabled: false, carryPct: 0,
          carryAsked: false, cutEnabled: false, cutMode: "count", cutCount: 8, cutPercent: 50, cutScope: "overall",
          deadlineOverride: null, optDeadline: "", attendance: null, matchCount: 0, courseId: null, nine: "full",
          teamScoring: null, handicaps: [],
        }]} />,
    );
    expect(html).toContain("Played as a side");
    const selects = unnamedControls(html).filter((c) => c.startsWith("select"));
    expect(selects).toEqual([]);
  });

  // The completion and sign-up deadlines sit behind "Customize", which a
  // server render cannot open; they were fixed and measured in the browser.
  it("Rounds & formats — a nine-hole round's Which nine", async () => {
    const { StagesClient } = await import("@/components/StagesClient");
    const html = render(
      <StagesClient
        rrMatchesPerPlayer={3}
        scoring={{ winPts: 1, tiePts: 0.5, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 0 }}
        tiebreakers={[] as never[]}
        qual={{ mode: "overall", perFlight: 2, overall: 8 }}
        confirmedCount={20}
        chainsRounds={false}
        stages={[{
          id: "w1", position: 0, type: "Stroke Play Round", description: "", format: "Stableford", closed: false,
          holes: 9, playedOn: "", deadline: "", scoringBasis: "net", scoreInput: "", carryEnabled: false, carryPct: 0,
          carryAsked: false, cutEnabled: false, cutMode: "count", cutCount: 8, cutPercent: 50, cutScope: "overall",
          deadlineOverride: null, optDeadline: "", attendance: null,
          matchCount: 0, courseId: null, nine: "front", teamScoring: null, handicaps: [],
        }]} />,
    );
    expect(html).toContain("Which nine");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("Match scoring points", async () => {
    const { ScoringClient } = await import("@/components/ScoringClient");
    const html = render(
      <ScoringClient
        initial={{ winPts: 1, tiePts: 0.5, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 0 }}
        tiebreakers={["head-to-head" as never]} />,
    );
    expect(html).toContain("Points for winning a match");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("Commentary, for staff who can post", async () => {
    const { CommentaryPanel } = await import("@/components/CommentaryPanel");
    const html = render(<CommentaryPanel items={[]} canPost aiAvailable={false} />);
    expect(html).toContain("<textarea");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("Seasons, before the first one", async () => {
    const { SeriesClient } = await import("@/components/SeriesClient");
    const html = render(
      <SeriesClient seasons={[]} activeId={null} events={[]} standings={[]} unlinked={0}
        currentEventId="e1" currentEventSeriesId={null} canEdit />,
    );
    expect(html).toContain("Season name");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("the check itself catches an unnamed control (control)", () => {
    // Without this, a checker that returned [] for everything would pass
    // every assertion above.
    expect(unnamedControls(`<div><label>Name</label><input class="input"/></div>`)).toHaveLength(1);
    expect(unnamedControls(`<td><input type="checkbox"/></td>`)).toHaveLength(1);
    expect(unnamedControls(`<input type="file" hidden=""/>`)).toEqual([]);
    // A label that wraps the box and nothing else names nothing.
    expect(unnamedControls(`<label style="x"><input type="checkbox"/></label>`)).toHaveLength(1);
    expect(unnamedControls(`<label><input type="checkbox"/> Head to head</label>`)).toEqual([]);
  });
});
