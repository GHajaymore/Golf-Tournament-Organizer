"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSkinsPot, setSkinsEntrants, removeSkinsPot } from "@/app/actions/skins";
import FieldInfo from "@/components/FieldInfo";
import { SCOPE_LABEL, type SkinsScope } from "@/lib/domain/skins-pot";

/**
 * The skins pot on one week of a league.
 *
 * Two jobs, in the order they happen: staff record who paid in, then the
 * screen shows what that produced. The second half shows its working — pot,
 * carry, every hole, every payout — because a payout figure with no arithmetic
 * behind it is exactly what a club will not trust.
 *
 * TourneyHQ works this out and writes it down. It never moves the money.
 */

export interface SkinsRound {
  stageId: string;
  label: string;
}

export interface SkinsHole {
  hole: number;
  playerId: string | null;
  value: number;
  carried: boolean;
}

export interface SkinsShare {
  playerId: string;
  skins: number;
  wonCents: number;
  stakeCents: number;
  netCents: number;
}

export interface SkinsView {
  buyInCents: number;
  net: boolean;
  scope: SkinsScope;
  entrantIds: string[];
  field: Array<{ id: string; name: string; playing: boolean }>;
  result: {
    potCents: number;
    claimedSkins: number;
    unclaimedSkins: number;
    carryCents: number;
    provisional: boolean;
    shares: SkinsShare[];
  } | null;
  transfers: Array<{ fromPlayerId: string; toPlayerId: string; cents: number }>;
  nameById: Record<string, string>;
  holes: SkinsHole[];
}

/** Cents to a plain amount. No currency symbol: clubs are not all in one country. */
const money = (cents: number) => (cents / 100).toFixed(2);

export function SkinsPotClient({
  rounds,
  activeStageId,
  view,
  groupKey = "",
  groupLabel = "",
}: {
  rounds: SkinsRound[];
  activeStageId: string;
  view: SkinsView;
  /**
   * Whose pot this card is. Empty is the FIELD's, which is what every existing
   * caller renders and what this component has always shown.
   *
   * Passed straight through to all three writes rather than defaulted at the
   * action: a card that DISPLAYS one group's pot and SAVES to another's is
   * precisely the overwrite the group key exists to prevent, and it would look
   * correct on screen the whole time.
   */
  groupKey?: string;
  /** What to call it, when it is a group's rather than the field's. */
  groupLabel?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [buyIn, setBuyIn] = useState((view.buyInCents / 100).toString());
  const [scope, setScope] = useState<SkinsScope>(view.scope);
  const [picking, setPicking] = useState(false);
  // Prefilled from who has returned a card, so it is a tick-through rather
  // than twenty names typed out — but nothing counts until staff save it.
  const [chosen, setChosen] = useState<string[]>(() =>
    view.entrantIds.length > 0 ? view.entrantIds : view.field.filter((f) => f.playing).map((f) => f.id),
  );

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const saveSetup = () =>
    run(() =>
      saveSkinsPot(activeStageId, {
        buyInCents: Math.round(parseFloat(buyIn || "0") * 100),
        net: view.net,
        scope,
        groupKey,
      }),
    );

  const name = (id: string) => view.nameById[id] ?? "—";
  const r = view.result;

  return (
    <div className="card elev-sm" style={{ gap: 14, marginTop: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span className="card-title" style={{ fontSize: 15 }}>
          {/* The group's name leads when there is one, because on a page of
              several pots "Skins — net" four times over names nothing. */}
          {groupLabel ? `${groupLabel} — ` : ""}Skins &mdash; {view.net ? "net" : "gross"}
        </span>
        <FieldInfo label="the skins pot">
          <p>
            Every hole is a prize, won only outright. Tie a hole and nobody takes it — its value
            rolls into the next one, which is why a skins game can be decided on the last hole by
            someone who has won nothing all day.
          </p>
          <p>
            TourneyHQ works out who is owed what and writes it down. It does not take or move any
            money.
          </p>
        </FieldInfo>
        {rounds.length > 1 && (
          <select
            className="input"
            style={{ marginLeft: "auto", maxWidth: 260 }}
            value={activeStageId}
            onChange={(e) => router.push(`/prizes?round=${e.target.value}`)}
          >
            {rounds.map((x) => (
              <option key={x.stageId} value={x.stageId}>{x.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Setup ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ width: 120 }}>
          <label>Buy-in</label>
          <input className="input" inputMode="decimal" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} />
        </div>
        <div className="field" style={{ width: 150 }}>
          <label>Holes</label>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as SkinsScope)}>
            {(["full", "front", "back"] as const).map((s) => (
              <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={saveSetup}>
          Save
        </button>
      </div>

      {/* ── Who paid in ───────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="card-kicker">
            In the pot — {view.entrantIds.length} {view.entrantIds.length === 1 ? "player" : "players"}
          </span>
          <FieldInfo label="who is in the pot">
            <p>
              Entered by whoever collected the money, not taken from who is playing. Plenty of
              players play the round and stay out of the skins, and entering someone who never paid
              would make the settlement wrong.
            </p>
            <p>The list starts from whoever has returned a card — untick anyone who is out.</p>
          </FieldInfo>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "2px 10px", fontSize: 12, marginLeft: "auto" }}
            onClick={() => setPicking((o) => !o)}
          >
            {picking ? "Cancel" : "Change"}
          </button>
        </div>

        {!picking && view.entrantIds.length > 0 && (
          <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            {view.entrantIds.map(name).join(", ")}
          </p>
        )}
        {!picking && view.entrantIds.length === 0 && (
          <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            Nobody yet. Add whoever put money in.
          </p>
        )}

        {picking && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "grid", gap: 4, gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
              {view.field.map((f) => (
                <label key={f.id} className="radio" style={{ fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(f.id)}
                    onChange={(e) =>
                      setChosen((prev) => (e.target.checked ? [...prev, f.id] : prev.filter((x) => x !== f.id)))
                    }
                  />
                  <span className="dot" />
                  {f.name}
                  {!f.playing && <span className="text-muted" style={{ fontSize: 10.5 }}> (no card)</span>}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => {
                  // view.scope, not a default: these entrants belong to THIS
                  // game, and a league night has four on the same round.
                  run(() => setSkinsEntrants(activeStageId, view.net, view.scope, chosen, groupKey));
                  setPicking(false);
                }}
              >
                Save who paid in
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending}
                onClick={() => setChosen(view.field.filter((f) => f.playing).map((f) => f.id))}
              >
                Everyone with a card
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── The money ─────────────────────────────────────────────────── */}
      {r && r.potCents > 0 && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
          <span className="card-kicker">The pot</span>
          {/* The arithmetic, in full. A payout with no working shown is the
              thing a club checks against cash in a hand and distrusts. */}
          <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 10px", lineHeight: 1.6 }}>
            {view.entrantIds.length} × {money(view.buyInCents)}
            ={" "}
            <b style={{ color: "var(--color-text)" }}>{money(r.potCents)}</b> over{" "}
            {r.claimedSkins + r.unclaimedSkins} skins
            {r.unclaimedSkins > 0 ? `, ${r.unclaimedSkins} of them unclaimed` : ""}.
          </p>

          {r.provisional && (
            <p style={{ fontSize: 12, margin: "0 0 10px", color: "var(--color-accent)" }}>
              <i className="ph ph-warning-circle" /> Provisional — some holes have no score yet.
            </p>
          )}

          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Player</th>
                  <th style={{ textAlign: "center" }}>Skins</th>
                  <th style={{ textAlign: "right" }}>Won</th>
                  <th style={{ textAlign: "right" }}>In</th>
                  <th style={{ textAlign: "right" }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {[...r.shares]
                  .sort((a, b) => b.netCents - a.netCents || name(a.playerId).localeCompare(name(b.playerId)))
                  .map((s) => (
                    <tr key={s.playerId}>
                      <td>{name(s.playerId)}</td>
                      <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{s.skins}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(s.wonCents)}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(s.stakeCents)}</td>
                      <td
                        style={{
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 500,
                          color: s.netCents < 0 ? "var(--color-danger)" : "var(--color-accent-2)",
                        }}
                      >
                        {s.netCents > 0 ? "+" : ""}{money(s.netCents)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {r.carryCents > 0 && (
            <p className="text-muted" style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.5 }}>
              <b style={{ color: "var(--color-text)" }}>{money(r.carryCents)}</b> unclaimed
              {r.claimedSkins === 0 ? " — no hole was won outright" : ""}. Carry it into next week by
              entering it as the carry there.
            </p>
          )}
        </div>
      )}

      {/* ── Settling up ───────────────────────────────────────────────── */}
      {view.transfers.length > 0 && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="card-kicker">Settling up</span>
            <FieldInfo label="settling up">
              <p>
                The shortest set of payments that squares everybody, rather than every player paying
                every other. TourneyHQ does not handle the money — this is the list to settle by
                whatever means the club already uses.
              </p>
            </FieldInfo>
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8 }}>
            {view.transfers.map((t, i) => (
              <li key={i}>
                {name(t.fromPlayerId)} pays {name(t.toPlayerId)}{" "}
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(t.cents)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      {view.entrantIds.length > 0 && (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ alignSelf: "flex-start", fontSize: 12 }}
          disabled={pending}
          onClick={() =>
            // view.scope, not the picker's `scope`: this removes the pot being
            // SHOWN, and the picker may have been moved without saving.
            run(() => removeSkinsPot(activeStageId, view.net, view.scope, groupKey))
          }
        >
          Remove this pot
        </button>
      )}
    </div>
  );
}
