import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSource } from "./source";

/**
 * "STOP NOW" IS SENT AS URGENT, AND DIES YOUNG (2026-11-14, safety sweep G-5).
 *
 * `sendPushToEmails` passed no options, so web-push sent every notice at
 * Urgency normal with a four-week TTL. On Android a normal push is low
 * priority to a dozing phone, so "play is suspended" could arrive late; and a
 * phone that was off all afternoon could be told "stop now" the next morning.
 *
 *   play suspended / resumed   Urgency high, a TTL of minutes
 *   everything else            exactly as before: no options at all
 */

const sent = vi.hoisted(() => [] as Array<{ endpoint: string; options: unknown }>);

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, _body: string, options?: unknown) => {
      sent.push({ endpoint: sub.endpoint, options });
    },
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    pushSubscription: {
      findMany: async () => [{ endpoint: "https://push.example.invalid/zz-one", p256dh: "k", auth: "a" }],
      deleteMany: async () => ({ count: 0 }),
    },
  },
}));
vi.mock("@/lib/services/demo-guard", () => ({ demoRefusesMessage: async () => false }));

process.env.VAPID_PUBLIC_KEY = "zz-public";
process.env.VAPID_PRIVATE_KEY = "zz-private";

const { sendPushToEmails, sendOptionsFor, PLAY_STATUS_TTL_SECONDS } = await import("@/lib/services/push");

const payload = { title: "Play is suspended", body: "Stop now.", tag: "play-x", urgent: true };

describe("how a push is carried", () => {
  beforeEach(() => void sent.splice(0));

  it("a suspension or resumption goes at high urgency and lives minutes, not weeks", async () => {
    await sendPushToEmails(["zz@example.invalid"], payload, { eventId: "e1", delivery: "play-status" });
    expect(sent).toHaveLength(1);
    expect(sent[0].options, "the push service was not asked to hurry a safety notice").toEqual({ urgency: "high", TTL: PLAY_STATUS_TTL_SECONDS });
    expect(PLAY_STATUS_TTL_SECONDS).toBeGreaterThanOrEqual(5 * 60);
    expect(PLAY_STATUS_TTL_SECONDS, "a TTL of hours delivers yesterday's 'stop now'").toBeLessThanOrEqual(60 * 60);
  });

  it("CONTROL: everything else is sent exactly as before, with no options", async () => {
    await sendPushToEmails(["zz@example.invalid"], { title: "Your tee time is set", body: "08:10" }, { eventId: "e1" });
    expect(sent).toHaveLength(1);
    expect(sent[0].options).toBeUndefined();
    expect(sendOptionsFor("ordinary")).toBeUndefined();
  });

  it("suspend and resume both say so: the one sender of play's status asks for it", () => {
    const src = readSource("src", "app", "actions", "play-status.ts");
    const tell = src.slice(src.indexOf("async function tellTheField"), src.indexOf("export async function currentPlayStatus"));
    expect(tell, "tellTheField was not found").toContain("sendPushToEmails(");
    expect(tell, "the suspension push is sent as an ordinary one").toMatch(/delivery:\s*"play-status"/);
    // Both presses reach the field only through it.
    expect(src.match(/await tellTheField\(/g)?.length).toBe(2);
    expect(src.match(/sendPushToEmails\(/g)?.length).toBe(1);
  });
});
