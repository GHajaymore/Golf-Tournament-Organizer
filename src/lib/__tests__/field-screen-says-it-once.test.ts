import { describe, it, expect } from "vitest";
import { registrationStatus, overCapacity, suggestedInvite, type RegistrationInput } from "../registration";
import { CLONED_EVENT_FIELDS, NOT_CLONED_EVENT_FIELDS } from "../services/clone";
import { readSource } from "./source";

/**
 * THE FIELD SCREEN SAYS EACH THING ONCE, AND SAYS THE THING IT WAS HIDING.
 *
 * Two faults, read off the demo tournament's Registration & field on
 * 2026-09-12.
 *
 * ONE SENTENCE, THREE TIMES. "The May 7, 2026 deadline has passed. Reopen it
 * if you're still taking entries." rendered on the Status stat card, on the
 * banner an inch below it, and again on the public sign-up link's warning.
 * Nothing was wrong with any of the three; each was added on its own and none
 * knew about the others.
 *
 * AND A FIELD OVER ITS CAP, UNREMARKED. "Confirmed 33 · of 32 capacity", beside
 * "Waitlisted 0 · bumped in if a spot opens" — a spot that does not exist.
 * `spotsLeft` is clamped with `Math.max(0, …)`, so the screen reads "spots
 * remaining: 0" whether the field is exactly full or three over.
 */

const base: RegistrationInput = {
  eventStatus: "live",
  deadline: "2026-05-07",
  opens: "",
  capacity: 32,
  confirmedCount: 10,
  override: null,
  // Fixed, so "has the deadline passed" is a property of the fixture rather
  // than of the day this suite happens to run.
  now: new Date("2026-06-01T12:00:00Z"),
};
const at = (over: Partial<RegistrationInput> = {}) => registrationStatus({ ...base, ...over });

describe("a short reason, for where the whole sentence would repeat", () => {
  it("gives every state one, except the one whose label says everything", () => {
    /**
     * A SWEEP, so a state added later cannot arrive with a blank sub-line and
     * nobody notice — the Status card would then read "Closed" over nothing.
     */
    const states: Array<[string, RegistrationStatusLike]> = [
      ["closed-finished", at({ eventStatus: "completed" })],
      ["closed-manual", at({ override: true })],
      ["open-extended", at({ override: false })],
      ["closed-deadline", at({})],
      ["full", at({ now: new Date("2026-05-01T12:00:00Z"), confirmedCount: 32 })],
    ];
    for (const [name, s] of states) {
      expect(s.state, name).toBe(name);
      expect(s.short.trim().length, `${name} has no short form`).toBeGreaterThan(0);
    }
    // Open is the exception, and deliberately blank rather than "open" — a
    // caller rendering it prints nothing instead of echoing the label above.
    const open = at({ now: new Date("2026-05-01T12:00:00Z") });
    expect(open.state).toBe("open");
    expect(open.short).toBe("");
  });

  it("gives the reason, not the remedy", () => {
    /**
     * The half that made the repeat grating. Under a heading already reading
     * "Closed", "Reopen it if you're still taking entries" is the third time
     * the screen has offered the same advice.
     */
    const closed = at({});
    expect(closed.detail).toMatch(/reopen it/i);
    expect(closed.short, "the short form is just the sentence again").not.toMatch(/reopen/i);
    expect(closed.short).toContain("May 7, 2026");
    // And it is genuinely shorter — a "short" form as long as the sentence
    // would be a rename rather than a fix.
    expect(closed.short.length).toBeLessThan(closed.detail.length / 2);
  });

  it("names the deadline in the one state that is about a deadline", () => {
    // Closed by hand is not about a date, and saying one would be an
    // explanation of the wrong thing.
    expect(at({ override: true }).short).not.toContain("May 7");
    expect(at({}).short).toContain("May 7");
  });
});

describe("the screen prints the full sentence once", () => {
  /**
   * Read from source rather than rendered: `RegistrationClient` is nine
   * hundred lines of client component with a dozen hooks, and standing it up
   * to count one string would be a test about React. What has to hold is that
   * the component has ONE place that renders the whole sentence.
   *
   * Through `readSource`, which strips comments — the notes at both of the
   * sites that were changed name `reg.detail` and would otherwise satisfy the
   * count on their own. That is the trap `source-guard.test.ts` exists for.
   */
  const client = () => readSource("src", "components", "RegistrationClient.tsx");

  it("renders reg.detail in exactly one place", () => {
    const src = client();
    expect(src.split("reg.detail").length - 1, "the sentence is back in more than one place").toBe(1);
  });

  it("uses the short form at both sites that used to repeat it", () => {
    /**
     * THE SITES, NOT THE OCCURRENCES. Counting the string said 3, because the
     * link warning names it twice in one ternary — a number that has to be
     * re-derived every time the JSX around it changes is a test that will be
     * "fixed" by editing the number.
     *
     * So each of the two places is checked for what it renders. Dropping one
     * of them and leaving the sentence would pass the count above for the
     * wrong reason; this catches that.
     */
    const src = client();
    const statCard = src.slice(src.indexOf("spots remaining:"), src.indexOf("spots remaining:") + 200);
    expect(statCard, "the Status card is printing the whole sentence again").toContain("reg.short");
    expect(statCard).not.toContain("reg.detail");

    const linkWarning = src.slice(src.indexOf("anyone who follows it is turned away"));
    expect(linkWarning.slice(0, 200)).toContain("reg.short");
    expect(linkWarning.slice(0, 200)).not.toContain("reg.detail");
  });
});

describe("a field over its cap", () => {
  it("counts the overage the clamp was hiding", () => {
    expect(overCapacity(32, 33)).toBe(1);
    expect(overCapacity(32, 35)).toBe(3);
  });

  it("is silent when the field is exactly full, or short", () => {
    // Exactly full is not over. This is the boundary the whole thing turns on,
    // and off-by-one here would put "0 over" on every full tournament.
    expect(overCapacity(32, 32)).toBe(0);
    expect(overCapacity(32, 31)).toBe(0);
    expect(overCapacity(32, 0)).toBe(0);
  });

  it("cannot be exceeded when there is no cap", () => {
    // 0 or less means unlimited — an unlimited field reporting "400 over"
    // would be the clamp's mistake in the opposite direction.
    expect(overCapacity(0, 400)).toBe(0);
    expect(overCapacity(-1, 400)).toBe(0);
  });

  it("is shown on the screen, beside the capacity it exceeds", () => {
    const src = readSource("src", "components", "RegistrationClient.tsx");
    expect(src).toContain("overCapacity(");
    expect(src).toContain("over} over");
    // Beside the capacity, not in a banner somewhere else: the number it
    // qualifies is "of 32 capacity", and separating them is how a reader ends
    // up doing the subtraction themselves.
    expect(src.indexOf("over} over")).toBeGreaterThan(src.indexOf("capacity`}"));
  });
});


describe("the invite a copy used to inherit", () => {
  it("is not carried to a copy any more", () => {
    /**
     * It was the one carried field with no reason written beside it, in a list
     * where every other entry argues its case — and it is the field that gets
     * SENT. `dates` is excluded because "last year's dates are not this
     * year's"; the demo club's message names the dates, the venue AND the
     * tournament, so it was carrying all three past that exclusion in prose.
     */
    expect(CLONED_EVENT_FIELDS as readonly string[]).not.toContain("inviteMessage");
    expect(Object.keys(NOT_CLONED_EVENT_FIELDS)).toContain("inviteMessage");
    // And the exclusion says why, like every other one. The sweep in
    // clone.test.ts insists a field is classified; it cannot insist the reason
    // is a reason.
    expect(NOT_CLONED_EVENT_FIELDS.inviteMessage.length).toBeGreaterThan(40);
  });

  it("suggests one built from this tournament instead", () => {
    const s = suggestedInvite({ name: "Spring Medal", dates: "May 14–16, 2026", course: "Blue Ash" });
    expect(s).toContain("Spring Medal");
    expect(s).toContain("May 14–16, 2026");
    expect(s).toContain("Blue Ash");
  });

  it("drops the clause it has nothing to say for", () => {
    /**
     * A template built by plain concatenation produced "— at ." on a
     * tournament with no date yet, which is worse than the blank box this
     * replaces. Each clause appears only when it has a value.
     */
    const noDate = suggestedInvite({ name: "Spring Medal", dates: "", course: "Blue Ash" });
    expect(noDate).toContain("at Blue Ash");
    expect(noDate, "an empty clause left its preposition behind").not.toMatch(/\bon\s+at\b/);
    expect(noDate).not.toMatch(/\s{2,}/);

    const noVenue = suggestedInvite({ name: "Winter League", dates: "Tuesdays", course: "" });
    expect(noVenue).toContain("on Tuesdays");
    expect(noVenue).not.toContain(" at ");
    expect(noVenue).not.toMatch(/\s{2,}/);

    // Neither: still a sentence, not a fragment.
    const bare = suggestedInvite({ name: "Roll-up", dates: "", course: "" });
    expect(bare).toContain("Roll-up");
    expect(bare.trim()).toBe(bare);
  });

  it("suggests nothing for a tournament with no name", () => {
    // "You're invited to ." is the failure this guards. A blank suggestion
    // renders as an empty placeholder, which is the honest empty state.
    expect(suggestedInvite({ name: "", dates: "May", course: "Blue Ash" })).toBe("");
    expect(suggestedInvite({ name: "   ", dates: "May", course: "Blue Ash" })).toBe("");
  });

  it("leaves the sign-up link to the sender", () => {
    /**
     * `fullMessage` appends the link itself. A copy of it in the body would go
     * out twice in one message — and the body is also used when the link does
     * not exist yet, where a URL would be a dead one.
     */
    const s = suggestedInvite({ name: "Spring Medal", dates: "May", course: "Blue Ash" });
    expect(s).not.toMatch(/https?:\/\//);
    expect(s).not.toContain("/register/");
  });

  it("is offered as a placeholder, and sent when the box is empty", () => {
    const src = readSource("src", "components", "RegistrationClient.tsx");
    // Grey text nobody can act on is not an offer: the same suggestion has to
    // be what the WhatsApp and SMS buttons actually send.
    expect(src).toContain("placeholder={suggestion}");
    expect(src).toContain("invite.trim() || suggestion");
    // And never written to the database by the placeholder path — only what
    // the organizer typed is saved.
    expect(src).toContain("setInviteMessage(invite)");
  });
});

/** Structural only — the fields this file reads off a status. */
interface RegistrationStatusLike {
  state: string;
  short: string;
  detail: string;
}
