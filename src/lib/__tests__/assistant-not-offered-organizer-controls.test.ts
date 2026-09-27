import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A CONTROL IS OFFERED ONLY TO A ROLE ITS ACTION ACCEPTS.
 *
 * Walked as an ASSISTANT on 2026-09-26 and then swept: five organizer-only
 * actions were wired to controls gated on STAFF, so an assistant saw them,
 * used them, and was refused every time — a button that fails is worse than no
 * button. Each pairing below names the action whose guard the gate must match,
 * so a later change to either side has to read this first.
 *
 *   setBracketMode      requireAdminEvent    → the Arrangement picker (/bracket)
 *   setFlightTee        requireOrganizerOrg  → the flight's Tees select (/grouping)
 *   clearRoundScores    requireAdminEvent    → "Clear scores" (/entry)
 *   setStageCourse      requireOrganizerOrg  → the round's venue (/entry, /stages)
 *   searchCourseDirectory  admin unless localOnly → the course search (/entry)
 *
 * Source-read, because the fault was in how each PAGE wired a flag, which no
 * render of the component alone can see.
 */
describe("organizer-only controls are gated on the organizer", () => {
  it("the bracket arrangement (setBracketMode)", () => {
    const src = readSource("src", "app", "(app)", "bracket", "page.tsx");
    expect(src).toMatch(/<BracketModePicker[^>]*readOnly=\{!isAdmin\}/);
    expect(src).toMatch(/const isAdmin = session\.viewRole === "admin"/);
  });

  it("a flight's tees (setFlightTee)", () => {
    const page = readSource("src", "app", "(app)", "grouping", "page.tsx");
    expect(page).toMatch(/canSetTees=\{session\.viewRole === "admin"\}/);
    // And the select reads THAT flag, not the staff one.
    const board = readSource("src", "components", "FlightBoard.tsx");
    expect(board).toMatch(/disabled=\{locked \|\| !canSetTees \|\| pending\}/);
  });

  it("clearing a round's scores (clearRoundScores)", () => {
    const src = readSource("src", "components", "EntryModes.tsx");
    expect(src).toMatch(/\{isAdmin && !casual && !clearing && !bracket && \(/);
    expect(src).not.toMatch(/isStaff && !casual && !clearing/);
  });

  it("a round's venue on Score entry and on Rounds & formats (setStageCourse)", () => {
    const entry = readSource("src", "components", "EntryModes.tsx");
    expect(entry).toMatch(/<RoundVenue[\s\S]*?canEdit=\{isAdmin\}/);
    const stages = readSource("src", "app", "(app)", "stages", "page.tsx");
    expect(stages).toMatch(/canSetVenue=\{session\.viewRole === "admin"\}/);
  });

  it("the course directory search (searchCourseDirectory)", () => {
    const prompt = readSource("src", "components", "CourseSetupPrompt.tsx");
    expect(prompt).toMatch(/\{isAdmin && blocking && <CourseSearch \/>\}/);
    const entry = readSource("src", "app", "(app)", "entry", "page.tsx");
    expect(entry).toMatch(/<CourseSetupPrompt[\s\S]*?isAdmin=\{session\.viewRole === "admin"\}/);
  });

  it("the actions really are organizer-only (the control — else the gates are wrong the other way)", () => {
    const t = readSource("src", "app", "actions", "tournament.ts");
    const c = readSource("src", "app", "actions", "courses.ts");
    const body = (src: string, fn: string) => src.slice(src.indexOf(`export async function ${fn}(`)).slice(0, 2500);
    expect(body(t, "setBracketMode")).toMatch(/requireAdminEvent\(\)/);
    expect(body(t, "clearRoundScores")).toMatch(/requireAdminEvent\(\)/);
    expect(body(c, "setFlightTee")).toMatch(/requireOrganizerOrg\(\)/);
    expect(body(c, "setStageCourse")).toMatch(/requireOrganizerOrg\(\)/);
  });
});
