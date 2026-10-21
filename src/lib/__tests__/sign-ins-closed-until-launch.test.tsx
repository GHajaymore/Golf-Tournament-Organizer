import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { maySignIn, signInsClosed, SIGNINS_CLOSED_MESSAGE, SIGNINS_CLOSED_NOTICE } from "@/lib/sign-in-gate";
import { LandingAuth } from "@/components/LandingAuth";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * SIGN-INS ARE CLOSED IN PRODUCTION UNTIL LAUNCH (Ajay, 2026-10-17).
 *
 * The rule is pure and tested here; the DOORS are swept from source, because a
 * gate that is right and is not asked keeps nobody out. The CONTROLS are the
 * cases that must stay OPEN — the owner in production, and every environment
 * that is not production — since a gate hard-wired shut passes every refusal.
 */

const CLOSED = { SIGNIN_ALLOW_EMAILS: "first@example.invalid, Owner@Example.invalid" };

describe("who may sign in while closed", () => {
  it("CONTROL: an address on SIGNIN_ALLOW_EMAILS may, whatever its case and spacing", () => {
    expect(signInsClosed(CLOSED)).toBe(true);
    expect(maySignIn("owner@example.invalid", CLOSED)).toBe(true);
    expect(maySignIn("  OWNER@example.INVALID ", CLOSED)).toBe(true);
    expect(maySignIn("first@example.invalid", CLOSED)).toBe(true);
  });

  it("CONTROL: a platform owner on OWNER_EMAILS may too", () => {
    expect(maySignIn("boss@example.invalid", { ...CLOSED, OWNER_EMAILS: "boss@example.invalid" })).toBe(true);
  });

  it("anybody else may not, and an empty address never may", () => {
    expect(maySignIn("visitor@example.invalid", CLOSED)).toBe(false);
    expect(maySignIn("", CLOSED)).toBe(false);
    expect(maySignIn(null, CLOSED)).toBe(false);
    expect(maySignIn(undefined, CLOSED)).toBe(false);
  });

  it("OPEN EVERYWHERE THAT IS NOT PRODUCTION — dev, CI, every e2e run, every preview — with no list", () => {
    for (const VERCEL_ENV of [undefined, "", "preview", "development"]) {
      for (const SIGNIN_ALLOW_EMAILS of [undefined, "", "  ", " , "]) {
        const env = { VERCEL_ENV, SIGNIN_ALLOW_EMAILS, OWNER_EMAILS: "boss@example.invalid" };
        expect(signInsClosed(env), `${VERCEL_ENV}`).toBe(false);
        expect(maySignIn("visitor@example.invalid", env)).toBe(true);
      }
    }
  });

  it("PRODUCTION IS HELD UNTIL LAUNCH, its owners let through (Ajay, 2026-10-21)", () => {
    // Measured that day: production's owner list holds his address (/owner answered 200).
    const env = { VERCEL_ENV: "production", OWNER_EMAILS: "boss@example.invalid" };
    expect(signInsClosed(env)).toBe(true);
    expect(maySignIn("boss@example.invalid", env)).toBe(true);
    expect(maySignIn("visitor@example.invalid", env)).toBe(false);
  });

  it("…but never with nobody to let through: an empty owner list leaves production open, so it cannot lock everyone out", () => {
    for (const OWNER_EMAILS of [undefined, "", " , "]) {
      const env = { VERCEL_ENV: "production", OWNER_EMAILS };
      expect(signInsClosed(env)).toBe(false);
      expect(maySignIn("visitor@example.invalid", env)).toBe(true);
    }
  });

  it("LAUNCH: SIGNINS=open opens production", () => {
    const env = { VERCEL_ENV: "production", OWNER_EMAILS: "boss@example.invalid", SIGNINS: "open" };
    expect(signInsClosed(env)).toBe(false);
    expect(maySignIn("visitor@example.invalid", env)).toBe(true);
  });

  it("SIGNINS=open opens it without deleting the list", () => {
    for (const SIGNINS of ["open", " OPEN "]) {
      expect(signInsClosed({ ...CLOSED, SIGNINS })).toBe(false);
      expect(maySignIn("visitor@example.invalid", { ...CLOSED, SIGNINS })).toBe(true);
    }
  });
});

describe("every door asks", () => {
  const auth = readSource("src/lib/auth.ts");
  const fnBody = (src: string, name: string) => {
    const at = src.indexOf(`export async function ${name}(`);
    expect(at, `${name} not found`).toBeGreaterThan(-1);
    const next = src.indexOf("\nexport ", at + 1);
    return src.slice(at, next === -1 ? undefined : next);
  };

  it("createSession refuses before it sets the cookie", () => {
    const body = fnBody(auth, "createSession");
    const asks = body.indexOf("maySignIn(");
    expect(asks).toBeGreaterThan(-1);
    expect(asks).toBeLessThan(body.indexOf("jar.set("));
  });

  it("getSession does not honour a session made before sign-ins closed", () => {
    expect(fnBody(auth, "getSession")).toMatch(/if \(!maySignIn\(user\.email\)\) return null;/);
  });

  it("each sign-in action says why, before it does any work", () => {
    const actions = readSource("src/app/actions/auth.ts");
    for (const name of ["signInWithPassword", "claimPassword", "requestPasswordReset", "resetPassword", "signUp"]) {
      expect(fnBody(actions, name), `${name} does not ask maySignIn`).toMatch(/if \(!maySignIn\([^)]*\)\) return \{ ok: false, error: SIGNINS_CLOSED_MESSAGE \};/);
    }
  });

  it("createSession is the only writer of the session cookie, and nothing else names it", () => {
    // A second writer would be a door the gate never sees.
    expect(auth).toMatch(/const COOKIE = "ng_session";/);
    expect(auth.split("jar.set(COOKIE,").length - 1).toBe(1);
    const others: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name !== "__tests__") walk(rel);
        } else if (/\.(ts|tsx)$/.test(e.name) && rel !== "src/lib/auth.ts" && readSource(rel).includes("ng_session")) {
          others.push(rel);
        }
      }
    };
    walk("src");
    expect(others).toEqual([]);
  });
});

describe("the front door says so before the form", () => {
  it("shows the under-development notice when closed", () => {
    const html = renderToStaticMarkup(<LandingAuth closed />);
    expect(html).toContain(SIGNINS_CLOSED_NOTICE.lead);
    expect(html).toContain("href=\"/play\"");
    // An interested visitor is sent to the live inquiries mailbox.
    expect(html).toContain("href=\"mailto:inquiries@tourneyhq.club?subject=");
    // NO DISCOUNT IS PUBLISHED (Ajay, 2026-10-21: "do not publish the discount
    // code") — the notice invites them to write, and the offer goes in the reply.
    // The notice's WORDS, before the form: the form keeps its own optional
    // discount box, and the markup's styles are full of percentages.
    const notice = html.slice(0, html.indexOf("<form")).replace(/<[^>]*>/g, " ");
    expect(notice).toContain(SIGNINS_CLOSED_NOTICE.interestedLead);
    expect(notice).not.toMatch(/\d+\s*%|discount|off (their|your) first/i);
    expect(html.indexOf(SIGNINS_CLOSED_NOTICE.lead)).toBeLessThan(html.indexOf("<form"));
  });

  it("tells a visitor what is coming, never that they are shut out", () => {
    const words = [SIGNINS_CLOSED_MESSAGE, ...Object.values(SIGNINS_CLOSED_NOTICE)].join(" ").toLowerCase();
    expect(words).toContain("opens soon");
    expect(words).toContain("under development");
    for (const shut of ["closed", "blocked", "denied", "not allowed"]) expect(words).not.toContain(shut);
  });

  it("CONTROL: says nothing of it when open", () => {
    expect(renderToStaticMarkup(<LandingAuth />)).not.toContain(SIGNINS_CLOSED_NOTICE.lead);
  });

  /**
   * NO SIGN-UP FORM WHILE HELD (Ajay, 2026-10-21: "the sign up/signin is still not gated … it still
   * allow to sign up"). The server refused every stranger, but under the notice sat a working form
   * with a Sign up tab, a "Create your account" heading and a discount box — and for an owner, whom
   * the hold lets through, it worked. Held, the door offers signing in and nothing else, even when a
   * link asked for sign-up ("Start free" goes to #signup).
   */
  it("offers signing in only while held — no Sign up tab, no account form — even when a link asked for sign-up", () => {
    const held = renderToStaticMarkup(<LandingAuth closed defaultMode="signup" />);
    expect(held, "a Sign up tab is on the held front door").not.toMatch(/>\s*Sign up\s*</);
    expect(held, "the held front door offers to create an account").not.toContain("Create your account");
    expect(held).not.toContain('role="tablist"');
    expect(held, "the owners have no way in").toContain("Already have access?");
    // CONTROL: open, the same link opens the sign-up form with its tab.
    const open = renderToStaticMarkup(<LandingAuth defaultMode="signup" />);
    expect(open).toContain("Create your account");
    expect(open).toMatch(/>\s*Sign up\s*</);
  });

  it("the landing page hands the gate's answer to the box", () => {
    expect(readSource("src/app/page.tsx")).toMatch(/closed=\{signInsClosed\(\)\}/);
  });
});
