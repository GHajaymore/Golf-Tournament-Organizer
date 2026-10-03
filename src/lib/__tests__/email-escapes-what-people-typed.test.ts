import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * NOTHING A PERSON TYPED REACHES AN EMAIL AS HTML (2026-10-02).
 *
 * The emails are built by string concatenation, and `escapeHtml` was applied
 * only to the join request, on the theory that every other sender interpolates
 * "values the APP produced — a club name it stored". A stored club name was
 * typed by a person; so was every tournament's name, dates and course. Anyone
 * can sign up as an organizer, add players by email, and name a tournament
 * `<a href="…">Claim your prize</a>` — and TourneyHQ's own sender would have
 * delivered that link.
 *
 * So this sends through EVERY sender with hostile text in every field a person
 * controls, against a stubbed mail client, and asserts the markup arrives as
 * text. Enumerated over the senders rather than one fixture, so a fifth sender
 * that forgets is caught the day it is added to the list below.
 */

const sent: { subject: string; html: string }[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (m: { subject: string; html: string }) => {
        sent.push(m);
        return { error: null };
      },
    };
  },
}));

process.env.RESEND_API_KEY = "re_zz_test_not_real";
const email = await import("@/lib/email");

const HOSTILE = `<a href="https://zz-phish.invalid">Claim</a><img src=x onerror=alert(1)>`;
const TO = "zz-player@example.invalid";

/** Every sender, each with every person-typed field set to the hostile string. */
const SENDERS: Array<[string, () => Promise<unknown>]> = [
  ["registration", () => email.sendRegistrationEmail(TO, { eventName: HOSTILE, status: "confirmed", organizationId: "zz", eventId: "zz" })],
  ["staff invite", () => email.sendStaffInviteEmail(TO, { organizationName: HOSTILE, organizationId: "zz", role: HOSTILE, hasPassword: true })],
  ["join request", () => email.sendJoinRequestEmail(TO, { organizationName: HOSTILE, askerName: HOSTILE, askerEmail: HOSTILE, note: HOSTILE })],
  ["field: promoted", () => email.sendFieldStatusEmail(TO, { change: "promoted", eventName: HOSTILE, eventDates: HOSTILE, eventCourse: HOSTILE, organizationId: "zz", eventId: "zz" })],
  ["field: waitlisted", () => email.sendFieldStatusEmail(TO, { change: "waitlisted", eventName: HOSTILE, eventDates: HOSTILE, eventCourse: HOSTILE, organizationId: "zz", eventId: "zz" })],
];

describe("an email never carries markup somebody typed", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  for (const [name, send] of SENDERS) {
    it(`${name}: the hostile text arrives as text`, async () => {
      await send();
      expect(sent, `${name} sent nothing — the stub was not reached`).toHaveLength(1);
      const { html } = sent[0];
      expect(html).not.toContain("<a href=\"https://zz-phish.invalid\"");
      expect(html).not.toContain("<img");
      // CONTROL: it is there, escaped, rather than dropped — the name still reads.
      expect(html).toContain("&lt;a href=&quot;https://zz-phish.invalid&quot;&gt;Claim&lt;/a&gt;");
    });
  }

  it("covers every sender the module exports — a new one fails here until it is listed", () => {
    // The reset email interpolates only a URL the app built, so it has no
    // person-typed field to attack; it is the one deliberate exemption.
    const EXEMPT = new Set(["sendPasswordResetEmail"]);
    const exported = Object.keys(email).filter((k) => /^send[A-Z]/.test(k) && !EXEMPT.has(k));
    const covered = new Set(["sendRegistrationEmail", "sendStaffInviteEmail", "sendJoinRequestEmail", "sendFieldStatusEmail"]);
    expect(exported.length, "found no senders — the sweep would pass on nothing").toBeGreaterThan(0);
    expect(exported.filter((k) => !covered.has(k))).toEqual([]);
  });

  it("CONTROL: the app's own markup survives — links it built are still links", async () => {
    await email.sendStaffInviteEmail(TO, { organizationName: "ZZ Golf Club", organizationId: "zz", role: "admin", hasPassword: true });
    expect(sent[0].html).toMatch(/<a href="[^"]+">/);
    expect(sent[0].html).toContain("<strong>ZZ Golf Club</strong>");
  });
});
