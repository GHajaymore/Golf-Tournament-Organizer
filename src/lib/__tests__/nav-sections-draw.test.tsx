import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NavSections } from "@/components/NavSections";
import { navForRole } from "../nav";
import { lifecycleNav } from "../nav-lifecycle";
import { lifecycleTrack } from "../domain/lifecycle-track";
import { tournamentJob } from "../domain/needs-you-now";
import { tournamentStatus } from "../domain/tournament-status";
import { FAMILY_FIXTURES } from "../domain/__tests__/tournament-facts-fixtures";

/**
 * WHAT THE MENU DRAWS, WITH THE SWITCH OFF AND ON (`NavSections`, the sidebar's and the drawer's one list).
 *
 *   off   the flat menu, link for link as both drew it: one plain link per screen, in order, no stops,
 *         no "Event", nothing set in, nothing carrying the preview's query
 *   on    the stops with their marks, the grouped screens beneath their entry, every link keeping
 *         the preview on, and one entry marked as here
 */

const flat = navForRole("admin", undefined, { hasTeamRound: true, hasKnockout: true, hasCup: true, isLeague: true, isPlayerToo: true });
const f = { ...FAMILY_FIXTURES.stroke(), startOn: "2026-11-28", endOn: "2026-11-29" };
const status = tournamentStatus(f);
const job = tournamentJob(
  { eventId: "e1", name: "zz-menu Quillstone Autumn Medal", awaitingApproval: 0, entriesClose: "", nextSheet: null, board: null, startOn: f.startOn, endOn: f.endOn, status },
  "2026-11-20",
  (iso) => iso,
);
const track = lifecycleTrack(status, job)!;

const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);

describe("the menu's one drawing", () => {
  it("switch off: the flat menu, exactly one plain link per screen, in order", () => {
    const html = renderToStaticMarkup(<NavSections sections={flat} pathname="/stages" />);
    expect(hrefs(html)).toEqual(flat.flatMap((s) => s.items.map((i) => i.href)));
    for (const never of ["data-nav-stop", "data-nav-scope", "data-nav-heading", "data-nav-beneath", "data-state", 'role="group"', "aria-label", 'aria-current="step"', "stepper=1", "padding-left"]) {
      expect(html, never).not.toContain(never);
    }
    // Here is the screen whose address this is, and only it.
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/stages"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/stages"/);
    // The sidebar draws no heading for the home section; the drawer keeps its row.
    const headings = (h: string) => (h.match(/text-transform:uppercase/g) ?? []).length;
    expect(headings(html)).toBe(flat.filter((s) => s.label).length);
    expect(headings(renderToStaticMarkup(<NavSections sections={flat} pathname="/stages" headEmpty />))).toBe(flat.length);
  });

  it("switch on: the stops, the grouped screens beneath their entry, and the preview kept on every link", () => {
    const menu = lifecycleNav(flat, track, { roundName: "Round 1 of 2 · Stroke Play" });
    const html = renderToStaticMarkup(<NavSections sections={menu} pathname="/registration" preview />);
    expect([...html.matchAll(/data-nav-stop="([a-z]+)"/g)].map((m) => m[1])).toEqual(["setup", "draw", "day", "after"]);
    expect(html.match(/data-nav-scope/g)).toHaveLength(1);
    // One stop is where the tournament is, said in words as the stepper says it.
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^>]*>Set up<span[^>]*> · (Now|Needs you)<\/span>/);
    expect(html).toContain("Round 1 of 2 · Stroke Play");
    // Every link keeps the preview on, a place on a screen included.
    const links = hrefs(html);
    expect(links.filter((h) => !h.includes("stepper=1"))).toEqual([]);
    expect(links).toContain("/event?stepper=1#courses");
    // Two doors to Entries, one mark: the screen beneath Players.
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*><span>Entries<\/span>/);
    // The grouped screens are marked as beneath (a walk counts the entries by it), and a screen
    // reader hears them as a group named for their entry; each stop is a group named for itself.
    const beneath = menu.flatMap((s) => s.items.flatMap((i) => i.children ?? []));
    expect(html.match(/data-nav-beneath/g)).toHaveLength(beneath.length);
    expect(html).toMatch(/role="group" aria-label="Players"><a [^>]*href="\/registration\?stepper=1"/);
    expect([...html.matchAll(/data-nav-stop="[a-z]+"[^>]*role="group" aria-label="([^"]+)"/g)].map((m) => m[1])).toEqual(menu.filter((s) => s.stop).map((s) => s.label));
    // And without the preview (the switch on for good) the links are plain.
    expect(hrefs(renderToStaticMarkup(<NavSections sections={menu} pathname="/registration" />)).filter((h) => h.includes("stepper"))).toEqual([]);
  });
});
