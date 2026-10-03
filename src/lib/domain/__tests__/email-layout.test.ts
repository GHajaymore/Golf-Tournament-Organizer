import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emailDocument, emailText, escapeHtml, LOCKUP_PATH, TAGLINE, type EmailParts } from "../email-layout";
import { EMAIL } from "../../themes";

const BASE = "https://tourneyhq.club";
const parts: EmailParts = {
  subject: `You're registered — Captain's <Day>`,
  bodyHtml: `<p>Thanks for entering <strong>${escapeHtml("Captain's <Day> & Dinner")}</strong>.</p><p><a href="https://tourneyhq.club/me">Your entry</a> is confirmed.</p>`,
  whyHtml: `You're getting this because you entered ${escapeHtml("Captain's <Day>")} on TourneyHQ.`,
  base: BASE,
};

describe("the email layout", () => {
  const html = emailDocument(parts);

  it("is a whole document: the logo first, the body, and the sign-off with why they got it", () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(`src="${BASE}${LOCKUP_PATH}" alt="TourneyHQ"`);
    expect(html).toContain(parts.bodyHtml);
    expect(html).toContain(parts.whyHtml);
    expect(html).toContain(TAGLINE);
    expect(html).toContain(`href="${BASE}/privacy"`);
  });

  it("the logo it points at exists, and is the 2x photograph", () => {
    const png = readFileSync(join(process.cwd(), "public", LOCKUP_PATH));
    // PNG signature, then width and height from the IHDR chunk.
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBeGreaterThanOrEqual(182 * 2 - 2);
    expect(height).toBeGreaterThanOrEqual(44 * 2 - 2);
  });

  it("escapes the subject it puts in the title — the subject is plain text", () => {
    expect(html).toContain("<title>You&#39;re registered — Captain&#39;s &lt;Day&gt;</title>");
  });

  it("takes its colours from the email palette", () => {
    expect(html).toContain(EMAIL.bg);
    expect(html).toContain(EMAIL.flag);
  });

  it("every inline style is one well-formed attribute — no double quote inside a style", () => {
    // A double-quoted font name inside style="…" ended the attribute early and
    // the first render came out in Times, unbolded.
    const styles = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
    expect(styles.length).toBeGreaterThan(4);
    expect(html).not.toMatch(/style="[^"]*"[A-Za-z][^=>]*",/);
  });
});

describe("whose email it is", () => {
  it("a club's email puts the club under TourneyHQ — its name, and its logo when it has one", () => {
    const html = emailDocument({ ...parts, brand: { clubName: "ZZ <Fairway> Society", clubLogoUrl: "https://tourneyhq.club/api/logo/zz?v=1" } });
    expect(html.indexOf(LOCKUP_PATH)).toBeLessThan(html.indexOf("ZZ &lt;Fairway&gt; Society"));
    expect(html).toContain(`src="https://tourneyhq.club/api/logo/zz?v=1"`);
    expect(html).toContain("<strong>TourneyHQ</strong>");
  });

  it("a white-label club with a logo leads with ITS logo, and carries no TourneyHQ attribution", () => {
    const html = emailDocument({ ...parts, brand: { clubName: "ZZ Club", clubLogoUrl: "https://zz.example.invalid/logo.png", whiteLabel: true } });
    expect(html).not.toContain(LOCKUP_PATH);
    expect(html).toContain(`src="https://zz.example.invalid/logo.png" alt="ZZ Club"`);
    expect(html).not.toContain("<strong>TourneyHQ</strong>");
  });

  it("CONTROL: white-label with NO logo still shows TourneyHQ — there is nothing to replace it with", () => {
    const html = emailDocument({ ...parts, brand: { clubName: "ZZ Club", clubLogoUrl: "", whiteLabel: true } });
    expect(html).toContain(LOCKUP_PATH);
  });
});

describe("the action and the preview", () => {
  const html = emailDocument({ ...parts, preview: "Your <link> works for 15 minutes.", action: { label: "Reset your password", url: `${BASE}/reset-password?token=zz` } });

  it("draws the one action as a button, with its address written out for clients that strip it", () => {
    expect(html).toMatch(/<a href="https:\/\/tourneyhq\.club\/reset-password\?token=zz" style="display:inline-block[^"]*">Reset your password<\/a>/);
    expect(html).toContain("Or open this address:");
  });

  it("hides the preview line in the message, escaped", () => {
    expect(html).toContain(`<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your &lt;link&gt; works for 15 minutes.`);
  });
});

describe("the plain-text twin", () => {
  const text = emailText({ ...parts, action: { label: "See your entry", url: `${BASE}/me` }, brand: { clubName: "ZZ Society" } });

  it("says the same thing, with no markup left in it, and names the club", () => {
    expect(text).toMatch(/^TourneyHQ — ZZ Society\n/);
    expect(text).toContain("Thanks for entering Captain's <Day> & Dinner.");
    expect(text).not.toMatch(/<\/?(p|strong)>/);
  });

  it("keeps a link's address and the action's, which are the only way to follow them in text", () => {
    expect(text).toContain("Your entry (https://tourneyhq.club/me) is confirmed.");
    expect(text).toContain("See your entry: https://tourneyhq.club/me");
  });

  it("carries the footer, set apart", () => {
    expect(text).toMatch(/\n--\nYou're getting this because you entered Captain's <Day> on TourneyHQ\.\n$/);
  });

  it("CONTROL: text a person typed that LOOKS like an entity comes back as typed", () => {
    const typed = "Fish &amp; Chips";
    expect(emailText({ bodyHtml: `<p>${escapeHtml(typed)}</p>`, whyHtml: "" })).toContain(typed);
  });
});
