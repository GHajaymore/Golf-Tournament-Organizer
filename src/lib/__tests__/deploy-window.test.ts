import { describe, it, expect, vi, afterEach } from "vitest";
import { deployWindow, onToday, clockIn, LONGEST_TOURNAMENT_DAYS } from "@/lib/domain/deploy-window";

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
