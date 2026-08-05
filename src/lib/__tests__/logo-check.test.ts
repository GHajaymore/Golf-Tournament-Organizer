import { describe, it, expect, vi } from "vitest";

// The module is server-only; stub the guard so it can be unit tested.
vi.mock("server-only", () => ({}));

const { blockedHost, problemWithUrl, checkLogoUrl } = await import("../services/logo-check");

describe("blocked hosts", () => {
  it("rejects loopback and internal names", () => {
    for (const h of ["localhost", "app.localhost", "printer.local", "db.internal", "x.home.arpa"]) {
      expect(blockedHost(h), `${h} should be blocked`).toBe(true);
    }
  });

  it("rejects cloud metadata endpoints", () => {
    expect(blockedHost("metadata.google.internal")).toBe(true);
    expect(blockedHost("metadata")).toBe(true);
    // The classic link-local metadata address.
    expect(blockedHost("169.254.169.254")).toBe(true);
  });

  it("rejects raw IP literals, which a club would never use", () => {
    // Blocking every literal removes the direct SSRF path without needing DNS
    // resolution — public addresses are collateral we're happy to lose here.
    for (const h of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "8.8.8.8"]) {
      expect(blockedHost(h), `${h} should be blocked`).toBe(true);
    }
    expect(blockedHost("::1")).toBe(true);
    expect(blockedHost("[fd00::1]")).toBe(true);
  });

  it("allows ordinary club domains", () => {
    for (const h of ["ridgelinegolf.com", "www.ridgelinegolf.co.uk", "cdn.example.org"]) {
      expect(blockedHost(h), `${h} should be allowed`).toBe(false);
    }
  });

  it("is case insensitive", () => {
    expect(blockedHost("LOCALHOST")).toBe(true);
    expect(blockedHost("Metadata.Google.Internal")).toBe(true);
  });
});

describe("url shape", () => {
  it("requires https", () => {
    expect(problemWithUrl("http://club.com/logo.png")).toMatch(/https/);
    expect(problemWithUrl("https://club.com/logo.png")).toBeNull();
  });

  it("rejects the schemes that would execute in a page header", () => {
    // These are why the field is validated at all — the value is rendered
    // into an <img src> on every screen.
    expect(problemWithUrl("javascript:alert(1)")).toBeTruthy();
    expect(problemWithUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeTruthy();
    expect(problemWithUrl("file:///etc/passwd")).toBeTruthy();
  });

  it("rejects nonsense", () => {
    expect(problemWithUrl("not a url")).toBeTruthy();
    expect(problemWithUrl("")).toBeTruthy();
  });

  it("blocks internal hosts even over https", () => {
    expect(problemWithUrl("https://169.254.169.254/latest/meta-data/")).toBeTruthy();
    expect(problemWithUrl("https://localhost/logo.png")).toBeTruthy();
  });
});

describe("checkLogoUrl", () => {
  const withFetch = async (impl: typeof fetch, url: string) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      return await checkLogoUrl(url);
    } finally {
      globalThis.fetch = original;
    }
  };

  const respond = (status: number, headers: Record<string, string> = {}) =>
    (async () => new Response(null, { status, headers })) as unknown as typeof fetch;

  it("treats an empty value as clearing the logo", async () => {
    expect(await checkLogoUrl("")).toEqual({ ok: true });
    expect(await checkLogoUrl("   ")).toEqual({ ok: true });
  });

  it("accepts an image response", async () => {
    const res = await withFetch(
      respond(200, { "content-type": "image/png", "content-length": "19052" }),
      "https://club.com/logo.png",
    );
    expect(res.ok).toBe(true);
    expect(res.warning).toBeUndefined();
  });

  it("rejects a page pretending to be a logo", async () => {
    const res = await withFetch(
      respond(200, { "content-type": "text/html; charset=utf-8" }),
      "https://club.com/logo",
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/page, not an image/);
  });

  it("names the private-image case specifically, since that's the bug", async () => {
    // The organizer sees it because they're signed in; nobody else does.
    const res = await withFetch(respond(403), "https://club.com/members/logo.png");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/private/);
  });

  it("rejects an error status", async () => {
    const res = await withFetch(respond(404), "https://club.com/gone.png");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/404/);
  });

  it("rejects an oversized image", async () => {
    const res = await withFetch(
      respond(200, { "content-type": "image/png", "content-length": String(9 * 1024 * 1024) }),
      "https://club.com/huge.png",
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/large/);
  });

  it("warns rather than blocking when the host is unreachable", async () => {
    // Can't distinguish "broken" from "blocks our server but serves browsers",
    // so the organizer keeps control.
    const res = await withFetch(
      (async () => {
        throw new Error("ETIMEDOUT");
      }) as unknown as typeof fetch,
      "https://club.com/logo.png",
    );
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/couldn't load/i);
  });

  it("re-checks the destination of a redirect", async () => {
    // A redirect is a fresh URL, not a trusted continuation — otherwise it's
    // a way to smuggle a request to a blocked host.
    const res = await withFetch(
      (async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data/" },
        })) as unknown as typeof fetch,
      "https://club.com/logo.png",
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/isn't allowed/);
  });

  it("follows a legitimate CDN redirect", async () => {
    let call = 0;
    const res = await withFetch(
      (async () => {
        call += 1;
        if (call === 1) {
          return new Response(null, { status: 301, headers: { location: "https://cdn.club.com/logo.png" } });
        }
        return new Response(null, { status: 200, headers: { "content-type": "image/webp" } });
      }) as unknown as typeof fetch,
      "https://club.com/logo.png",
    );
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it("gives up on a redirect loop", async () => {
    const res = await withFetch(
      (async () =>
        new Response(null, { status: 302, headers: { location: "https://club.com/again.png" } })) as unknown as typeof fetch,
      "https://club.com/logo.png",
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/redirects too many times/);
  });
});
