import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { maySignIn, signInsClosed, SIGNINS_CLOSED_NOTICE } from "@/lib/sign-in-gate";
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

const PROD = { VERCEL_ENV: "production", OWNER_EMAILS: "owner@example.invalid" };

describe("who may sign in while closed", () => {
  it("CONTROL: the owner may, in production", () => {
    expect(signInsClosed(PROD)).toBe(true);
    expect(maySignIn("owner@example.invalid", PROD)).toBe(true);
    expect(maySignIn("  Owner@Example.INVALID ", PROD)).toBe(true);
  });

  it("CONTROL: an address on SIGNIN_ALLOW_EMAILS may", () => {
    expect(maySignIn("helper@example.invalid", { ...PROD, SIGNIN_ALLOW_EMAILS: "a@example.invalid, helper@example.invalid" })).toBe(true);
  });

  it("anybody else may not, and an empty address never may", () => {
    expect(maySignIn("visitor@example.invalid", PROD)).toBe(false);
    expect(maySignIn("", PROD)).toBe(false);
    expect(maySignIn(null, PROD)).toBe(false);
    expect(maySignIn(undefined, PROD)).toBe(false);
  });

  it("CONTROL: everywhere that is not production is open — dev, preview, CI, every e2e run", () => {
    for (const VERCEL_ENV of [undefined, "", "preview", "development"]) {
      const env = { ...PROD, VERCEL_ENV };
      expect(signInsClosed(env)).toBe(false);
      expect(maySignIn("visitor@example.invalid", env)).toBe(true);
    }
  });

  it("SIGNINS=open opens production to everybody", () => {
    for (const SIGNINS of ["open", " OPEN "]) {
      expect(signInsClosed({ ...PROD, SIGNINS })).toBe(false);
      expect(maySignIn("visitor@example.invalid", { ...PROD, SIGNINS })).toBe(true);
    }
    expect(signInsClosed({ ...PROD, SIGNINS: "closed" })).toBe(true);
  });

  it("fails OPEN with nobody on either list, so a missing variable cannot lock the owner out", () => {
    expect(signInsClosed({ VERCEL_ENV: "production" })).toBe(false);
    expect(signInsClosed({ VERCEL_ENV: "production", OWNER_EMAILS: " , " })).toBe(false);
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
    expect(html).toContain("tourneyhq.club/play");
    expect(html.indexOf(SIGNINS_CLOSED_NOTICE.lead)).toBeLessThan(html.indexOf("<form"));
  });

  it("CONTROL: says nothing of it when open", () => {
    expect(renderToStaticMarkup(<LandingAuth />)).not.toContain(SIGNINS_CLOSED_NOTICE.lead);
  });

  it("the landing page hands the gate's answer to the box", () => {
    expect(readSource("src/app/page.tsx")).toMatch(/closed=\{signInsClosed\(\)\}/);
  });
});
