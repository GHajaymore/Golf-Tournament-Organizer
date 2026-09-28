import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));

/**
 * A WRONG ADDRESS AND A FAILED SCREEN BOTH SAY WHAT HAPPENED AND OFFER A WAY ON.
 *
 * Until 2026-09-28 neither had a page of its own, so Next served its bare
 * defaults — "404: This page could not be found." and "Application error: a
 * server-side exception has occurred" — with no brand and nowhere to go.
 */
describe("the page for a wrong address", () => {
  it("has a heading and the two ways on", async () => {
    const { default: NotFound } = await import("@/app/not-found");
    const html = renderToStaticMarkup(<NotFound />);
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain('href="/choose"');
    expect(html).toContain('href="/"');
  });
});

describe("the page for a screen that failed", () => {
  it("offers a retry and quotes the reference, never the error's own message", async () => {
    const { default: ErrorPage } = await import("@/app/error");
    const err = Object.assign(new Error("relation \"Player\" leaked zz-Secret Name"), { digest: "zz-digest-4821" });
    const html = renderToStaticMarkup(<ErrorPage error={err} reset={() => {}} />);
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain("Try again");
    expect(html).toContain("zz-digest-4821");
    // The message is server detail and can name a table or a person.
    expect(html).not.toContain("zz-Secret Name");
    expect(html).not.toContain("relation");
  });

  it("CONTROL: with no digest there is no empty reference line", async () => {
    const { default: ErrorPage } = await import("@/app/error");
    const html = renderToStaticMarkup(<ErrorPage error={new Error("x")} reset={() => {}} />);
    expect(html).not.toContain("Reference:");
  });
});
