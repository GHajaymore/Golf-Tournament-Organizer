import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { groupsWithRoom, type TeeSheet } from "@/lib/domain/tee-sheet";
import { fieldBanner } from "@/lib/domain/field-change";
import { exportStatus } from "@/lib/domain/csv-export";
import { liveDoors, NO_SHEET } from "./field-doors";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/app/actions/tee-sheet", () => ({ placeInTeeGroup: async () => ({ ok: true, said: "" }) }));

/**
 * THE DAY-OF SCREENS OF PR B, AS DRAWN.
 *
 *   the tee sheet's "Put in a group"  → each undrawn player, a choice of ONLY the
 *                                       groups with room, and one button; refused in
 *                                       the rule's words once completed
 *   the organizer's board and sheet   → a DNS row reads "DNS — did not start", with no
 *                                       place and no figures; the legend says the codes
 *   the Entries banner                → says when late entries close, from the sheet
 */

const sheet: TeeSheet = {
  savedAt: "",
  startType: "tee",
  groups: [
    { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ["a", "b", "c", "d"] },
    { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ["e", "f"] },
    { name: "Group 3", startHole: 10, time: "8:00 AM", playerIds: ["g", "h", "i"] },
  ],
};
const field = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "late"]);

async function placer(door: string | null) {
  const { PlaceInGroup } = await import("@/components/PlaceInGroup");
  return renderToStaticMarkup(
    <PlaceInGroup stageId="s1" undrawn={[{ id: "late", name: "zz-Isolde Ravensworth" }]} groups={groupsWithRoom(sheet, field)} door={door} />,
  );
}
const tagOf = (html: string, marker: string, tag: string) => {
  const at = html.indexOf(marker);
  expect(at, `${marker} should be on the screen`).toBeGreaterThan(-1);
  const open = html.lastIndexOf(`<${tag}`, at);
  return html.slice(open, html.indexOf(">", open) + 1);
};

describe("the tee sheet's Put in a group", () => {
  it("names who has no group and offers only the groups with room, with time, tee and count", async () => {
    const html = await placer(null);
    expect(html).toContain("Not in a group yet (1)");
    expect(html).toContain('aria-label="Group for zz-Isolde Ravensworth"');
    expect(html).toContain("Group 2 · 8:10 AM · hole 1 · 2 players");
    expect(html).toContain("Group 3 · 8:00 AM · hole 10 · 3 players");
    // Group 1 is full: not offered.
    expect(html).not.toContain("Group 1 ·");
    const button = tagOf(html, "Put in group", "button");
    expect(button).not.toMatch(/\sdisabled=""/);
  });

  it("once completed, the button is shut and the rule's sentence is beside it", async () => {
    const says = "The tournament is completed, so its field is as it finished. An Organizer can reopen it on the dashboard.";
    const html = await placer(says);
    expect(tagOf(html, "Put in group", "button")).toMatch(/\sdisabled=""/);
    expect(html).toContain(says);
  });

  it("with every group full, it says to re-draw", async () => {
    const { PlaceInGroup } = await import("@/components/PlaceInGroup");
    const html = renderToStaticMarkup(<PlaceInGroup stageId="s1" undrawn={[{ id: "late", name: "zz-Late" }]} groups={[]} door={null} />);
    expect(html).toContain("Every group is full. Re-draw the sheet to make room.");
    expect(html).not.toContain("Put in group");
  });
});

describe("DNS on the organizer's board and the results sheet", () => {
  const base = {
    rank: 0, ranked: false, started: false, flight: "", advancing: false, record: "", diff: "", pts: "", played: 0, wins: 0, ties: 0, losses: 0,
    gross: 0, net: 0, toPar: 0, points: 0, thru: 0, holesOwed: 18,
  };
  const rows = [
    { ...base, id: "p1", name: "zz-Ann Doyle", rank: 1, ranked: true, started: true, gross: 80, net: 70, toPar: -2, thru: 18, parThru: 72 },
    { ...base, id: "p2", name: "zz-Hal Moss", withdrew: true, gross: 41, net: 37, thru: 9, parThru: 36 },
    { ...base, id: "p3", name: "zz-Eve Quill", didNotStart: true },
    { ...base, id: "p4", name: "zz-Ivy Tor", disqualified: true, gross: 82, net: 74, thru: 18, parThru: 72 },
  ];

  it("the DNS row says why, with no place and no figures", async () => {
    const { LeaderboardTable } = await import("@/components/LeaderboardTable");
    const html = renderToStaticMarkup(<LeaderboardTable isStroke rows={rows as never} />);
    const eve = html.slice(html.indexOf("zz-Eve Quill"), html.indexOf("</tr>", html.indexOf("zz-Eve Quill")));
    expect(eve).toContain("DNS — did not start");
    expect(eve).not.toMatch(/>\s*0\s*</);
    expect(html).toContain("WD — withdrew");
    expect(html).toContain("DQ — disqualified");
  });

  it("the legend says the codes the sheet carries, and the CSV says DNS", async () => {
    const { resultsLegend } = await import("@/components/LeaderboardTable");
    expect(resultsLegend(rows as never)).toBe("DNS did not start. WD withdrew after beginning. DQ disqualified.");
    expect(resultsLegend([rows[0], rows[2]] as never)).toBe("DNS did not start.");
    expect(resultsLegend([rows[0]] as never)).toBe("");
    expect(exportStatus(rows[2])).toBe("DNS");
    expect(exportStatus(rows[1])).toBe("WD");
  });
});

describe("the Entries banner says when late entries close", () => {
  it("from Round 1's published last tee time, while it is still to come", () => {
    const lastTee = { round: "Round 1", day: NO_SHEET.now.day, time: "10:40 AM" };
    const banner = fieldBanner({ status: "live", configUnlocked: false, family: "stroke", playedRound: "Round 1", flightsConfirmed: false, lastTee, now: NO_SHEET.now });
    expect(banner).toContain("Late entries close at Round 1’s last tee time, 10:40 AM.");
    // The doors agree: Add is open though Round 1's first card is in.
    expect(liveDoors("stroke", "Round 1", false, { lastTee }).add).toBeNull();
    expect(liveDoors("stroke", "Round 1", false, { lastTee, minutes: 10 * 60 + 40 }).add).toMatch(/^Round 1’s last tee time, 10:40 AM, has passed/);
  });
});
