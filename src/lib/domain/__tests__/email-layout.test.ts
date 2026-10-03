import { describe, it, expect } from "vitest";
import { emailDocument, emailText, escapeHtml } from "../email-layout";
import { LIGHT_GROUND } from "../../themes";

const parts = {
  subject: `You're registered — Captain's <Day>`,
  bodyHtml: `<p>Thanks for entering <strong>${escapeHtml("Captain's <Day> & Dinner")}</strong>.</p><p><a href="https://tourneyhq.club/me">Your entry</a> is confirmed.</p>`,
  whyHtml: `You're getting this because you entered ${escapeHtml("Captain's <Day>")} on TourneyHQ.`,
};

describe("the email layout", () => {
  const html = emailDocument(parts);

  it("is a whole document: the name at the top, the body, and why they got it", () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(">TourneyHQ</td>");
    expect(html).toContain(parts.bodyHtml);
    expect(html).toContain(parts.whyHtml);
  });

  it("every inline style is one well-formed attribute — no double quote inside a style", () => {
    // A double-quoted font name inside style="…" ended the attribute early and
    // the first render came out in Times, unbolded. Every style must close on
    // its own quote: no stray `"` between `style="` and the `">` or `" ` after it.
    const styles = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
    expect(styles.length).toBeGreaterThan(4);
    for (const s of styles) expect(s, s).toMatch(/;|font|padding|background|margin/);
    // And nothing after a style attribute looks like the tail of a broken one.
    expect(html).not.toMatch(/style="[^"]*"[A-Za-z][^=>]*",/);
  });

  it("escapes the subject it puts in the title — the subject is plain text", () => {
    expect(html).toContain("<title>You&#39;re registered — Captain&#39;s &lt;Day&gt;</title>");
  });

  it("takes its colours from the light ground, and loads nothing remote", () => {
    expect(html).toContain(LIGHT_GROUND.bg);
    expect(html).toContain(LIGHT_GROUND.text);
    expect(html).not.toMatch(/<img|src=|url\(/i);
  });
});

describe("the plain-text twin", () => {
  const text = emailText(parts);

  it("says the same thing, with no markup left in it", () => {
    expect(text).toContain("Thanks for entering Captain's <Day> & Dinner.");
    expect(text).not.toMatch(/<(p|strong|a)\b/);
  });

  it("keeps a link's address, which is the only way to follow it in text", () => {
    expect(text).toContain("Your entry (https://tourneyhq.club/me) is confirmed.");
  });

  it("carries the footer, set apart", () => {
    expect(text).toMatch(/\n--\nYou're getting this because you entered Captain's <Day> on TourneyHQ\.\n$/);
  });

  it("CONTROL: text a person typed that LOOKS like an entity comes back as typed", () => {
    const typed = "Fish &amp; Chips";
    expect(emailText({ bodyHtml: `<p>${escapeHtml(typed)}</p>`, whyHtml: "" })).toContain(typed);
  });
});
