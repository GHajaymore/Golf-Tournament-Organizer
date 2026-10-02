import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GlobalError from "@/app/global-error";

/**
 * The page shown when the root layout itself fails. It must stand on its own —
 * its own document, its own colours — and, like `error.tsx`, show the digest
 * the real error is logged under and never the error's message, which is
 * server detail that can name a table, a query or a person.
 */
describe("global-error", () => {
  const error = Object.assign(new Error("relation zz_member does not exist (Ann Zzwalk)"), { digest: "zz-digest-4821" });
  const html = renderToStaticMarkup(<GlobalError error={error} reset={() => {}} />);

  it("is a whole document, because the layout that would provide one failed", () => {
    expect(html).toMatch(/^<html/);
    expect(html).toContain("<body>");
    expect(html).toContain("--bg:");
  });

  it("gives the reference and the way back", () => {
    expect(html).toContain("zz-digest-4821");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/"');
  });

  it("never shows the error's message", () => {
    expect(html).not.toContain("zz_member");
    expect(html).not.toContain("Zzwalk");
  });
});
