import { describe, it, expect } from "vitest";

/**
 * THE CONTENT-SECURITY-POLICY (2026-11-13, security sweep M4).
 *
 * Read from the config the app is built with, not from a copy of it. The four
 * directives that need no nonce are ENFORCED; the origin lists are REPORT-ONLY
 * until the inline scripts and theme styles can carry a per-request nonce (see
 * the note above `headers()` in `next.config.mjs`).
 */
async function headersOf(): Promise<Record<string, string>> {
  const mod = (await import("../../../next.config.mjs")) as { default: { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> } };
  const rules = await mod.default.headers();
  const all = rules.find((r) => r.source === "/:path*");
  expect(all, "no header rule for every path").toBeTruthy();
  return Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
}

describe("the content-security-policy", () => {
  it("enforces the directives that need no nonce on every path", async () => {
    const csp = (await headersOf())["Content-Security-Policy"];
    expect(csp, "no enforced Content-Security-Policy").toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("enforces nothing that would break a page: no script or style source in the enforced header", async () => {
    const csp = (await headersOf())["Content-Security-Policy"];
    expect(csp).not.toMatch(/script-src|style-src|default-src/);
  });

  it("reports the origin lists, and says 'unsafe-inline' honestly where Next needs it", async () => {
    const report = (await headersOf())["Content-Security-Policy-Report-Only"];
    expect(report, "no report-only policy").toBeTruthy();
    expect(report).toContain("default-src 'self'");
    expect(report).toContain("script-src 'self' 'unsafe-inline'");
    expect(report).toContain("frame-ancestors 'none'");
  });

  it("keeps the older framing header beside it", async () => {
    expect((await headersOf())["X-Frame-Options"]).toBe("SAMEORIGIN");
  });
});
