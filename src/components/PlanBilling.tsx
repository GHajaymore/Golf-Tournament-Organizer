"use client";
import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { startCheckout, openBillingPortal } from "@/app/actions/billing";
import { Icon } from "./Icon";

/**
 * The buy and manage buttons on the plan panel.
 *
 * Every button sends the browser to a page STRIPE hosts — Checkout to start a
 * plan, the Billing Portal to change card, switch plan or cancel. Nothing here
 * takes a card. The club's plan changes only when Stripe's webhook says the
 * payment went through, so "Thanks" never claims the plan has already moved.
 */
export function PlanBilling({
  offers,
  hasSubscription,
  pastDue,
  canEdit,
  heldUntil,
}: {
  /** A paid plan ended: the date its tournaments are kept until, already formatted. */
  heldUntil?: string;
  /** What can be bought, already priced by the panel: one per plan and interval. */
  offers: { plan: string; interval: "month" | "year"; label: string }[];
  /** A live Stripe subscription — change it in the portal, not a second checkout. */
  hasSubscription: boolean;
  pastDue: boolean;
  canEdit: boolean;
}) {
  const params = useSearchParams();
  const outcome = params.get("billing");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  /** Which offer was pressed, so THAT button says it is opening — not all four. */
  const [chosen, setChosen] = useState("");

  const go = (fn: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>, which = "") => {
    setError("");
    setChosen(which);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) window.location.assign(res.url);
      else setError(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {outcome === "success" && (
        <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--color-accent-2-200)" }}>
          <Icon name="check-circle" /> Thanks — payment received. Your plan updates here as soon as Stripe confirms it, usually within a minute.
        </p>
      )}
      {outcome === "cancelled" && (
        <p role="status" className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>
          Checkout was cancelled. Nothing was charged.
        </p>
      )}
      {heldUntil && (
        <p role="status" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
          <Icon name="clock-countdown" /> Your paid plan has ended. Every tournament is kept until{" "}
          <strong>{heldUntil}</strong>; after that the free plan&rsquo;s terms apply. Choose a plan to keep everything.
        </p>
      )}
      {pastDue && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> The last payment didn&rsquo;t go through. Update the card in Manage billing — Stripe will try again.
        </p>
      )}

      {!canEdit ? (
        <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>Only a club owner or admin can change the plan.</p>
      ) : hasSubscription ? (
        <div>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => go(openBillingPortal, "portal")}>
            <Icon name="credit-card" /> {pending ? "Opening…" : "Manage billing"}
          </button>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 11.5 }}>
            Change plan, update the card, see invoices or cancel — on Stripe&rsquo;s secure page.
          </p>
        </div>
      ) : (
        offers.length > 0 && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {offers.map((o) => {
                const key = `${o.plan}-${o.interval}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={o.interval === "year" ? "btn btn-primary" : "btn btn-secondary"}
                    disabled={pending}
                    onClick={() => go(() => startCheckout(o.plan, o.interval), key)}
                  >
                    {pending && chosen === key ? "Opening checkout…" : o.label}
                  </button>
                );
              })}
            </div>
            {/* The same reassurance the paying club reads under Manage billing,
                said BEFORE the card is asked for, which is when it is wanted. */}
            <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 11.5, lineHeight: 1.5 }}>
              Paid on Stripe&rsquo;s secure page — TourneyHQ never sees the card. Renews until you cancel,
              which you can do any time from here.
            </p>
          </div>
        )
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--color-danger)" }}>{error}</p>
      )}
    </div>
  );
}
