"use client";
import { useState, useTransition } from "react";
import { setEventMoneyMode, setOrgMoneyMode } from "@/app/actions/money-setup";
import {
  MONEY_MODES,
  MONEY_MODE_LABEL,
  MONEY_MODE_HELP,
  resolveMoneyMode,
  type MoneyMode,
} from "@/lib/domain/money-mode";
import { orgProfile } from "@/lib/domain/org-profile";

/**
 * How this tournament handles money.
 *
 * Three modes and an explanation of each, because the difference between a
 * kitty and a split is not obvious from the names and choosing wrong is not
 * cheap: a float that should have been a split leaves nine people thinking
 * nobody owes anything, and a split that should have been a float tells a
 * player they owe the organizer money they paid at signup.
 *
 * The tournament's own setting is offered alongside "follow the club", so an
 * organizer can go back to the default rather than being stuck with a choice
 * made once for one weekend.
 */
export function MoneySetup({
  eventMode,
  orgMode,
  orgKind,
  clubName,
  isAdmin,
}: {
  eventMode: string;
  orgMode: string;
  orgKind: string;
  clubName: string;
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showClub, setShowClub] = useState(false);

  const inherited = resolveMoneyMode({ eventMode: "", orgMode, orgKind });
  const active = resolveMoneyMode({ eventMode, orgMode, orgKind });
  const profile = orgProfile(orgKind);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError("");
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
    });

  const option = (value: MoneyMode | "", label: string, help: string, checked: boolean) => (
    <label
      key={value || "inherit"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "9px 11px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${checked ? "var(--color-accent)" : "var(--color-divider)"}`,
        background: checked ? "color-mix(in srgb, var(--color-accent) 7%, transparent)" : "transparent",
        cursor: pending ? "default" : "pointer",
        marginBottom: 6,
      }}
    >
      <input
        type="radio"
        name="money-mode"
        checked={checked}
        disabled={pending}
        onChange={() => run(() => setEventMoneyMode(value))}
        style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 550 }}>{label}</span>
        <span className="text-muted" style={{ display: "block", fontSize: 12, lineHeight: 1.6 }}>
          {help}
        </span>
      </span>
    </label>
  );

  return (
    <section className="card elev-sm" style={{ marginTop: 16, gap: 10 }}>
      <span className="card-title" style={{ fontSize: 15 }}>Money in this tournament</span>
      <p className="text-muted" style={{ fontSize: 12.5, margin: "-2px 0 4px", lineHeight: 1.55 }}>
        TourneyHQ works money out and writes it down. It never moves it — there is no payment rail here,
        and a settlement line means somebody says a payment happened.
      </p>

      {option(
        "",
        `Follow ${clubName || "the club"} — currently ${MONEY_MODE_LABEL[inherited].toLowerCase()}`,
        orgMode
          ? `Whatever the club is set to — it has chosen ${MONEY_MODE_LABEL[inherited].toLowerCase()}.`
          : `Whatever the club is set to. A ${profile.label.toLowerCase()} defaults to ${MONEY_MODE_LABEL[inherited].toLowerCase()}.`,
        eventMode === "",
      )}

      {MONEY_MODES.map((m) => option(m, MONEY_MODE_LABEL[m], MONEY_MODE_HELP[m], eventMode === m))}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      {/* The club default, behind a disclosure. Most organizers set the
          tournament in front of them and never need this; the one who runs
          every event the same way needs it once. */}
      {isAdmin && (
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowClub((v) => !v)}
            style={{ alignSelf: "flex-start", fontSize: 12.5 }}
          >
            <i className={showClub ? "ph ph-caret-up" : "ph ph-caret-down"} /> Club default
          </button>
          {showClub && (
            <div style={{ paddingLeft: 4 }}>
              <p className="text-muted" style={{ fontSize: 12, margin: "0 0 7px", lineHeight: 1.6 }}>
                What every tournament at {clubName || "this club"} uses unless it says otherwise. Changing this
                does not touch a tournament that has made its own choice.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button
                  type="button"
                  className={`tag ${orgMode === "" ? "tag-accent" : "tag-neutral"}`}
                  disabled={pending}
                  onClick={() => run(() => setOrgMoneyMode(""))}
                  style={{ cursor: "pointer", border: "none" }}
                >
                  Follow what we are ({profile.label})
                </button>
                {MONEY_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`tag ${orgMode === m ? "tag-accent" : "tag-neutral"}`}
                    disabled={pending}
                    onClick={() => run(() => setOrgMoneyMode(m))}
                    style={{ cursor: "pointer", border: "none" }}
                  >
                    {MONEY_MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
        <i className="ph ph-info" /> In force for this tournament:{" "}
        <strong style={{ color: "var(--color-text)" }}>{MONEY_MODE_LABEL[active]}</strong>
      </p>
    </section>
  );
}
