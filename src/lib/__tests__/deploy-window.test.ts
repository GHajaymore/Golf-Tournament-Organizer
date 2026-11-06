import { describe, it, expect, vi, afterEach } from "vitest";
import { deployWindow, deployWindowFor, onToday, clockIn, LONGEST_TOURNAMENT_DAYS, HELD_RULE, LIVE_RULE, FREEZE_RESUMES, FREEZE_OFF } from "@/lib/domain/deploy-window";
import { signInAllowList } from "@/lib/sign-in-gate";

/**
 * THE DEPLOY FREEZE (the testing panel, 2026-10-23). A deploy waits while any
 * club is playing today in its own time, and on weekend mornings 05:00–14:00 in
 * any club's zone. Each case is pinned at an INSTANT and asked of zones on
 * either side of it, because "today" is the club's and not the server's — the
 * mistake `club-clock.ts` exists to prevent.
 */

// Saturday 2026-10-24 at 20:30 UTC: Sunday 09:30 in Auckland, Saturday 13:30 in Los Angeles.
const SAT_EVENING_UTC = new Date("2026-10-24T20:30:00Z");
// Tuesday 2026-10-27 at 12:00 UTC: an ordinary weekday everywhere that has clubs.
const TUESDAY_NOON_UTC = new Date("2026-10-27T12:00:00Z");

const event = (over: Partial<{ timeZone: string; startOn: string; endOn: string; playedOn: string[] }>) => ({ timeZone: "Europe/London", startOn: "", endOn: "", playedOn: [], ...over });

describe("a tournament on today, by its own club's clock", () => {
  it("a round dated today freezes; the same round dated tomorrow does not", () => {
    expect(onToday(event({ playedOn: ["2026-10-27"] }), TUESDAY_NOON_UTC)).toBe(true);
    expect(onToday(event({ playedOn: ["2026-10-28"] }), TUESDAY_NOON_UTC)).toBe(false);
  });

  it("'today' is the club's: Sunday in Auckland while it is still Saturday on the server", () => {
    // CONTROL: the server's (UTC) day is the 24th, so a club that read the server's day would miss this.
    expect(SAT_EVENING_UTC.toISOString().slice(0, 10)).toBe("2026-10-24");
    expect(onToday(event({ timeZone: "Pacific/Auckland", playedOn: ["2026-10-25"] }), SAT_EVENING_UTC)).toBe(true);
    expect(onToday(event({ timeZone: "Pacific/Auckland", playedOn: ["2026-10-24"] }), SAT_EVENING_UTC)).toBe(false);
  });

  it("dates that take in today freeze — unless they span a season", () => {
    expect(onToday(event({ startOn: "2026-10-26", endOn: "2026-10-28" }), TUESDAY_NOON_UTC)).toBe(true);
    expect(onToday(event({ startOn: "2026-10-27" }), TUESDAY_NOON_UTC)).toBe(true);
    // A league from April to September is open today and nobody is necessarily playing.
    expect(onToday(event({ startOn: "2026-04-01", endOn: "2026-11-30" }), TUESDAY_NOON_UTC)).toBe(false);
    // The boundary: a week is a tournament, a longer span is not.
    expect(LONGEST_TOURNAMENT_DAYS).toBe(7);
    expect(onToday(event({ startOn: "2026-10-21", endOn: "2026-10-27" }), TUESDAY_NOON_UTC)).toBe(true);
    expect(onToday(event({ startOn: "2026-10-20", endOn: "2026-10-27" }), TUESDAY_NOON_UTC)).toBe(false);
  });
});

describe("whether a deploy may go now", () => {
  it("is open on a weekday with nothing on", () => {
    const w = deployWindow(TUESDAY_NOON_UTC, ["Europe/London", "America/New_York", "Australia/Sydney"], []);
    expect(w.frozen).toBe(false);
  });

  it("is frozen while anybody is playing, and says how many and where — never who", () => {
    const w = deployWindow(TUESDAY_NOON_UTC, ["Europe/London"], [event({ playedOn: ["2026-10-27"] }), event({ timeZone: "America/New_York", startOn: "2026-10-27" })]);
    expect(w.frozen).toBe(true);
    expect(w.reason).toContain("2 tournaments");
    expect(w.reason).toContain("America/New_York");
    expect(w.reason).toContain("Europe/London");
  });

  it("is frozen on a weekend morning in ANY club's zone, and open when no club's morning it is", () => {
    // Sunday 09:30 in Auckland — frozen, though it is Saturday evening in London.
    expect(deployWindow(SAT_EVENING_UTC, ["Europe/London", "Pacific/Auckland"], []).frozen).toBe(true);
    expect(deployWindow(SAT_EVENING_UTC, ["Europe/London", "Pacific/Auckland"], []).reason).toContain("Pacific/Auckland");
    // CONTROL: the same instant with only London (21:30 Saturday) is open.
    expect(deployWindow(SAT_EVENING_UTC, ["Europe/London"], []).frozen).toBe(false);
    // 14:00 is the end: Saturday 13:30 in Los Angeles is frozen, 14:30 is not.
    expect(deployWindow(SAT_EVENING_UTC, ["America/Los_Angeles"], []).frozen).toBe(true);
    expect(deployWindow(new Date("2026-10-24T21:30:00Z"), ["America/Los_Angeles"], []).frozen).toBe(false);
  });

  it("reads the weekday, hour and minute of a zone as numbers", () => {
    expect(clockIn("Pacific/Auckland", SAT_EVENING_UTC)).toEqual({ weekday: 0, hour: 9, minute: 30 });
    expect(clockIn("America/Los_Angeles", SAT_EVENING_UTC)).toEqual({ weekday: 6, hour: 13, minute: 30 });
  });
});

/**
 * BEFORE LAUNCH THE FREEZE GUARDS ONLY PILOT CLUBS (Ajay, 2026-11-06). While production holds
 * sign-ins nobody but the owners and the people let in by name can be signed in, so a deploy lands
 * on a pilot club's organizer or on nobody. Held: only a pilot club playing today freezes, and the
 * weekend morning is off. Live: exactly the rule above, the answer saying which rule it was.
 * And before 20 November 2026 (`FREEZE_RESUMES`) nothing freezes at all, held or live.
 *
 * These instants are AFTER the resume, as the rule's own are not (October 2026).
 */
// Tuesday 2026-12-01 at 12:00 UTC: a weekday at every club below.
const DEC_TUESDAY_NOON_UTC = new Date("2026-12-01T12:00:00Z");
// Saturday 2026-12-05 at 20:30 UTC: Sunday 09:30 in Auckland (summer time), Saturday evening in London.
const DEC_SAT_EVENING_UTC = new Date("2026-12-05T20:30:00Z");

const PILOT = "zz-club-pilot";
const OWNERS = "zz-club-owners";
const pilots = new Set([PILOT]);
const at = (clubId: string, over: Partial<{ timeZone: string; startOn: string; endOn: string; playedOn: string[] }>) => ({ clubId, ...event(over) });

describe("the freeze is off until 20 November 2026 (Ajay, 6 Nov)", () => {
  const MINUTE = 60_000;
  const before = new Date(FREEZE_RESUMES.getTime() - MINUTE);
  const after = new Date(FREEZE_RESUMES.getTime() + MINUTE);
  // A pilot club on UTC playing on the 19th: on today on both sides of the resume (09:59 and 10:01 UTC).
  const pilotPlaying = [at(PILOT, { timeZone: "UTC", playedOn: ["2026-11-19"] })];

  it("resumes at 20 November 00:00 in the earliest zone on Earth — 19 November 10:00 UTC", () => {
    expect(FREEZE_RESUMES.toISOString()).toBe("2026-11-19T10:00:00.000Z");
    expect(clockIn("Pacific/Kiritimati", FREEZE_RESUMES)).toEqual({ weekday: 5, hour: 0, minute: 0 });
  });

  it("held: a pilot club playing is not frozen a minute before, and is frozen a minute after", () => {
    expect(deployWindowFor("held", before, ["UTC"], pilotPlaying, pilots)).toEqual({ frozen: false, reason: FREEZE_OFF });
    const w = deployWindowFor("held", after, ["UTC"], pilotPlaying, pilots);
    expect(w.frozen).toBe(true);
    expect(w.reason.startsWith(HELD_RULE)).toBe(true);
  });

  it("live: a club playing is not frozen a minute before, and is frozen a minute after", () => {
    expect(deployWindowFor("live", before, ["UTC"], pilotPlaying, new Set())).toEqual({ frozen: false, reason: FREEZE_OFF });
    const w = deployWindowFor("live", after, ["UTC"], pilotPlaying, new Set());
    expect(w.frozen).toBe(true);
    expect(w.reason.startsWith(LIVE_RULE)).toBe(true);
  });

  it("off means off: a weekend morning and every club playing, live, before the resume", () => {
    const owners = [at(OWNERS, { timeZone: "Pacific/Auckland", playedOn: ["2026-10-25"] })];
    expect(deployWindowFor("live", SAT_EVENING_UTC, ["Pacific/Auckland"], owners, pilots)).toEqual({ frozen: false, reason: FREEZE_OFF });
    // CONTROL: the live rule itself froze exactly that.
    expect(deployWindow(SAT_EVENING_UTC, ["Pacific/Auckland"], owners).frozen).toBe(true);
  });
});

describe("held or live: which clubs freeze a deploy", () => {
  const TUESDAY_NOON_UTC = DEC_TUESDAY_NOON_UTC;
  const SAT_EVENING_UTC = DEC_SAT_EVENING_UTC;

  it("held: a pilot club playing today freezes, and says so by the held rule — zones, never a name", () => {
    const w = deployWindowFor("held", TUESDAY_NOON_UTC, ["Europe/London"], [at(PILOT, { timeZone: "America/New_York", playedOn: ["2026-12-01"] })], pilots);
    expect(w.frozen).toBe(true);
    expect(w.reason.startsWith(HELD_RULE)).toBe(true);
    expect(w.reason).toContain("1 tournament is being played today");
    expect(w.reason).toContain("America/New_York");
    expect(w.reason).not.toContain(PILOT);
  });

  it("held: the owners' own club playing today does NOT freeze; live, the same tournament does", () => {
    const owners = [at(OWNERS, { playedOn: ["2026-12-01"] })];
    const held = deployWindowFor("held", TUESDAY_NOON_UTC, ["Europe/London"], owners, pilots);
    expect(held.frozen).toBe(false);
    expect(held.reason).toBe(`${HELD_RULE}, and none is playing today (1 pilot club); weekend mornings are not frozen before launch`);
    // CONTROL: live, every club counts — the very same rows freeze.
    const live = deployWindowFor("live", TUESDAY_NOON_UTC, ["Europe/London"], owners, pilots);
    expect(live.frozen).toBe(true);
    expect(live.reason.startsWith(LIVE_RULE)).toBe(true);
  });

  it("held: a pilot club's tournament on ANOTHER day does not freeze — the pilot is a club, not a pass", () => {
    expect(deployWindowFor("held", TUESDAY_NOON_UTC, [], [at(PILOT, { playedOn: ["2026-12-02"] })], pilots).frozen).toBe(false);
  });

  it("held: a weekend morning in a club's zone does not freeze; live, it does", () => {
    // Sunday 09:30 in Auckland, as in the live rule's own case above.
    const held = deployWindowFor("held", SAT_EVENING_UTC, ["Europe/London", "Pacific/Auckland"], [], pilots);
    expect(held.frozen).toBe(false);
    expect(held.reason).toContain("weekend mornings are not frozen before launch");
    const live = deployWindowFor("live", SAT_EVENING_UTC, ["Europe/London", "Pacific/Auckland"], [], pilots);
    expect(live.frozen).toBe(true);
    expect(live.reason).toContain("Pacific/Auckland");
  });

  it("held with no pilot club at all: nothing freezes, and the answer says there is none", () => {
    const w = deployWindowFor("held", SAT_EVENING_UTC, ["Pacific/Auckland"], [at(OWNERS, { timeZone: "Pacific/Auckland", playedOn: ["2026-12-06"] })], new Set());
    expect(w).toEqual({ frozen: false, reason: `${HELD_RULE}, and there is none (nobody on the sign-in allow-list is staff at a club); weekend mornings are not frozen before launch` });
  });

  it("live is the live rule word for word, after the words that name it", () => {
    for (const [when, zones, rows] of [
      [TUESDAY_NOON_UTC, ["Europe/London"], []],
      [TUESDAY_NOON_UTC, ["Europe/London"], [at(PILOT, { playedOn: ["2026-12-01"] }), at(OWNERS, { timeZone: "America/New_York", startOn: "2026-12-01" })]],
      [SAT_EVENING_UTC, ["Pacific/Auckland"], []],
    ] as const) {
      const live = deployWindowFor("live", when, [...zones], [...rows], new Set());
      const rule = deployWindow(when, [...zones], [...rows]);
      expect(live).toEqual({ frozen: rule.frozen, reason: `${LIVE_RULE} — ${rule.reason}` });
    }
  });

  it("the allow-list is read by the sign-in gate's one parser", () => {
    expect(signInAllowList({ SIGNIN_ALLOW_EMAILS: " Zz-Pilot@Example.invalid , ,zz-two@example.invalid" })).toEqual(["zz-pilot@example.invalid", "zz-two@example.invalid"]);
    expect(signInAllowList({})).toEqual([]);
  });
});

describe("/api/deploy-window", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  const load = async (answer: () => Promise<{ frozen: boolean; reason: string }>) => {
    vi.doMock("@/lib/services/deploy-window", () => ({ currentDeployWindow: answer }));
    return (await import("@/app/api/deploy-window/route")).GET;
  };
  const ask = (GET: (r: Request) => Promise<Response>, auth?: string) => GET(new Request("http://x.invalid/api/deploy-window", auth ? { headers: { authorization: auth } } : {}));

  it("REFUSES EVERYTHING when no token is configured", async () => {
    vi.stubEnv("DEPLOY_WINDOW_TOKEN", "");
    const GET = await load(async () => ({ frozen: true, reason: "x" }));
    expect((await ask(GET, "Bearer ")).status).toBe(401);
    expect((await ask(GET)).status).toBe(401);
  });

  it("refuses a wrong token and a right one sent the wrong way, saying nothing about which", async () => {
    vi.stubEnv("DEPLOY_WINDOW_TOKEN", "zz-window-token-for-tests");
    const GET = await load(async () => ({ frozen: true, reason: "x" }));
    const wrong = await ask(GET, "Bearer zz-not-it");
    const bare = await ask(GET, "zz-window-token-for-tests");
    expect([wrong.status, bare.status]).toEqual([401, 401]);
    expect(await wrong.text()).toBe(await bare.text());
  });

  it("answers the deploy job with frozen and a reason, and nothing else", async () => {
    vi.stubEnv("DEPLOY_WINDOW_TOKEN", "zz-window-token-for-tests");
    const GET = await load(async () => ({ frozen: false, reason: "nothing on" }));
    const res = await ask(GET, "Bearer zz-window-token-for-tests");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ frozen: false, reason: "nothing on" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is 503, with no error text, when the database cannot be asked", async () => {
    vi.stubEnv("DEPLOY_WINDOW_TOKEN", "zz-window-token-for-tests");
    const GET = await load(async () => {
      throw new Error("Can't reach database server at `db.zz-host.invalid:5432`");
    });
    const res = await ask(GET, "Bearer zz-window-token-for-tests");
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("zz-host");
  });
});
