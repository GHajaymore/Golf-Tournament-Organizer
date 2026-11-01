import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { SESSION_SECONDS, readSessionValue, sessionRefusal, sessionValue } from "../session-token";
import { readSource } from "../../__tests__/source";

/**
 * A SIGN-IN HAS AN END (2026-10-11).
 *
 * The session cookie held the signed user id alone: one value per person for
 * ever, good with no end date on any copy of it, and untouched by a password
 * reset. See `session-token.ts` for what it carries now and why.
 */
const NOON = new Date("2026-10-11T12:00:00.000Z");
const later = (s: number) => new Date(NOON.getTime() + s * 1000);

describe("what a session cookie carries", () => {
  it("is the person and the moment they signed in", () => {
    const held = readSessionValue(sessionValue("cmabc123user", NOON));
    expect(held).toEqual({ userId: "cmabc123user", issuedAt: Math.floor(NOON.getTime() / 1000) });
  });

  it("refuses the bare user id an old cookie holds", () => {
    // The whole defect in one line: this value used to BE the session.
    expect(readSessionValue("cmabc123user")).toBeNull();
  });

  it("refuses anything that is not a person and a time", () => {
    for (const bad of ["", "~", "~abc", "cmabc~", "cmabc~not a time", "cmabc~-5", "cmabc~0", "cmabc~" + "z".repeat(40), null, undefined]) {
      expect(readSessionValue(bad), String(bad)).toBeNull();
    }
  });

  it("two sign-ins by one person are two different values", () => {
    // Which is what lets the server tell one from the other at all.
    expect(sessionValue("u1", NOON)).not.toBe(sessionValue("u1", later(1)));
  });
});

describe("how long it is good for", () => {
  const held = readSessionValue(sessionValue("u1", NOON))!;

  it("is good from the moment it is issued", () => {
    expect(sessionRefusal(held, null, NOON)).toBeNull();
    expect(sessionRefusal(held, null, later(60))).toBeNull();
  });

  it("is good for as long as the cookie says, and not a second more", () => {
    expect(sessionRefusal(held, null, later(SESSION_SECONDS))).toBeNull();
    expect(sessionRefusal(held, null, later(SESSION_SECONDS + 1))).toBe("expired");
  });

  it("lasts the seven days the cookie has always claimed", () => {
    // Pinned so that enforcing the life on the server changes nothing for a
    // browser that was already honouring it.
    expect(SESSION_SECONDS).toBe(7 * 24 * 60 * 60);
    const auth = readSource("src", "lib", "auth.ts");
    expect(auth, "the cookie's own max-age is no longer the session's life").toMatch(/maxAge: SESSION_SECONDS/);
  });

  it("is not good when dated in the future", () => {
    const tomorrow = readSessionValue(sessionValue("u1", later(24 * 60 * 60)))!;
    expect(sessionRefusal(tomorrow, null, NOON)).toBe("not yet");
  });

  it("CONTROL: a server whose clock is a few seconds behind does not sign people out", () => {
    const aMomentAhead = readSessionValue(sessionValue("u1", later(20)))!;
    expect(sessionRefusal(aMomentAhead, null, NOON)).toBeNull();
  });
});

describe("a password reset ends every earlier sign-in", () => {
  const before = readSessionValue(sessionValue("u1", NOON))!;

  it("refuses a session issued before the cutoff", () => {
    expect(sessionRefusal(before, later(3600), later(3601))).toBe("ended");
  });

  it("keeps the session the reset itself starts, issued in the same second", () => {
    // The cutoff is a millisecond time and the issue time whole seconds: a
    // reset at 12:00:00.900 signs the person in at 12:00:00, which is BEFORE
    // it by the clock and must not be ended by it.
    const cutoff = new Date(NOON.getTime() + 900);
    const reborn = readSessionValue(sessionValue("u1", cutoff))!;
    expect(sessionRefusal(reborn, cutoff, later(5))).toBeNull();
  });

  it("CONTROL: somebody who has never reset has no cutoff, and is not ended by its absence", () => {
    expect(sessionRefusal(before, null, later(60))).toBeNull();
    expect(sessionRefusal(before, undefined, later(60))).toBeNull();
  });

  it("CONTROL: a cutoff in the past ends nothing issued since", () => {
    expect(sessionRefusal(before, new Date(NOON.getTime() - 60_000), later(60))).toBeNull();
  });
});

/**
 * THE FIXTURES SIGN WHAT THE APP SIGNS.
 *
 * About twenty scripts and browser fixtures mint a session cookie for
 * themselves. A fixture the app turns away fails as a sign-in redirect on
 * every screen — a 307, which a route walk reads as the app working (CLAUDE.md,
 * "a check that can pass without the content ever arriving").
 */
describe("a fixture's sign-in", () => {
  it("is made by one helper, which agrees with the app's own", async () => {
    const { signedInNow } = await import("../../../../scripts/session-cookie.mjs");
    expect(signedInNow("cmabc123user", NOON.getTime())).toBe(sessionValue("cmabc123user", NOON));
    expect(readSessionValue(signedInNow("cmabc123user"))?.userId).toBe("cmabc123user");
  });

  const fixtures = [
    ...readdirSync(join(process.cwd(), "e2e")).map((f) => `e2e/${f}`),
    ...readdirSync(join(process.cwd(), "scripts")).map((f) => `scripts/${f}`),
  ].filter((f) => f.endsWith(".mjs") || f.endsWith(".ts"));

  /** A line that makes a session from a bare id: signed, or with its signature spelled out. */
  const PEOPLE = ["user", "playerUser", "organizer", "player", "member"];
  const bare = (line: string) => {
    // The value put straight into the cookie, wherever a cookie is built…
    for (const made of ["ng_session=${", "session: ", 'name: "ng_session", value: ']) {
      const at = line.indexOf(made);
      if (at < 0) continue;
      const rest = line.slice(at + made.length);
      if (rest.startsWith("sign(") && !rest.startsWith("sign(signedInNow(")) return true;
    }
    // …and a person's id signed, or its signature worked out, on its own.
    return PEOPLE.some(
      (who) => line.includes(`sign(${who}.id)`) || line.includes(`.update(${who}.id)`) || line.includes(`ng_session=\${${who}.id}`),
    );
  };

  it("no fixture signs a bare user id any more", () => {
    const wrong = fixtures.flatMap((file) =>
      readSource(...file.split("/"))
        .split("\n")
        .filter(bare)
        .map((line) => `${file}: ${line.trim().slice(0, 100)}`),
    );
    expect(wrong).toEqual([]);
  });

  it("CONTROL: the sweep reads the fixtures, and knows the old spellings", () => {
    const using = fixtures.filter((file) => readSource(...file.split("/")).includes("signedInNow("));
    expect(using.length, "almost no fixture signs in through the helper — the sweep is reading nothing").toBeGreaterThanOrEqual(15);
    expect(using).toContain("scripts/seed-club.mjs");
    expect(using).toContain("e2e/fixture.mjs");
    expect(bare("      organizer: { session: sign(organizer.id), event: sign(event.id) },")).toBe(true);
    expect(bare("    const cookie = `ng_session=${user.id}.${mac}`;")).toBe(true);
    expect(bare('    const mac = createHmac("sha256", secret).update(user.id).digest("base64url");')).toBe(true);
    expect(bare("      organizer: { session: sign(signedInNow(organizer.id)), event: sign(event.id) },")).toBe(false);
    expect(bare("    { name: \"ng_active_event\", value: sign(medal.id), url: baseURL },")).toBe(false);
  });
});

describe("where it is enforced", () => {
  const auth = readSource("src", "lib", "auth.ts");
  const read = auth.slice(auth.indexOf("export async function getSession"));

  it("every session is made with its issue time", () => {
    expect(auth).toMatch(/jar\.set\(COOKIE, sign\(sessionValue\(userId\)\), COOKIE_OPTS\)/);
    expect(auth, "a session is still signed from the bare user id somewhere").not.toMatch(/jar\.set\(COOKIE, sign\(userId\)/);
  });

  it("every session is read through both rules before anybody is signed in", () => {
    expect(read).toMatch(/readSessionValue\(verify\(jar\.get\(COOKIE\)\?\.value\)\)/);
    expect(read).toMatch(/sessionRefusal\(held, user\.sessionsValidFrom\)/);
    // ORDER: refused before the tournaments this person can reach are looked up.
    expect(read.indexOf("sessionRefusal(")).toBeLessThan(read.indexOf("accessibleEvents("));
  });

  it("a password reset moves the cutoff, before it signs the person back in", () => {
    const actions = readSource("src", "app", "actions", "auth.ts");
    const reset = actions.slice(actions.indexOf("export async function resetPassword"), actions.indexOf("export async function signUp"));
    expect(reset).toMatch(/const now = new Date\(\);/);
    // Written together. (A reset also proves the address since 2026-10-21, so
    // the statement carries `emailVerifiedAt` after these two.)
    expect(reset).toMatch(/data: \{ password: hashPassword\(password\), sessionsValidFrom: now[, ]/);
    expect(reset.indexOf("sessionsValidFrom: now")).toBeLessThan(reset.indexOf("startSessionFor("));
  });

  it("and voids every other reset link still out for that account", () => {
    // Two requests a minute apart are two working links for fifteen minutes;
    // using one must not leave the other good.
    const actions = readSource("src", "app", "actions", "auth.ts");
    const reset = actions.slice(actions.indexOf("export async function resetPassword"), actions.indexOf("export async function signUp"));
    expect(reset).toMatch(/passwordResetToken\.updateMany\(\{ where: \{ userId: record\.userId, usedAt: null \}, data: \{ usedAt: now \} \}\)/);
  });
});
