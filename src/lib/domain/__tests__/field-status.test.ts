import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summariseEmailTrouble, type EmailFailureRow } from "@/lib/domain/email-trouble";

const src = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

/**
 * The promise the registration email makes, and the code that has to keep it.
 *
 * `sendRegistrationEmail` tells a waitlisted player, in writing: "The field is
 * full, so you're on the waitlist — we'll be in touch if a place opens." Three
 * paths moved players between `confirmed` and `waitlisted` and none of them was
 * ever in touch. These assertions are about the wiring rather than the wording,
 * because the wiring is what was missing.
 */
describe("a player is told when their place in the field changes", () => {
  const tournament = src("src", "app", "actions", "tournament.ts");
  const email = src("src", "lib", "email.ts");
  const notify = src("src", "lib", "services", "field-notify.ts");

  it("notifies the player promoted when somebody withdraws", () => {
    /**
     * The literal promise being kept: a place opened, so the next person hears.
     *
     * This used to match the inline `notifyFieldChange(eventId, [{ email:
     * next.email, ... }], "promoted")` that `removeSignup` performed itself.
     * That promotion moved into `drainWaitlist`, because promoting on a
     * withdrawal without checking the field limit pushed a field an organizer
     * had just shrunk back over it — the same arithmetic that fills a field
     * when the capacity goes up.
     *
     * So the assertion follows the behaviour rather than the line: the
     * withdrawal path must still cause a promotion, and `drainWaitlist` must
     * still tell whoever it promotes. Matching the old literal was pinning
     * WHERE the code lived, not what it did.
     */
    const waitlist = src("src", "lib", "services", "waitlist.ts");
    expect(tournament).toMatch(/await drainWaitlist\(eventId\);/);
    expect(waitlist).toMatch(/notifyFieldChange\(/);
    expect(waitlist).toMatch(/"promoted"/);
  });

  it("notifies everybody promoted when the field is enlarged", () => {
    expect(tournament).toMatch(/wait\.map\(\(p\) => \(\{ email: p\.email, name: p\.name \}\)\),\s*\r?\n\s*"promoted",/);
  });

  it("notifies everybody DEMOTED when the field is shrunk", () => {
    /**
     * The one that matters most, and the only direction where silence is
     * dangerous rather than merely disappointing. Every other missed message
     * leaves somebody pleasantly surprised; this one leaves a player who was
     * told "You're confirmed in the field" at a golf course with no tee time.
     */
    expect(tournament).toMatch(/excess\.map\(\(p\) => \(\{ email: p\.email, name: p\.name \}\)\),\s*\r?\n\s*"waitlisted",/);
  });

  it("notifies AFTER the status is written, never before", () => {
    /**
     * A notification that beat the write would announce a change that then
     * failed to happen. The database is the truth; the email reports it.
     *
     * Anchored on the STATUS CHANGE rather than on an exact literal. The first
     * version of this test matched `data: { status: "confirmed" } });` and broke
     * the moment a field was added to that same object — it was asserting the
     * shape of one line, not the ordering it claimed to be about.
     *
     * Checked in BOTH files now. The demotion path still writes and notifies
     * inline in `tournament.ts`; promotion moved into `drainWaitlist`, and the
     * ordering matters just as much there — a promotion announced before the
     * update would tell somebody they were in the field on the strength of a
     * write that had not happened yet.
     */
    const demote = tournament.search(/data: \{ status: "waitlisted"/);
    const tellDemoted = tournament.search(/notifyFieldChange\(/);
    expect(demote).toBeGreaterThan(-1);
    expect(tellDemoted).toBeGreaterThan(demote);

    const waitlist = src("src", "lib", "services", "waitlist.ts");
    const promote = waitlist.search(/data: \{ status: "confirmed"/);
    const tellPromoted = waitlist.search(/notifyFieldChange\(/);
    expect(promote).toBeGreaterThan(-1);
    expect(tellPromoted).toBeGreaterThan(promote);
  });

  it("cannot throw into the action that changed the field", () => {
    // The field is already correct by then. A bounced notification must never
    // undo somebody's place in it.
    expect(notify).toMatch(/export async function notifyFieldChange\([\s\S]*?\): Promise<void>/);
    expect(notify).toMatch(/catch \(e\) \{/);
    expect(email).toMatch(/export async function sendFieldStatusEmail\([\s\S]*?\): Promise<void>/);
  });

  it("skips players with no address instead of reporting a failure", () => {
    // A club roster is routinely half addresses and half not. An organizer who
    // typed none for somebody has not failed at anything.
    expect(notify).toMatch(/players\.filter\(\(p\) => p\.email\.trim\(\)\)/);
    expect(notify).toMatch(/if \(reachable\.length === 0\) return;/);
  });

  it("says plainly that a demoted player is not in the field", () => {
    /**
     * Wording, asserted for once, because this is the sentence somebody acts
     * on. "Moved to the waitlist" alone is easy to skim past; "do not travel to
     * the course" is not.
     */
    expect(email).toContain("You are not currently in the field, so please do not travel to the course");
  });
});

/**
 * The organizer's half of the promise.
 *
 * The player is asked to say within 48 hours if they can no longer play.
 * `promotedAt` is how anybody notices that they have not.
 */
describe("a promotion is recorded so it can be followed up", () => {
  const tournament = src("src", "app", "actions", "tournament.ts");
  const email = src("src", "lib", "email.ts");

  it("stamps promotedAt when a withdrawal frees a place", () => {
    expect(tournament).toMatch(/data: \{ status: "confirmed", promotedAt: new Date\(\) \}/);
  });

  it("stamps promotedAt when the field is enlarged", () => {
    expect(tournament).toMatch(/data: \{ status: "confirmed", promotedAt: new Date\(\) \},/);
  });

  it("CLEARS promotedAt when a player is moved back off the field", () => {
    /**
     * Otherwise somebody demoted keeps a badge reading "Promoted 2 days ago" —
     * a true sentence about a player who is no longer in the field, which is
     * worse than showing nothing at all.
     */
    expect(tournament).toMatch(/data: \{ status: "waitlisted", promotedAt: null \}/);
  });

  it("asks for a reply in the same window the badge uses", () => {
    // The email and the screen must agree about what 48 hours means, or the
    // organizer chases somebody the software never asked to reply.
    expect(email).toContain("within 48 hours");
  });

  it("does not claim the place is conditional", () => {
    /**
     * The decision behind this whole change: promotion is final, and the place
     * is not held vacant pending a reply. The wording must not imply a deadline
     * the software does not enforce — that would be a threat it never carries
     * out, and the first player to test it would find out.
     */
    expect(email).toContain("there is nothing you need to do to accept it");
    expect(email).not.toMatch(/your place will be (given|passed|released)/i);
  });
});

describe("the Access banner accounts for a failed field notice", () => {
  it("describes it rather than only counting it", () => {
    const rows: EmailFailureRow[] = [
      { reason: "rejected", kind: "field", createdAt: Date.now() },
    ];
    const trouble = summariseEmailTrouble(rows, Date.now());
    expect(trouble?.count).toBe(1);
    expect(trouble?.detail).toContain("place in the field changed");
  });

  it("still accounts for every failure when all four kinds are present", () => {
    const now = Date.now();
    const rows: EmailFailureRow[] = [
      { reason: "quota", kind: "registration", createdAt: now },
      { reason: "quota", kind: "reset", createdAt: now },
      { reason: "quota", kind: "invite", createdAt: now },
      { reason: "quota", kind: "field", createdAt: now },
    ];
    const trouble = summariseEmailTrouble(rows, now);
    expect(trouble?.count).toBe(4);
    for (const phrase of [
      "registration confirmation",
      "password reset link",
      "staff invitation",
      "place in the field changed",
    ]) {
      expect(trouble?.detail).toContain(phrase);
    }
  });
});
