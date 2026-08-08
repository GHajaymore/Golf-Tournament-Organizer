"use client";
import { useState, useTransition } from "react";
import { movePlayerToGroup, renameGroup, setFlightsConfirmed } from "@/app/actions/tournament";

export interface FlightPlayer {
  id: string;
  name: string;
  handicap: number;
}

export interface FlightCard {
  id: string;
  label: string;
  avg: number;
  players: FlightPlayer[];
}

/**
 * The current flights, with players draggable between them.
 *
 * Only rendered for the manual formation rule. The other rules compute the
 * whole allocation from a policy — dragging one player out of a seeded flight
 * would leave a "seeded" grouping that isn't, and the next regenerate would
 * silently undo it. Manual is the one rule where the organizer's hand is the
 * policy, so it is the one place this belongs.
 *
 * Dragging is not the only way in. A keyboard user gets a select on each row,
 * because drag-and-drop with no alternative is a feature that excludes people
 * — and on a phone, where a lot of this actually gets done, HTML5 drag events
 * don't fire at all.
 */
export function FlightBoard({
  cards,
  locked,
  canEdit,
  confirmed,
}: {
  cards: FlightCard[];
  locked: boolean;
  canEdit: boolean;
  /** Whether the organizer has signed the draw off. */
  confirmed: boolean;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<{ playerId: string; groupId: string; scored: number } | null>(null);
  const [pending, startTransition] = useTransition();

  // A confirmed draw is finished work. It stays visible and stays reopenable,
  // but it is no longer one stray drag from being different.
  const disabled = locked || !canEdit || pending || confirmed;

  const move = (playerId: string, groupId: string, force = false) => {
    setError("");
    setConfirming(null);
    startTransition(async () => {
      const res = await movePlayerToGroup(playerId, groupId, force);
      if (res.needsConfirm) {
        setConfirming({ playerId, groupId, scored: res.scoredMatches ?? 0 });
        return;
      }
      if (!res.ok) setError(res.error ?? "Couldn't move that player.");
    });
  };

  const drop = (groupId: string) => {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id || disabled) return;
    move(id, groupId);
  };

  return (
    <>
      {error && (
        <p style={{ fontSize: 13, margin: "0 0 10px", color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      {confirming && (
        <div
          className="card elev-sm"
          style={{
            marginBottom: 10,
            gap: 8,
            background: "var(--color-danger-bg)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-danger) 32%, transparent)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-danger)" }}>
            {confirming.scored} {confirming.scored === 1 ? "match has" : "matches have"} already been scored
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            Flights decide who plays whom. Moving a player now doesn&apos;t erase those results, but it
            does change the field they were played in — you may need to regenerate the schedule
            afterwards.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 12 }}
              onClick={() => move(confirming.playerId, confirming.groupId, true)}
            >
              Move anyway
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sign-off. Confirming is what turns a draw being fiddled with into a
          draw that is done; reopening is deliberately one click, because a
          lock an organizer can't undo is one they'll route around by
          regenerating — which loses the hand-built draw entirely. */}
      {canEdit && !locked && cards.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 10,
            padding: "9px 12px",
            borderRadius: "var(--radius-md)",
            background: confirmed
              ? "color-mix(in srgb, var(--color-accent-2) 12%, transparent)"
              : "color-mix(in srgb, var(--color-text) 4%, transparent)",
            boxShadow: confirmed
              ? "inset 0 0 0 1px color-mix(in srgb, var(--color-accent-2) 32%, transparent)"
              : "inset 0 0 0 1px color-mix(in srgb, var(--color-text) 10%, transparent)",
          }}
        >
          <i
            className={confirmed ? "ph ph-seal-check" : "ph ph-hand-grabbing"}
            style={{ fontSize: 15, color: confirmed ? "var(--color-accent-2-400)" : "var(--color-accent-400)" }}
          />
          <span style={{ fontSize: 12.5, flex: 1, minWidth: 180, lineHeight: 1.45 }}>
            {confirmed
              ? "Draw confirmed. Reopen it to move anyone."
              : cards.length > 1
                ? "Drag a player onto another flight, or use the menu on their row."
                : "Add another flight to move players between them."}
          </span>
          <button
            type="button"
            className={confirmed ? "btn btn-secondary" : "btn btn-primary"}
            disabled={pending}
            onClick={() => {
              setError("");
              startTransition(async () => {
                const res = await setFlightsConfirmed(!confirmed);
                if (!res.ok) setError(res.error ?? "Couldn't update the draw.");
              });
            }}
          >
            <i className={confirmed ? "ph ph-pencil-simple" : "ph ph-check"} />
            {confirmed ? "Edit flights" : "Confirm flights"}
          </button>
        </div>
      )}

      <div className="flight-board" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {cards.map((g) => (
          <div
            key={g.id}
            className="card elev-sm"
            onDragOver={(e) => {
              if (disabled || !dragging) return;
              // Without preventDefault the browser refuses the drop outright.
              e.preventDefault();
              setOver(g.id);
            }}
            onDragLeave={() => setOver((o) => (o === g.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              drop(g.id);
            }}
            style={{
              gap: 6,
              minHeight: 90,
              transition: "box-shadow 120ms var(--ease), background 120ms var(--ease)",
              ...(over === g.id && dragging
                ? {
                    background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                    boxShadow: "inset 0 0 0 2px var(--color-accent)",
                  }
                : null),
            }}
          >
            {/* Clubs don't call them "Flight 1". They run an A Flight and a B
                Flight, a Championship and a Handicap division, or name them
                after the four courses a society is playing. The name column
                existed from the start; the screen just never showed it. */}
            {renaming === g.id ? (
              <input
                className="input"
                autoFocus
                value={draftName}
                maxLength={40}
                disabled={pending}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => setRenaming(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setRenaming(null);
                  if (e.key !== "Enter") return;
                  const name = draftName;
                  setRenaming(null);
                  setError("");
                  startTransition(async () => {
                    const res = await renameGroup(g.id, name);
                    if (!res.ok) setError(res.error ?? "Couldn't rename that flight.");
                  });
                }}
                style={{ minHeight: 26, fontSize: 13, fontWeight: 600 }}
                aria-label={`Rename ${g.label}`}
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.label}
                </span>
                {canEdit && !locked && (
                  <button
                    type="button"
                    className="btn btn-icon"
                    title={`Rename ${g.label}`}
                    aria-label={`Rename ${g.label}`}
                    style={{ width: 22, height: 22, flex: "none" }}
                    onClick={() => { setDraftName(g.label); setRenaming(g.id); }}
                  >
                    <i className="ph ph-pencil-simple" style={{ fontSize: 11 }} />
                  </button>
                )}
                <span className="text-muted" style={{ fontSize: 11, flex: "none" }}>
                  {g.players.length} · avg {g.avg}
                </span>
              </div>
            )}

            {g.players.length === 0 && (
              <span className="text-muted" style={{ fontSize: 12, fontStyle: "italic" }}>
                Empty — drop a player here
              </span>
            )}

            {g.players.map((pl) => (
              <div
                key={pl.id}
                draggable={!disabled}
                onDragStart={() => setDragging(pl.id)}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  padding: "4px 6px",
                  borderRadius: 7,
                  cursor: disabled ? "default" : "grab",
                  opacity: dragging === pl.id ? 0.4 : 1,
                  background: "color-mix(in srgb, var(--color-text) 4%, transparent)",
                }}
              >
                {!disabled && (
                  <i
                    className="ph ph-dots-six-vertical"
                    style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 45%, transparent)" }}
                  />
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pl.name}
                </span>
                <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{pl.handicap}</span>
                {/* The route that works without a mouse, and the only one that
                    works on a touch screen. */}
                {!disabled && cards.length > 1 && (
                  <select
                    className="input"
                    aria-label={`Move ${pl.name} to another flight`}
                    value={g.id}
                    onChange={(e) => move(pl.id, e.target.value)}
                    style={{ width: 30, minHeight: 22, padding: "0 0 0 4px", fontSize: 11, background: "transparent", border: "none" }}
                  >
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
