import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { deliveryWords, nextDeliveryStatus, verifySignedEvent } from "@/lib/domain/email-delivery";
import { readSource } from "./source";

/**
 * THE EARLY LIST'S COPY TO INQUIRIES@ SAYS WHERE IT WENT (2026-10-30).
 *
 * It sent nothing for days and nothing said so. These pin the three pieces
 * that now say so: the signature on a delivery event (a forged one moves
 * nothing), the order a status moves in, and that the send's outcome is
 * written onto the note rather than thrown away.
 */

const SECRET = "whsec_" + Buffer.from("zz-a-test-signing-key").toString("base64");
const NOW = 1_800_000_000;

function sign(id: string, ts: string, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

describe("a delivery event is believed only when the provider signed it", () => {
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "zz-1" } });
  const ts = String(NOW);
  const base = { secret: SECRET, id: "msg_zz", timestamp: ts, body, nowSeconds: NOW };

  it("accepts a correct signature, among several", () => {
    expect(verifySignedEvent({ ...base, signature: `v1,bm9wZQ== ${sign("msg_zz", ts, body)}` })).toBe(true);
  });

  it("refuses a changed body, another key, an old event, and no secret at all", () => {
    const good = sign("msg_zz", ts, body);
    expect(verifySignedEvent({ ...base, body: body.replace("delivered", "bounced"), signature: good })).toBe(false);
    expect(verifySignedEvent({ ...base, signature: sign("msg_zz", ts, body, "whsec_" + Buffer.from("other").toString("base64")) })).toBe(false);
    expect(verifySignedEvent({ ...base, nowSeconds: NOW + 301, signature: good })).toBe(false);
    expect(verifySignedEvent({ ...base, secret: "", signature: good })).toBe(false);
    expect(verifySignedEvent({ ...base, signature: good.replace("v1,", "v2,") })).toBe(false);
  });
});

describe("a status only moves forward", () => {
  it("walks sent → delayed → delivered, and an out-of-order 'sent' after delivery moves nothing", () => {
    expect(nextDeliveryStatus("sent", "email.delivery_delayed")).toBe("delayed");
    expect(nextDeliveryStatus("delayed", "email.delivered")).toBe("delivered");
    expect(nextDeliveryStatus("delivered", "email.sent")).toBeNull();
  });

  it("a suppressed or bounced copy is said, and opens and clicks are not tracked", () => {
    expect(nextDeliveryStatus("sent", "email.suppressed")).toBe("suppressed");
    expect(nextDeliveryStatus("sent", "email.bounced")).toBe("bounced");
    expect(nextDeliveryStatus("sent", "email.opened")).toBeNull();
    expect(deliveryWords("suppressed").trouble).toBe(true);
    expect(deliveryWords("unsent").trouble).toBe(true);
    expect(deliveryWords("delivered").trouble).toBe(false);
    expect(deliveryWords("").words).toMatch(/before 30 Oct/);
  });
});

describe("the send's outcome is kept, not thrown away", () => {
  it("registerInterest writes the copy's id and status onto the note", () => {
    const src = readSource("src/app/actions/interest.ts");
    expect(src).toMatch(/const copy = await sendInterestEmail\(/);
    expect(src).toMatch(/notifyId: copy\.id, notifyStatus: copy\.status/);
  });

  it("the webhook checks the signature before it reads the body as an event", () => {
    const src = readSource("src/app/api/email-events/route.ts");
    expect(src.indexOf("verifySignedEvent(")).toBeGreaterThan(-1);
    expect(src.indexOf("verifySignedEvent(")).toBeLessThan(src.indexOf("JSON.parse("));
  });

  it("the canary never sends to tourneyhq.club", () => {
    const src = readSource("src/lib/email.ts");
    const canary = src.slice(src.indexOf("export async function sendCanaryEmail"), src.indexOf("export async function emailLastEvent"));
    expect(canary).toMatch(/delivered@resend\.dev/);
    expect(canary).not.toMatch(/tourneyhq\.club|SALES_EMAIL|ADMIN_EMAIL|SUPPORT_EMAIL/);
  });
});
