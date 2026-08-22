"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmChampion, removeFromHonours } from "@/app/actions/roster";
import { CHAMPION_REFUSAL, type HonoursEntry } from "@/lib/domain/honours";
import type { PendingChampion } from "@/lib/services/honours";

/**
 * The club's board — names going back as far as the club has records.
 *
 * The confirmed half is a plain list and never a computation. What the app
 * thinks the standings say lives in a separate section below it, headed as a
 * proposal, so nobody ever reads a fresh calculation as a result.
 *
 * A tie is where this earns its keep. The app refuses to break one, so the
 * committee is shown who finished level and picks — which is the honest shape,
 * because a play-off or a countback chosen on the day is not in the data.
 */
export function HonoursBoard({
  board,
  pending,
  canEdit,
}: {
  board: Array<{ year: number; entries: Array<HonoursEntry & { id: string; note: string }> }>;
  pending: PendingChampion[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const confirm = (eventId: string, playerId?: string) => {
    setError("");
    startTransition(async () => {
      const res = await confirmChampion(eventId, playerId);
      if (!res.ok) {
        setError(res.error ?? "Couldn't put that name on the board.");
        return;
      }
      setPickFor(null);
      router.refresh();
    });
  };

  const remove = (entryId: string) => {
    setError("");
    startTransition(async () => {
      const res = await removeFromHonours(entryId);
      if (!res.ok) setError(res.error ?? "Couldn't remove that entry.");
      else router.refresh();
    });
  };

  return (
    <div className="card elev-sm" style={{ marginTop: 16, gap: 10 }}>
      <span className="card-title">Honours board</span>
      <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
        Every champion this club has confirmed. Once a name is here it stays as it was recorded —
        it doesn&rsquo;t move when a member leaves the roster, a tournament is renamed, or the way a
        round is scored is corrected later.
      </p>

      {board.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>
          Nothing on the board yet. Finished tournaments appear below to be confirmed.
        </p>
      ) : (
        board.map((group) => (
          <div key={group.year} style={{ marginTop: 4 }}>
            <div className="card-kicker">{group.year === 0 ? "Undated" : group.year}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {group.entries.map((e) => (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    padding: "5px 0",
                    borderBottom: "1px solid var(--color-divider)",
                  }}
                >
                  <span style={{ minWidth: 0, fontSize: 13.5 }}>
                    <b>{e.championName}</b>
                    <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      {e.eventName}
                      {e.dates && ` · ${e.dates}`}
                    </span>
                    {e.note && (
                      <span className="text-muted" style={{ display: "block", fontSize: 11.5 }}>
                        {e.note}
                      </span>
                    )}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Says who, which is the question a board gets asked. */}
                    {e.confirmedBy && (
                      <span className="text-muted" style={{ fontSize: 11 }}>
                        confirmed by {e.confirmedBy}
                      </span>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-icon"
                        aria-label={`Take ${e.championName} off the board for ${e.eventName}`}
                        disabled={busy}
                        onClick={() => remove(e.id)}
                      >
                        <i className="ph ph-x" />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {canEdit && pending.length > 0 && (
        <>
          {/* Kept visibly apart from the board above. This is what the app
              thinks, not what the club has decided, and the two must never
              read as the same kind of thing. */}
          <div className="card-kicker" style={{ marginTop: 10 }}>
            Finished, not yet on the board
          </div>
          {pending.map((p) => (
            <div
              key={p.eventId}
              style={{
                padding: "7px 10px",
                border: "1px solid var(--color-divider)",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 13 }}>
                {p.eventName}
                <span className="text-muted" style={{ marginLeft: 6, fontSize: 11.5 }}>
                  {p.dates || (p.year ? String(p.year) : "no dates")}
                </span>
              </span>

              {p.suggestion.ok ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    Standings say <b>{p.suggestion.name}</b>
                    {p.suggestion.runnersUp.length > 0 &&
                      `, then ${p.suggestion.runnersUp.map((r) => r.name).join(" and ")}`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12 }}
                    disabled={busy}
                    onClick={() => confirm(p.eventId)}
                  >
                    <i className="ph ph-seal-check" /> Put on the board
                  </button>
                </div>
              ) : p.suggestion.reason === "tied" ? (
                <>
                  <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                    {CHAMPION_REFUSAL.tied}
                  </p>
                  {pickFor === p.eventId ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {p.suggestion.tied.map((t) => (
                        <button
                          key={t.playerId}
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: 12 }}
                          disabled={busy}
                          onClick={() => confirm(p.eventId, t.playerId)}
                        >
                          {t.name} won
                        </button>
                      ))}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => setPickFor(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 12, alignSelf: "flex-start" }}
                      onClick={() => setPickFor(p.eventId)}
                    >
                      <i className="ph ph-scales" /> Decide between{" "}
                      {p.suggestion.tied.map((t) => t.name).join(" and ")}
                    </button>
                  )}
                </>
              ) : (
                <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                  {CHAMPION_REFUSAL[p.suggestion.reason]}
                </p>
              )}
            </div>
          ))}
        </>
      )}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
