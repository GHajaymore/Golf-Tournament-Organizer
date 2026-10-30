import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WHERE A COPY TO INQUIRIES@ GOT TO (2026-10-30).
 *
 * The early list sent nothing to inquiries@ for days and nothing anywhere said
 * so: a refused send was "recorded" through `recordFailure`, which keeps a row
 * per CLUB and drops a send with no club — and a note of interest never has
 * one. The provider can also accept a send and then decline to deliver it (an
 * address on its suppression list after the mailbox bounced), which no answer
 * to the send itself can show.
 *
 * So every copy keeps the provider's message id and a status, and the
 * provider's delivery events move that status on. This file is the rule: what
 * each state is called, which event moves it where, and whether an event may
 * be believed at all (`verifySignedEvent`).
 */

/** "" — nothing tried yet; the rest in the order a send passes through them. */
export type DeliveryStatus = "" | "unsent" | "failed" | "sent" | "delayed" | "delivered" | "bounced" | "suppressed" | "complained";

/** The provider's event types that say where a message is. Opens and clicks are not tracked. */
const EVENT_STATUS: Record<string, DeliveryStatus> = {
  "email.sent": "sent",
  "email.delivery_delayed": "delayed",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.suppressed": "suppressed",
  "email.complained": "complained",
  "email.failed": "failed",
};

/** A later event never takes a message back: "sent" arriving after "delivered" is out of order, not news. */
const RANK: Record<DeliveryStatus, number> = {
  "": 0,
  unsent: 1,
  sent: 2,
  delayed: 3,
  delivered: 4,
  failed: 5,
  bounced: 5,
  suppressed: 5,
  complained: 5,
};

/** The status an event moves a message to, or null when the event is not one we track or would move it backwards. */
export function nextDeliveryStatus(current: string, eventType: string): DeliveryStatus | null {
  const next = EVENT_STATUS[eventType];
  if (!next) return null;
  const now = (current in RANK ? current : "") as DeliveryStatus;
  return RANK[next] > RANK[now] ? next : null;
}

/** What the owner reads beside a note, and whether it wants doing something about. */
export function deliveryWords(status: string): { words: string; trouble: boolean } {
  switch (status) {
    case "delivered":
      return { words: "Delivered", trouble: false };
    case "sent":
      return { words: "Sent, not yet confirmed", trouble: false };
    case "delayed":
      return { words: "Delayed by the receiving server", trouble: false };
    case "bounced":
      return { words: "Bounced", trouble: true };
    case "suppressed":
      return { words: "Not sent: the address is on the provider's suppression list", trouble: true };
    case "complained":
      return { words: "Marked as spam", trouble: true };
    case "failed":
      return { words: "Refused by the provider", trouble: true };
    case "unsent":
      return { words: "Not sent: email is not set up on the server", trouble: true };
    default:
      return { words: "Not tracked (before 30 Oct)", trouble: false };
  }
}

/**
 * Is this event really from the provider? Resend signs with Svix: HMAC-SHA256
 * over `id.timestamp.body`, keyed with the base64 part of a `whsec_` secret,
 * sent as space-separated `v1,<base64>` entries. Five minutes either way, so a
 * captured event cannot be replayed tomorrow. No secret means no way to check,
 * which is a refusal, never a pass.
 */
export function verifySignedEvent(input: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  nowSeconds: number;
}): boolean {
  const { secret, id, timestamp, signature, body, nowSeconds } = input;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64"));
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const offered = Buffer.from(sig);
    return offered.length === expected.length && timingSafeEqual(offered, expected);
  });
}
