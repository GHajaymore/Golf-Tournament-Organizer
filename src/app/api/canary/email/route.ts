import { NextResponse } from "next/server";
import { emailLastEvent, sendCanaryEmail } from "@/lib/email";

/**
 * CAN PRODUCTION SEND EMAIL? — the hourly canary's question (2026-10-30).
 *
 * The early list sent nothing for days and nothing noticed. This sends ONE
 * message from production's own sender to the provider's test mailbox
 * (`delivered@resend.dev`) and asks the provider, for up to twenty seconds,
 * whether it was delivered. Never to tourneyhq.club: its forwarder has an
 * allowance (Ajay, 28 Oct). It writes nothing to the database.
 *
 * Sending costs one message of the provider's daily allowance, so it is not
 * for the open internet: CRON_SECRET as a bearer token, refused when missing,
 * exactly as the cron routes are.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || (request.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const sent = await sendCanaryEmail();
  if (!sent.id) return NextResponse.json({ ok: false, step: "send", error: sent.error }, { status: 502 });

  let last = "";
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    last = await emailLastEvent(sent.id);
    if (last && last !== "queued" && last !== "sent" && last !== "scheduled") break;
  }
  const delivered = last === "delivered";
  return NextResponse.json({ ok: delivered, step: "deliver", id: sent.id, lastEvent: last || "unknown" }, { status: delivered ? 200 : 502 });
}
