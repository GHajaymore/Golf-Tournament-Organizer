"use client";
import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { startCheckout, openBillingPortal, checkDiscountCode } from "@/app/actions/billing";
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
  archive,
  unpaid = false,
  discountCode = "",
  discountNote,
}: {
  /** The code the club gave at sign-up, if any — offered here without retyping. */
  discountCode?: string;
  /** What the server found that code does now: what comes off, or why it can't be used. */
  discountNote?: { ok: boolean; text: string };
  /**
   * A paid plan LAPSED: its tournaments are a read-only archive until `until`
   * (`domain/club-archive.ts`). Both days already worded at the club's clock.
   */
  archive?: { lapsed: string; until: string; tournaments: number };
  /** Stripe gave up on the card, and the subscription is still there to be paid. */
  unpaid?: boolean;
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
  // The discount code: what is typed, and what the server last said about it.
  const [code, setCode] = useState(discountCode);
  const [codeNote, setCodeNote] = useState<{ ok: boolean; text: string } | null>(discountCode ? discountNote ?? null : null);
  const [checking, startChecking] = useTransition();
  const applyCode = () => {
    if (!code.trim()) {
      setCodeNote(null);
      return;
    }
    startChecking(async () => {
      const res = await checkDiscountCode(code);
      if (res.ok) {
        setCode(res.code);
        setCodeNote({ ok: true, text: res.said });
      } else setCodeNote({ ok: false, text: res.error });
    });
  };

  const go = (fn: () => Promise<{ ok: true; url: string } | { ok: false; error: string; about?: "discount" }>, which = "") => {
    setError("");
    setChosen(which);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) window.location.assign(res.url);
      // A refused CODE is said at the code box, once — not again under the buttons.
      else if (res.about === "discount") setCodeNote({ ok: false, text: res.error });
      else setError(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {outcome === "success" && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--color-accent-2-200)" }}>
          <Icon name="check-circle" /> Thanks — payment received. Your plan updates here as soon as Stripe confirms it, usually within a minute.
        </p>
      )}
      {outcome === "cancelled" && (
        <p role="status" className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          Checkout was cancelled. Nothing was charged.
        </p>
      )}
      {archive && (
        <p role="status" style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
          <Icon name="clock-countdown" /> This club&rsquo;s subscription ended on <strong>{archive.lapsed}</strong>.{" "}
          {archive.tournaments === 1 ? "Its tournament is" : `Its ${archive.tournaments} tournaments are`} kept read-only until{" "}
          <strong>{archive.until}</strong>, then deleted.{" "}
          {unpaid
            ? "Pay the outstanding invoice in Manage billing to carry on — everything picks up where it stopped."
            : "Choose a plan to carry on — everything picks up where it stopped."}{" "}
          A tournament you start now is on the free plan&rsquo;s terms.
        </p>
      )}
      {pastDue && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> The last payment didn&rsquo;t go through. Update the card in Manage billing — Stripe will try again.
        </p>
      )}

      {!canEdit ? (
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>Only a Commissioner or Admin can change the plan.</p>
      ) : hasSubscription ? (
        <div>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => go(openBillingPortal, "portal")}>
            <Icon name="credit-card" /> {pending ? "Opening…" : "Manage billing"}
          </button>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Change plan, update the card, see invoices or cancel — on Stripe&rsquo;s secure page.
          </p>
        </div>
      ) : (
        offers.length > 0 && (
          <div>
            {/* A code the owner handed out — said before the card is asked for,
                and judged again by the server when a button is pressed. It
                comes off the FIRST payment only (domain/discount.ts). */}
            <div style={{ marginBottom: 10 }}>
              <label htmlFor="plan-discount" style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                Discount code <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  id="plan-discount"
                  className="input"
                  style={{ flex: "1 1 160px", minWidth: 0, maxWidth: 240 }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeNote(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyCode();
                    }
                  }}
                  aria-describedby="plan-discount-note"
                />
                <button type="button" className="btn btn-secondary" disabled={checking || !code.trim()} onClick={applyCode}>
                  {checking ? "Checking…" : "Apply"}
                </button>
              </div>
              <p
                id="plan-discount-note"
                role={codeNote && !codeNote.ok ? "alert" : "status"}
                style={{
                  margin: codeNote ? "6px 0 0" : 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: codeNote ? (codeNote.ok ? "var(--color-accent-2-200)" : "var(--color-danger)") : undefined,
                }}
              >
                {codeNote ? (
                  <>
                    {codeNote.ok && <Icon name="check-circle" />} {codeNote.text}
                  </>
                ) : null}
              </p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {offers.map((o) => {
                const key = `${o.plan}-${o.interval}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={o.interval === "year" ? "btn btn-primary" : "btn btn-secondary"}
                    disabled={pending}
                    onClick={() => go(() => startCheckout(o.plan, o.interval, code), key)}
                  >
                    {pending && chosen === key ? "Opening checkout…" : o.label}
                  </button>
                );
              })}
            </div>
            {/* The same reassurance the paying club reads under Manage billing,
                said BEFORE the card is asked for, which is when it is wanted. */}
            <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
              Paid on Stripe&rsquo;s secure page — TourneyHQ never sees the card. Renews until you cancel,
              which you can do any time from here.
            </p>
          </div>
        )
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>{error}</p>
      )}
    </div>
  );
}
