import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { maySignIn, signInsClosed, SIGNINS_CLOSED_MESSAGE, SIGNINS_CLOSED_NOTICE, HELD_FRONT_DOOR } from "@/lib/sign-in-gate";
import { LandingAuth } from "@/components/LandingAuth";
import { LoginPanel } from "@/components/LoginPanel";
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
    const asks = body.indexOf("maySignInNow(");
    expect(asks).toBeGreaterThan(-1);
    expect(asks).toBeLessThan(body.indexOf("jar.set("));
  });

  it("getSession does not honour a session made before sign-ins closed", () => {
    expect(fnBody(auth, "getSession")).toMatch(/if \(!\(await maySignInNow\(user\.email\)\)\) return null;/);
  });

  it("each sign-in action says why, before it does any work", () => {
    const actions = readSource("src/app/actions/auth.ts");
    for (const name of ["signInWithPassword", "claimPassword", "requestPasswordReset", "resetPassword", "signUp"]) {
      expect(fnBody(actions, name), `${name} does not ask maySignInNow`).toMatch(/if \(!\(await maySignInNow\([^)]*\)\)\) return \{ ok: false, error: SIGNINS_CLOSED_MESSAGE \};/);
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
  it("shows the notice when held: paused, the early-list offer with its terms, and never a code", () => {
    const html = renderToStaticMarkup(<LandingAuth closed />);
    expect(html).toContain(SIGNINS_CLOSED_NOTICE.lead);
    expect(html).toContain("href=\"/play\"");
    // The early list goes to the live inquiries mailbox, under a subject inquiries@ can sort by.
    expect(html).toContain(`href="mailto:inquiries@tourneyhq.club?subject=${encodeURIComponent(SIGNINS_CLOSED_NOTICE.interestedSubject)}"`);
    // THE OFFER, AND NEVER A CODE (Ajay, 2026-10-21: "still there is no early discount marketing";
    // earlier, "do not publish the discount code"). The notice's WORDS, before the staff link (held,
    // there is no form on the page until that link is pressed).
    const staffAt = html.indexOf(HELD_FRONT_DOOR.staffLink);
    expect(staffAt, "the staff link is not after the notice").toBeGreaterThan(html.indexOf(SIGNINS_CLOSED_NOTICE.lead));
    const notice = html
      .slice(0, staffAt)
      .replace(/<[^>]*>/g, " ")
      .replace(/&#x27;/g, "'");
    expect(notice).toContain(SIGNINS_CLOSED_NOTICE.offer);
    expect(notice, "the offer has no terms beside it (an ad's destination needs them)").toContain(SIGNINS_CLOSED_NOTICE.terms);
    expect(notice).toMatch(/25% off your first term/);
    // No code is printed: nothing shaped like one (letters and digits, upper case).
    expect(notice).not.toMatch(/\b[A-Z0-9]{6,}\b/);
  });

  it("tells a visitor what is coming, never that they are shut out — and never 'under development'", () => {
    const words = [SIGNINS_CLOSED_MESSAGE, ...Object.values(SIGNINS_CLOSED_NOTICE), ...Object.values(HELD_FRONT_DOOR)].join(" ").toLowerCase();
    expect(words).toContain("opens soon");
    expect(words).toContain("paused");
    // The ad director: Google reads an "under construction" destination as a reason to refuse the ad.
    expect(words).not.toContain("under development");
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
  it("shows a visitor no login boxes while held — only one quiet link for the staff — even when a link asked for sign-up", () => {
    // Ajay, 2026-10-21, looking at the front page: it was "allowing me to enter the userid and password".
    const held = renderToStaticMarkup(<LandingAuth closed defaultMode="signup" />);
    expect(held, "a password box is on the held front door").not.toContain('type="password"');
    expect(held, "an email box is on the held front door").not.toContain('type="email"');
    expect(held, "a Sign up tab is on the held front door").not.toMatch(/>\s*Sign up\s*</);
    expect(held, "the held front door offers to create an account").not.toContain("Create your account");
    expect(held, "the owners have no way in").toContain(HELD_FRONT_DOOR.staffLink);
    expect(held).toContain('aria-expanded="false"');
    // CONTROL: open, the same link opens the sign-up form with its tab and its boxes.
    const open = renderToStaticMarkup(<LandingAuth defaultMode="signup" />);
    expect(open).toContain("Create your account");
    expect(open).toMatch(/>\s*Sign up\s*</);
    expect(open).toContain('type="password"');
  });

  it("the box the staff link opens signs in and does nothing else", () => {
    const box = renderToStaticMarkup(<LoginPanel initialMode="signup" signupClosed autoFocusFields={false} />);
    expect(box).toContain(HELD_FRONT_DOOR.signInTitle);
    expect(box).toContain('type="password"');
    expect(box).not.toContain('role="tablist"');
    expect(box).not.toContain("Create your account");
  });

  it("the landing page hands the gate's answer to the box", () => {
    expect(readSource("src/app/page.tsx")).toMatch(/const held = await signInsHeld\(\);[\s\S]*closed=\{held\}/);
  });
});
