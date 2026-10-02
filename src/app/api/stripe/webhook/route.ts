import { NextResponse } from "next/server";
import { applySubscriptionWrite, handleStripeEvent, stripeClient } from "@/lib/services/billing";
import type { StripeSubscriptionLike } from "@/lib/domain/billing";

/**
 * Stripe's webhook: the only way a club's plan changes after a payment.
 *
 * The signature is checked against `STRIPE_WEBHOOK_SECRET` on the RAW body —
 * an unsigned or tampered request is refused before anything is read from it,
 * so nobody can post a fake "subscription created" and give themselves a plan.
 * What the event means is decided in `handleStripeEvent`, which re-reads the
 * subscription from Stripe rather than trusting the payload.
 */
export async function POST(req: Request): Promise<Response> {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const body = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(event as unknown as { type: string; data: { object: Record<string, unknown> } }, {
      retrieveSubscription: async (id) => (await stripe.subscriptions.retrieve(id)) as unknown as StripeSubscriptionLike,
      apply: (write) => applySubscriptionWrite(write),
    });
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    // A 500 makes Stripe retry, which is what a transient database error wants.
    console.error("stripe webhook failed", event.type, err);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
