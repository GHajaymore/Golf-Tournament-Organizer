import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summariseEmailTrouble, TROUBLE_WINDOW_MS, type EmailFailureRow } from "@/lib/domain/email-trouble";

const row = (over: Partial<EmailFailureRow> = {}): EmailFailureRow => ({
  reason: "rejected",
  kind: "registration",
  createdAt: Date.now(),
  ...over,
});

/**
 * A staff invitation that fails is described, not merely counted.
 *
 * `summariseEmailTrouble` prints a headline count and then a sentence saying
 * who was affected. The sentence used to be built from two positional counts —
 * registrations and resets — so a third kind of email would have been included
 * in the number and omitted from the explanation. "3 emails were refused"
 * followed by a sentence accounting for two of them is the kind of quiet
 * disagreement this file exists to prevent.
 */
describe("the Access banner accounts for every kind of email", () => {
  it("describes a failed invitation rather than silently counting it", () => {
    const trouble = summariseEmailTrouble([row({ kind: "invite" })], Date.now());
    expect(trouble?.count).toBe(1);
    expect(trouble?.detail).toContain("staff invitation did not arrive");
  });

  it("pluralises invitations", () => {
    const trouble = summariseEmailTrouble(
      [row({ kind: "invite" }), row({ kind: "invite" })],
      Date.now(),
    );
    expect(trouble?.detail).toContain("2 staff invitations did not arrive");
  });

  it("accounts for every failure in the count, across kinds", () => {
    /**
     * The invariant, rather than the wording. Whatever kinds are present, the
     * sentence must mention as many people as the headline counted — otherwise
     * an organizer reads "3 refused" and can only account for two.
     */
    const rows = [
      row({ kind: "registration" }),
      row({ kind: "reset" }),
      row({ kind: "invite" }),
    ];
    const trouble = summariseEmailTrouble(rows, Date.now());
    expect(trouble?.count).toBe(3);
    expect(trouble?.detail).toContain("registration confirmation");
    expect(trouble?.detail).toContain("password reset link");
    expect(trouble?.detail).toContain("staff invitation");
  });

  it("still says nothing when everything is old enough to be irrelevant", () => {
    const stale = row({ kind: "invite", createdAt: Date.now() - TROUBLE_WINDOW_MS - 1 });
    expect(summariseEmailTrouble([stale], Date.now())).toBeNull();
  });
});

/**
 * Source checks on the invite path.
 *
 * Behaviour here needs a session, an organization and a mail provider, which is
 * three kinds of scaffolding to prove two things that are visible by reading.
 * Both correspond to a real way this could go wrong rather than to a style.
 */
describe("how the invite is sent", () => {
  const action = readFileSync(
    join(process.cwd(), "src", "app", "actions", "organization.ts"),
    "utf8",
  );
  const mail = readFileSync(join(process.cwd(), "src", "lib", "email.ts"), "utf8");

  it("only emails when the membership is new", () => {
    /**
     * A role change is not an invitation. Emailing on every save would turn a
     * correction into a second "you have been added", and the upsert cannot
     * tell new from existing after the fact — so the check has to happen
     * before it.
     */
    expect(action).toMatch(/const existingMembership = await prisma\.organizationMember\.findUnique/);
    expect(action).toMatch(/if \(!existingMembership\) \{/);
    // The lookup must precede the write, or it always finds the row it just made.
    expect(action.indexOf("const existingMembership")).toBeLessThan(
      action.indexOf("await prisma.organizationMember.upsert"),
    );
  });

  it("writes the membership before attempting the email", () => {
    // An invitation that fails to send leaves someone with access and no
    // notification, which an organizer can fix. A membership that failed to
    // write because an email bounced would leave them believing they had added
    // somebody they had not.
    expect(action.indexOf("await prisma.organizationMember.upsert")).toBeLessThan(
      action.indexOf("await sendStaffInviteEmail"),
    );
  });

  it("cannot throw into the action", () => {
    // Same contract as the registration confirmation: the send handles its own
    // failure and returns void, so adding access never fails on a bounce.
    expect(mail).toMatch(/export async function sendStaffInviteEmail\([\s\S]*?\): Promise<void>/);
    expect(mail).toMatch(/\[email\] Failed sending staff invite/);
  });

  it("no-ops rather than throwing when mail is not configured", () => {
    const body = mail.slice(mail.indexOf("export async function sendStaffInviteEmail"));
    expect(body).toMatch(/if \(!resend\) \{[\s\S]*?return;/);
  });
});
