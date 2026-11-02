import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { nextDeliveryStatus, verifySignedEvent } from "@/lib/domain/email-delivery";

/**
 * THE EMAIL PROVIDER'S DELIVERY EVENTS (2026-10-30).
 *
 * Resend posts here when a message it accepted is delivered, delayed, bounced,
 * suppressed or marked as spam. Only the copies of notes of interest are
 * tracked: the event's message id is looked up on `InterestRequest.notifyId`,
 * and an id we never sent moves nothing.
 *
 * An unauthenticated public URL, so the signature is the credential and is
 * checked before the body is read as anything (`verifySignedEvent`). With no
 * RESEND_WEBHOOK_SECRET configured every event is refused — an unverifiable
 * webhook is an open endpoint for marking mail delivered.
 *
 * Answers 200 to a genuine event it does not track, so the provider does not
 * retry it for days.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  const ok = verifySignedEvent({
    secret: process.env.RESEND_WEBHOOK_SECRET ?? "",
    id: req.headers.get("svix-id") ?? "",
    timestamp: req.headers.get("svix-timestamp") ?? "",
    signature: req.headers.get("svix-signature") ?? "",
    body,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });

  let event: { type?: unknown; data?: { email_id?: unknown; bounce?: { message?: unknown } } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const type = typeof event.type === "string" ? event.type : "";
  const id = typeof event.data?.email_id === "string" ? event.data.email_id : "";
  if (!type || !id) return NextResponse.json({ ok: true });

  const row = await prisma.interestRequest.findFirst({ where: { notifyId: id }, select: { id: true, notifyStatus: true } });
  if (!row) return NextResponse.json({ ok: true });
  const next = nextDeliveryStatus(row.notifyStatus, type);
  if (!next) return NextResponse.json({ ok: true });

  const why = typeof event.data?.bounce?.message === "string" ? event.data.bounce.message.slice(0, 500) : "";
  await prisma.interestRequest.update({
    where: { id: row.id },
    data: { notifyStatus: next, notifyAt: new Date(), ...(why ? { notifyDetail: why } : {}) },
  });
  return NextResponse.json({ ok: true });
}
