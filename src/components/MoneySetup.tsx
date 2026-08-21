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
 * How money is handled — for ONE TOURNAMENT, or for the whole club.
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
 *
 * TWO MODES, and the reason is a defect this component used to carry. The club
 * default was a DISCLOSURE inside the tournament card, on Prizes & payouts —
 * so the setting an entire club runs on was collapsed inside a card titled
 * "Money in this tournament", on a per-tournament screen. Meanwhile
 * `SETUP_HREF.money` sent "Decide how money works" to `/organization`, which
 * had no money control at all: an organizer who followed the checklist arrived
 * at Club settings and found nothing, and the step — which reads
 * `organization.moneyMode` — could never be ticked by following its own link.
 *
 * So each level now lives on the screen named for it, the way `PlaySettings`
 * already splits tournament settings from house defaults. Prizes & payouts
 * keeps the tournament's own choice and says where the club default is.
 */
export function MoneySetup({
  mode,
  eventMode = "",
  orgMode,
  orgKind,
  clubName,
  canEdit = true,
}: {
  /** Which level this instance sets. */
  mode: "tournament" | "organization";
  /** Tournament mode only — this tournament's own choice, "" to follow the club. */
  eventMode?: string;
  orgMode: string;
  orgKind: string;
  clubName: string;
  /** Organization mode only — whether this person may change the club default. */
  canEdit?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const isTournament = mode === "tournament";

  const inherited = resolveMoneyMode({ eventMode: "", orgMode, orgKind });
  const active = resolveMoneyMode({ eventMode, orgMode, orgKind });
  const profile = orgProfile(orgKind);
  const locked = !isTournament && !canEdit;

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
        cursor: pending || locked ? "default" : "pointer",
        marginBottom: 6,
      }}
    >
      <input
        type="radio"
        name={`money-mode-${mode}`}
        checked={checked}
        disabled={pending || locked}
        onChange={() =>
          run(() => (isTournament ? setEventMoneyMode(value) : setOrgMoneyMode(value)))
        }
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

  // The club default, on Club settings, where the setup checklist has always
  // said it is. Same three modes plus "follow what we are", which is the kind's
  // own default and the only honest way back to unset.
  if (!isTournament) {
    return (
      <section className="card elev-sm" style={{ gap: 10 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Money at {clubName || "this club"}</span>
        <p className="text-muted" style={{ fontSize: 12.5, margin: "-2px 0 4px", lineHeight: 1.55 }}>
          What every tournament here uses unless it says otherwise. Changing it does not touch a
          tournament that has already made its own choice.
        </p>

        {option(
          "",
          `Follow what we are — a ${profile.noun} means ${MONEY_MODE_LABEL[resolveMoneyMode({ eventMode: "", orgMode: "", orgKind })].toLowerCase()}`,
          "No club-wide answer. Each tournament falls back to what suits this kind of organization.",
          orgMode === "",
        )}

        {MONEY_MODES.map((m) => option(m, MONEY_MODE_LABEL[m], MONEY_MODE_HELP[m], orgMode === m))}

        {error && (
          <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
            <i className="ph ph-warning-circle" /> {error}
          </p>
        )}

        {locked && (
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            Only an organization owner or admin can change this.
          </p>
        )}

        <p className="text-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
          {/* Says what it actually does rather than leaving the reader to
              work out what "the default" resolves to. */}
          <i className="ph ph-info" /> A tournament that has not chosen for itself uses:{" "}
          <strong style={{ color: "var(--color-text)" }}>{MONEY_MODE_LABEL[inherited]}</strong>.
          {" "}Each one can still be set on its own Prizes &amp; payouts screen.
        </p>
      </section>
    );
  }

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

      {/* Where the club default is, rather than a copy of it collapsed inside
          a card about one tournament. It used to be a disclosure here, which
          put a club-wide setting two clicks deep on a per-tournament screen —
          and left Club settings, where the setup checklist sends people to
          "Decide how money works", with no money control on it at all. */}
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
        <i className="ph ph-buildings" /> The default for every tournament at{" "}
        {clubName || "this club"} is on <a href="/organization">Club settings</a>.
      </p>

      <p className="text-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
        <i className="ph ph-info" /> In force for this tournament:{" "}
        <strong style={{ color: "var(--color-text)" }}>{MONEY_MODE_LABEL[active]}</strong>
      </p>
    </section>
  );
}
