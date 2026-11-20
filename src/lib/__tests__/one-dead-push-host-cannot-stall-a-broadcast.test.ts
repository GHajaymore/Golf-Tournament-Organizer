import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ONE DEAD PUSH HOST CANNOT STALL A BROADCAST (2026-11-14, the #1133 security
 * review F-1).
 *
 * `sendPushTo` is awaited by the organizer's press: publish a tee sheet, move a
 * round, suspend play. web-push was given no timeout, so one host that never
 * answers (a dead push service, or a URL a guest link's holder filed) held the
 * press until the function limit. Now every send has a limit: web-push's own
 * socket timeout, and a deadline on the wait, since a host that drips bytes
 * never goes idle. The real phones are still sent to, in the same window, and
 * the hung host's row is kept (slow is not gone).
 */

const HUNG = "https://push.example.invalid/zz-hung";
const PHONE = "https://push.example.invalid/zz-phone";
const sent = vi.hoisted(() => [] as Array<{ endpoint: string; options: unknown }>);
const deleted = vi.hoisted(() => [] as unknown[]);

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: (sub: { endpoint: string }, _body: string, options?: unknown) => {
      sent.push({ endpoint: sub.endpoint, options });
      // The hung host never answers, never errors.
      return sub.endpoint === HUNG ? new Promise(() => {}) : Promise.resolve({});
    },
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    pushSubscription: {
      findMany: async () => [
        { endpoint: HUNG, p256dh: "k", auth: "a", email: "zz-a@example.invalid" },
        { endpoint: PHONE, p256dh: "k", auth: "a", email: "zz-b@example.invalid" },
      ],
      deleteMany: async (args: unknown) => void deleted.push(args),
    },
    playerPassPush: { findMany: async () => [], deleteMany: async (args: unknown) => void deleted.push(args) },
  },
}));
vi.mock("@/lib/services/demo-guard", () => ({ demoRefusesMessage: async () => false }));
vi.mock("@/lib/services/player-link", () => ({ livePass: async () => null }));

process.env.VAPID_PUBLIC_KEY = "zz-public";
process.env.VAPID_PRIVATE_KEY = "zz-private";

const { sendPushTo, PUSH_SEND_TIMEOUT_MS } = await import("@/lib/services/push");

describe("a broadcast with one hung push host", () => {
  beforeEach(() => {
    sent.length = 0;
    deleted.length = 0;
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("finishes within the send limit, the real phone is still sent to, and the hung row is kept", async () => {
    let finished = false;
    const broadcast = sendPushTo(["zz-a@example.invalid", "zz-b@example.invalid"], { title: "Play is suspended", body: "Stop now." }, { eventId: "e1", delivery: "play-status" }).then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(PUSH_SEND_TIMEOUT_MS + 50);
    expect(finished, "one host that never answers held the organizer's press").toBe(true);
    await broadcast;
    expect(sent.map((s) => s.endpoint).sort()).toEqual([HUNG, PHONE].sort());
    expect(deleted, "a slow host is not a gone one: its row was deleted").toEqual([]);
  });

  it("every send asks web-push to time out too, so the socket itself is closed", async () => {
    const broadcast = sendPushTo(["zz-b@example.invalid"], { title: "Your tee time", body: "08:10" }, { eventId: "e1" });
    await vi.advanceTimersByTimeAsync(PUSH_SEND_TIMEOUT_MS + 50);
    await broadcast;
    for (const s of sent) expect(s.options).toMatchObject({ timeout: PUSH_SEND_TIMEOUT_MS });
  });

  it("the limit is seconds, not the function's: long enough for a real push service, short enough for a press", () => {
    expect(PUSH_SEND_TIMEOUT_MS).toBeGreaterThanOrEqual(1500);
    expect(PUSH_SEND_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});
