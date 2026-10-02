import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";
import { POST } from "@/app/api/stripe/webhook/route";

/**
 * The webhook is the only way a club's plan changes after a payment, so the
 * door has to be shut to anyone but Stripe. These run the real route with the
 * real signature check — no network: the events used are ones the handler
 * acknowledges without asking Stripe anything.
 */

const SECRET = "whsec_zz_test_secret";
const env = { ...process.env };

function request(body: string, signature?: string) {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    body,
    headers: signature ? { "stripe-signature": signature } : {},
  });
}

const payload = JSON.stringify({ id: "evt_zz", object: "event", type: "charge.succeeded", data: { object: {} } });

describe("the Stripe webhook", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_zz_not_a_real_key";
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("refuses a request with no signature", async () => {
    expect((await POST(request(payload))).status).toBe(400);
  });

  it("refuses a forged signature", async () => {
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
    expect((await POST(request(payload, forged))).status).toBe(400);
  });

  it("refuses a body changed after signing", async () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const tampered = payload.replace("charge.succeeded", "customer.subscription.created");
    expect((await POST(request(tampered, header))).status).toBe(400);
  });

  it("CONTROL: accepts a genuinely signed event", async () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await POST(request(payload, header));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, outcome: "ignored" });
  });

  it("says billing is off when it is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await POST(request(payload, "t=1,v1=x"))).status).toBe(503);
  });
});
