import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/roster", () => ({ addMembersToEvent: async () => ({ ok: true }) }));

import { RosterPicker } from "@/components/RosterPicker";
import type { RosterCandidate } from "@/lib/services/roster";
import { PLAYER_ACCESS_LABEL } from "@/lib/tournament-settings";

/**
 * THE ROSTER PICKER SAYS WHO CAN'T BE ENTERED BEFORE THE TICK.
 *
 * Walking the app as a new organizer (2026-09-26): eight members ticked, "Add
 * 8 members" pressed, and the answer was "Added 0 · no mobile for …" — a free
 * club collects a mobile from every entrant and none of them had one on file.
 * The rule is right; learning it after the click is the fault. `missing` comes
 * from the same `contactGap` the add action refuses on (pinned in
 * entry-needs-email.test.ts), so here it is enough to pin that the picker SAYS
 * it, per row and in one summary line, and says nothing when nothing is missing.
 */

const member = (id: string, missing: RosterCandidate["missing"]): RosterCandidate => ({
  id,
  name: `Member ${id}`,
  email: "",
  handicap: 12,
  handicapType: "18",
  memberNumber: "",
  entered: false,
  missing,
});

const render = (candidates: RosterCandidate[]) =>
  renderToStaticMarkup(<RosterPicker candidates={candidates} eventName="Saturday Stableford" locked={false} />);

describe("the roster picker", () => {
  it("marks each member who can't be entered, and says how many", () => {
    const html = render([member("a", "mobile"), member("b", "email"), member("c", null)]);
    expect(html).toContain("Needs a mobile number");
    expect(html).toContain("Needs an email address");
    expect(html).toContain("2 of these members can&#x27;t be entered yet");
  });

  it("says none can be entered when every one is missing something", () => {
    const html = render([member("a", "mobile"), member("b", "mobile")]);
    expect(html).toContain("None of these members can be entered yet");
  });

  it("offers a Round Code as the other way round a missing email", () => {
    // Found 2026-09-26: a fresh tournament on email sign-in refused every
    // member without an address, and the only remedy named was to go and
    // find eight addresses.
    const html = render([member("a", "email"), member("b", "email")]);
    // By the option's own label, so the words match what the setting says.
    expect(html).toContain(PLAYER_ACCESS_LABEL.code);
    expect(html).toContain("How players sign in");
  });

  it("does not offer it for a missing mobile, which no setting waives (control)", () => {
    const html = render([member("a", "mobile"), member("b", "mobile")]);
    expect(html).not.toContain(PLAYER_ACCESS_LABEL.code);
  });

  it("says nothing when nobody is missing anything (control)", () => {
    const html = render([member("a", null), member("b", null)]);
    expect(html).not.toContain("Needs a mobile number");
    expect(html).not.toContain("can be entered yet");
    expect(html).not.toContain("can&#x27;t be entered yet");
  });
});
