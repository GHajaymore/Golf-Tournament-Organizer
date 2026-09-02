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
    // The literal promise being kept: a place opened, so the next person hears.
    const withdraw = tournament.slice(tournament.indexOf("status: \"waitlisted\" },"));
    expect(tournament).toMatch(/notifyFieldChange\(eventId, \[\{ email: next\.email, name: next\.name \}\], "promoted"\)/);
    expect(withdraw.length).toBeGreaterThan(0);
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
    // A notification that beat the write would announce a change that then
    // failed to happen. The database is the truth; the email reports it.
    const promote = tournament.indexOf('data: { status: "confirmed" } });');
    const tell = tournament.indexOf('], "promoted")');
    expect(promote).toBeGreaterThan(-1);
    expect(tell).toBeGreaterThan(promote);
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
