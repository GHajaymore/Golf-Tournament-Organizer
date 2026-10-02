import { describe, it, expect } from "vitest";
import { scrubReport, scrubText } from "../error-report";

/**
 * An error report never carries a credential or an email address off the
 * premises. See `error-report.ts` for why every string is rewritten rather than
 * a list of fields.
 */

const TOKEN = "zz-club-tok-Q7xP2";

describe("scrubText", () => {
  it("removes a share token from a board address, wherever it sits", () => {
    expect(scrubText(`/live/${TOKEN}`)).toBe("/live/[redacted]");
    expect(scrubText(`https://tourneyhq.club/live/${TOKEN}?bust=1`)).toBe("https://tourneyhq.club/live/[redacted]?bust=1");
    expect(scrubText(`Error rendering /live/${TOKEN}/tv: boom`)).toBe("Error rendering /live/[redacted]/tv: boom");
  });

  it("removes an entry-form token and a reset token", () => {
    expect(scrubText(`/register/${TOKEN}`)).toBe("/register/[redacted]");
    expect(scrubText(`/reset-password?token=${TOKEN}&x=1`)).toBe("/reset-password?token=[redacted]&x=1");
  });

  it("removes email addresses", () => {
    expect(scrubText("no player zz-walk@example.invalid in field")).toBe("no player [redacted] in field");
  });

  it("CONTROL: leaves an ordinary address and message alone", () => {
    const plain = "TypeError: Cannot read properties of undefined (reading 'stroke') at /entry?round=2";
    expect(scrubText(plain)).toBe(plain);
    expect(scrubText("/live")).toBe("/live");
  });
});

describe("scrubReport", () => {
  /** The shape of a Sentry event, with the URL in five places, as a real one has it. */
  const event = {
    transaction: `GET /live/${TOKEN}`,
    request: {
      url: `https://tourneyhq.club/live/${TOKEN}`,
      headers: { cookie: "ng_session=abc", "user-agent": "Mozilla" },
      cookies: { ng_session: "abc" },
    },
    user: { ip_address: "203.0.113.9" },
    breadcrumbs: [{ category: "fetch", data: { url: `/reset-password?token=${TOKEN}` } }],
    exception: {
      values: [{ type: "Error", value: `no board for /register/${TOKEN} (zz-walk@example.invalid)` }],
    },
  };

  it("rewrites every string, so the token is nowhere in the report", () => {
    const out = JSON.stringify(scrubReport(event));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain("@example.invalid");
  });

  it("drops cookies, the cookie header and the IP address outright", () => {
    const out = scrubReport(event);
    expect(out.request).not.toHaveProperty("cookies");
    expect(out.request.headers).not.toHaveProperty("cookie");
    expect(out.user).not.toHaveProperty("ip_address");
    expect(JSON.stringify(out)).not.toContain("ng_session");
  });

  it("CONTROL: keeps what makes the report useful", () => {
    const out = scrubReport(event);
    expect(out.request.headers["user-agent"]).toBe("Mozilla");
    expect(out.exception.values[0].type).toBe("Error");
    expect(out.request.url).toBe("https://tourneyhq.club/live/[redacted]");
  });

  it("does not modify the original", () => {
    scrubReport(event);
    expect(event.request.url).toContain(TOKEN);
  });
});
