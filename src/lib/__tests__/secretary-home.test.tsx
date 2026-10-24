import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";
import type { ClubJob } from "@/lib/domain/needs-you-now";

/**
 * THE SECRETARY'S HOME, DRAWN (2026-10-24).
 *
 *   a job in the open tournament   a link to its screen
 *   a job in another tournament    a press that opens THAT tournament on that
 *                                  screen (`enterTournament` with the job's screen)
 *   somebody who may not act       the same lines, and no button of any kind —
 *                                  a Guest running one tournament reads what the
 *                                  club waits on and is handed none of its doors
 *
 * And the page holds the rules where they are kept: the dashboard asks
 * `secretaryHomeFor`, which asks `canEdit`, `accessibleEvents` and the open
 * tournament's club — read here from source, with comments stripped.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
  redirect: vi.fn(),
}));
vi.mock("@/app/actions/auth", () => ({ enterTournament: vi.fn(async () => {}) }));
vi.mock("@/app/actions/tournament", () => ({ cloneEvent: vi.fn(async () => ({ ok: true })) }));

import { WhatsNext } from "@/components/NeedsYouNow";
import { CopyLastEvent } from "@/components/CopyLastEvent";

const JOBS: ClubJob[] = [
  { key: "cards", eventId: "open", eventName: "zz-sechome Spring Medal", text: "Round 2: 4 cards not returned", href: "/entry", action: "Open score entry", due: "2026-10-21" },
  { key: "entries", eventId: "other", eventName: "zz-sechome Autumn Foursomes", text: "3 entries awaiting approval", href: "/registration", action: "Approve entries", due: "2026-10-21" },
];

const draw = (mayAct: boolean) => renderToStaticMarkup(<WhatsNext jobs={JOBS} mayAct={mayAct} openEventId="open" />);

describe("what's next, drawn", () => {
  it("names each job's tournament, and gives each one button", () => {
    const html = draw(true);
    expect(html).toContain("zz-sechome Spring Medal");
    expect(html).toContain("Round 2: 4 cards not returned");
    expect(html).toContain("zz-sechome Autumn Foursomes");
    // The open tournament's job is a link straight to its screen.
    expect(html).toMatch(/<a [^>]*href="\/entry"[^>]*>Open score entry/);
    // Another tournament's is a press (a form), which opens that tournament first.
    expect(html).toMatch(/<form[^>]*>.*?<button type="submit"[^>]*>Approve entries/s);
    expect((html.match(/<(a|button) /g) ?? []).length).toBe(2);
  });

  it("somebody who may not act sees the lines and no button at all", () => {
    const html = draw(false);
    expect(html).toContain("Round 2: 4 cards not returned");
    expect(html).toContain("3 entries awaiting approval");
    expect(html).not.toMatch(/<(a|button|form)[ >]/);
    // CONTROL: the same jobs with the right to act do draw buttons.
    expect(draw(true)).toMatch(/<(a|button)[ >]/);
  });

  it("says plainly when nothing is waiting", () => {
    const html = renderToStaticMarkup(<WhatsNext jobs={[]} mayAct openEventId="open" />);
    expect(html).toContain("Nothing is waiting on you");
  });
});

describe("copy last event, drawn", () => {
  it("starts from the newest tournament, asks for the day, and says what it never copies", () => {
    const html = renderToStaticMarkup(
      <CopyLastEvent
        copyable={[
          { id: "a", name: "zz-sechome Spring Medal", startOn: "2026-05-02" },
          { id: "b", name: "zz-sechome Winter Stableford", startOn: "2026-01-10" },
        ]}
        today="2026-10-21"
      />,
    );
    expect(html).toContain('value="zz-sechome Spring Medal"');
    expect(html).toMatch(/type="date"[^>]*min="2026-10-21"/);
    expect(html).toContain("Never its players, cards, results, money or");
    expect(html).toContain("Create the copy");
    // Nothing to press until there is a day.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Create the copy/s);
  });

  it("draws nothing with nothing to copy", () => {
    expect(renderToStaticMarkup(<CopyLastEvent copyable={[]} today="2026-10-21" />)).toBe("");
  });
});

describe("the dashboard asks the rules where they are kept", () => {
  const page = readSource("src", "app", "(app)", "dashboard", "page.tsx");
  const service = readSource("src", "lib", "services", "whats-next.ts");

  it("the home is staff-only, and the copy card is behind the right to act", () => {
    expect(page).toMatch(/const home = isStaff \? await secretaryHomeFor\(session\) : null/);
    expect(page).toMatch(/home\?\.mayAct && home\.copyable\.length > 0 && <CopyLastEvent/);
    expect(page).toMatch(/<WhatsNext jobs=\{home\.jobs\} mayAct=\{home\.mayAct\}/);
  });

  it("the service takes the right to act from canEdit, and the tournaments from one club", () => {
    expect(service).toMatch(/const mayAct = !!club\?\.canEdit/);
    expect(service).toMatch(/organizationId: open\.organizationId/);
    expect(service).toMatch(/accessibleEvents\(session\.email\)/);
    // The counts are the screens' own.
    expect(service).toMatch(/awaitingApproval\(entrants\)/);
    expect(service).toMatch(/state\.nextUnplayedRound/);
    expect(service).toMatch(/state\.boardProgress\.certified/);
    expect(service).toMatch(/playOverOf\(e\.stages\)/);
  });

  it("Entries reads its awaiting list through the same rule", () => {
    const entries = readSource("src", "app", "(app)", "registration", "page.tsx");
    expect(entries).toMatch(/pendingEntries=\{awaitingApproval\(state\.players\)/);
  });
});
