import { createHmac, timingSafeEqual } from "node:crypto";
import { handleInboundSms } from "@/lib/services/messaging";

/**
 * Twilio's inbound webhook: where STOP actually arrives.
 *
 * This is an unauthenticated public URL — the carrier has no session — which
 * makes it the most exposed endpoint in the app. Anyone who finds it could
 * otherwise post `From=<a member's number>&Body=STOP` and unsubscribe them, or
 * post nonsense until the roster scan is the only thing the database is doing.
 *
 * So the signature is the credential, and it is checked before anything is
 * read. Twilio signs the exact URL plus every POST parameter sorted by name,
 * HMAC-SHA1 with the account's auth token — which only Twilio and this server
 * know.
 *
 * Honouring STOP is not optional and not something to answer with a
 * confirmation question, so this route stays working even when the rest of
 * messaging is switched off.
 */

export const dynamic = "force-dynamic";

/** Twilio's scheme: the full URL, then each parameter name and value
 *  concatenated in sorted order, HMAC-SHA1 with the auth token, base64. */
function expectedSignature(url: string, params: Record<string, string>, token: string): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

function signatureOk(url: string, params: Record<string, string>, header: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  // No token configured means no way to verify, and an unverifiable webhook is
  // an open endpoint. Refuse rather than fall open.
  if (!token || !header) return false;
  const expected = expectedSignature(url, params, token);
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and the length is not a secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** TwiML, which is what Twilio expects back. Empty body = say nothing. */
function twiml(message: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { headers: { "Content-Type": "text/xml" } });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  // The URL Twilio signed. Behind a proxy the request's own URL may not match
  // what the carrier saw, so an explicit override is available — and when it
  // is set it is the only thing trusted, since headers are attacker-supplied.
  const url = process.env.TWILIO_INBOUND_URL || req.url;
  const signature = req.headers.get("x-twilio-signature") ?? "";

  if (!signatureOk(url, params, signature)) {
    // 403 with no detail. Which part failed is not something an unauthenticated
    // caller gets to learn.
    return new Response("Forbidden", { status: 403 });
  }

  const reply = await handleInboundSms(params.From ?? "", params.Body ?? "");
  return twiml(reply);
}
