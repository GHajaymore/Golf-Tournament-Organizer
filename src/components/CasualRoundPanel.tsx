"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStageHoles, setStageScoringBasis, updateSignup, removeSignup } from "@/app/actions/tournament";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";

export interface CasualPlayer {
  id: string;
  name: string;
  /** As typed and shown: "+2" for a plus handicap, never "-2". */
  handicap: string;
}

/**
 * Everything a casual round lets you change, on the round's own screen.
 *
 * The three things two people actually reconsider on the first tee: eighteen
 * or nine, shots or level, and whoever typed a name wrong. That is the whole
 * list — a quick round has no flights to draw, no field to approve, no cut and
 * no season.
 *
 * IT EXISTS TO KEEP THE TWO WORLDS APART. Until this, the only doors to those
 * three things were `/event`, `/registration` and `/stages` — the club's
 * settings, a registration desk with a waitlist and approvals, and a rounds
 * screen with cut lines, carry-forward and tiebreakers. A casual round is not
 * a small tournament, and walking somebody who opened the app to play their
 * mate through a tournament's filing cabinet is the thing this product is
 * supposed to be an alternative to.
 *
 * So those three screens are gone from a casual round's sidebar, and this is
 * what replaces them. Removing them without a replacement would have stranded
 * somebody exactly as a dead link does, which is the failure this session
 * spent the day removing elsewhere.
 *
 * The actions are the tournament's own — `setStageHoles`,
 * `setStageScoringBasis`, `updateSignup`, `removeSignup`. Reused deliberately:
 * they carry the authorization and the validation, and a second set written
 * for casual rounds would be a second place for those rules to be wrong. What
 * is separate is the SCREEN, not the engine, which is the same division the
 * setup form already makes.
 */
export function CasualRoundPanel({
  stageId,
  holes,
  scoringBasis,
  players,
  accessCode = "",
}: {
  stageId: string;
  holes: number;
  /** "gross" plays level; anything else gives shots. */
  scoringBasis: string;
  players: CasualPlayer[];
  /**
   * The round's code, so everybody can score their own card.
   *
   * Empty renders nothing — an older round created before codes were issued
   * with the round has none, and inventing one here would be a code the
   * database has never heard of.
   */
  accessCode?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      setError("");
      try {
        await fn();
        router.refresh();
      } catch {
        setError("Couldn't save that.");
      }
    });

  /**
   * Net or level, as one yes/no.
   *
   * The round's stored basis has four values and three of them mean "shots are
   * given". A casual round asks the question the way it gets asked on the tee
   * — "are we playing off handicaps?" — and leaves the other two to the
   * tournament screens that have a reason to distinguish them.
   */
  const net = scoringBasis !== "gross";

  const seg = (active: boolean): React.CSSProperties => ({
    padding: "8px 14px",
    minHeight: 44,
    borderRadius: 9,
    fontSize: 13.5,
    cursor: "pointer",
    border: active ? "1px solid var(--color-accent)" : "1px solid var(--color-divider)",
    background: active ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "transparent",
    color: "var(--color-text)",
  });

  return (
    <div className="card elev-sm" style={{ gap: 14, marginBottom: 16 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>This round</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "3px 0 0", lineHeight: 1.5 }}>
          Change any of it while you play — nothing here is locked.
        </p>
      </div>

      {error && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        <div>
          <div className="card-kicker">Holes</div>
          <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
            {[18, 9].map((n) => (
              <button
                key={n}
                type="button"
                style={seg(holes === n)}
                aria-pressed={holes === n}
                disabled={pending}
                onClick={() => run(() => setStageHoles(stageId, n))}
              >
                {n} holes
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="card-kicker">Shots</div>
          <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
            <button
              type="button"
              style={seg(!net)}
              aria-pressed={!net}
              disabled={pending}
              onClick={() => run(() => setStageScoringBasis(stageId, "gross"))}
            >
              Level
            </button>
            <button
              type="button"
              style={seg(net)}
              aria-pressed={net}
              disabled={pending}
              onClick={() => run(() => setStageScoringBasis(stageId, "net"))}
            >
              Off handicaps
            </button>
          </div>
        </div>
      </div>

      <div>
        <div className="card-kicker">Playing</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {players.map((p) => (
            <div
              key={p.id}
              style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
            >
              <span style={{ flex: 1, minWidth: 120, fontSize: 13.5 }}>{p.name}</span>
              {/* The handicap, editable in place. A wrong index is the
                  commonest way a net round is scored wrong, and it is wrong
                  invisibly — the card looks right and the shots are in the
                  wrong holes. */}
              <input
                className="input"
                style={{ width: 82, minHeight: 44 }}
                inputMode="text"
                aria-label={`${p.name}'s handicap`}
                value={edits[p.id] ?? p.handicap}
                disabled={pending}
                onChange={(e) => setEdits((m) => ({ ...m, [p.id]: e.target.value }))}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === p.handicap) return;
                  // "+2" is a plus handicap and is stored negative. Anything
                  // unreadable is left alone rather than written as nought.
                  const n = raw.startsWith("+")
                    ? -Number(raw.slice(1))
                    : Number(raw);
                  if (!Number.isFinite(n)) {
                    setEdits((m) => ({ ...m, [p.id]: p.handicap }));
                    return;
                  }
                  run(() => updateSignup(p.id, { handicap: n }));
                }}
              />
              {/* Two people is the smallest round there is, so the last two
                  cannot be removed — there would be no round left. */}
              {players.length > 2 && (
                <ConfirmButton
                  icon="x"
                  title={`Take ${p.name} out of this round`}
                  confirmLabel="Take them out"
                  note="Anything they have scored goes with them."
                  disabled={pending}
                  onConfirm={() => run(() => removeSignup(p.id))}
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.5 }}>
          Handicaps save when you tap away. A plus handicap is written &ldquo;+2&rdquo;.
        </p>
      </div>

      {/* THE ROUND CODE, so this is not one phone doing four cards.
          Until it was issued with the round, the only way to a card was an
          account — and a guest is by definition somebody without one. The
          code opens the play shell as a player of this round and nothing
          else; it is exactly as strong as handing somebody your phone, which
          is what it replaces. It goes when the round does, a day later. */}
      {accessCode && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
          <div className="card-kicker">Everyone scores their own card</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 6,
            }}
          >
            <code
              style={{
                fontSize: 21,
                fontWeight: 700,
                letterSpacing: "0.14em",
                fontFamily: "var(--font-heading)",
                padding: "6px 12px",
                borderRadius: 9,
                background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              }}
            >
              {accessCode}
            </code>
            <span className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.5, minWidth: 0 }}>
              Read it out to the others. They open the app, tap{" "}
              <b>Playing today?</b> and put it in — no account needed, and they pick
              their own name from the list.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
