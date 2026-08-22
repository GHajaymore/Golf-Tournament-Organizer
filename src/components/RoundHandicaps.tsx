"use client";
import { useState, useTransition } from "react";
import { setRoundHandicapOverride, applyRoundHandicapToRest } from "@/app/actions/tournament";
import FieldInfo from "@/components/FieldInfo";
import type { RoundHandicapView } from "@/lib/services/round-handicap";

/**
 * What each player plays off in THIS round.
 *
 * The roster handicap is the default and almost always the answer, so this
 * opens as one sentence rather than a list of inputs — a field of twenty-eight
 * spin boxes would suggest an organizer is expected to fill them in.
 *
 * Two things it must say out loud:
 *
 *   - Once cards are in, the round keeps what it was scored against. Not a
 *     disabled box: "cards are in" is an answer, and a box that does nothing
 *     is not.
 *   - When a frozen round disagrees with today's roster, it says so and shows
 *     both numbers. That line is the answer to "why is my net different in
 *     round one", and without it somebody eventually decides the app is wrong
 *     and re-enters the round.
 */

const numberFor = (v: number) => (v > 0 ? String(v) : v === 0 ? "scratch" : `+${Math.abs(v)}`);

export function RoundHandicaps({ stageId, rows }: { stageId: string; rows: RoundHandicapView[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const overridden = rows.filter((r) => r.source === "override");
  const differing = rows.filter((r) => r.differsFromCurrent !== null);
  /**
   * Settled — the round has been scored, so its handicaps are not up for
   * discussion.
   *
   * Read from `editable`, not from whether a frozen value is stored. A round
   * played before the freeze existed has cards and nothing frozen; keying on
   * the stored value would print "everyone plays off the roster" over a round
   * whose cards are in, and offer a control the action then refuses.
   */
  const isFrozen = rows.length > 0 && rows.every((r) => !r.editable);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, said = "") => {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "That didn't save. Try again.");
      else {
        setEditing("");
        if (said) setNote(said);
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          {isFrozen ? (
            <>Cards are in, so this round keeps the handicaps it was scored against.</>
          ) : overridden.length === 0 ? (
            <>Everyone plays off their handicap from the roster.</>
          ) : (
            <>
              <b style={{ color: "var(--color-text)" }}>{overridden.length}</b>{" "}
              {overridden.length === 1 ? "player has" : "players have"} a handicap set for this round;
              the rest play off the roster.
            </>
          )}
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: "2px 10px", fontSize: 12 }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : isFrozen ? "Show what it was scored off" : "Set one for this round"}
        </button>
        <FieldInfo label="handicaps for this round">
          <p>
            The handicap on the roster is what a player plays off. Change it here and the change
            belongs to this round only — the roster is untouched, and so is every other round.
          </p>
          <p>
            When the first card comes in, this round keeps whatever it was being scored against.
            After that a roster change moves the next round, not this one.
          </p>
          <p>These are course handicaps. The round&rsquo;s allowance still applies on top.</p>
        </FieldInfo>
      </div>

      {/* The answer to "why is my net different in round one", volunteered
          rather than waited for. */}
      {differing.map((r) => (
        <p key={r.playerId} className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          <b style={{ color: "var(--color-text)" }}>{r.name}</b> was scored off{" "}
          {numberFor(r.frozen ?? 0)} in this round and plays off {numberFor(r.differsFromCurrent ?? 0)}{" "}
          now.
        </p>
      ))}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger-300)" }}>{error}</p>
      )}
      {note && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          {note}
        </p>
      )}

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.length === 0 && (
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Nobody is confirmed in the field yet.
            </p>
          )}
          {rows.map((r) => (
            <div
              key={r.playerId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                padding: "4px 0",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <span style={{ fontSize: 13, minWidth: 0, flex: "1 1 140px" }}>{r.name}</span>
              <span className="text-muted" style={{ fontSize: 12 }}>
                plays off <b style={{ color: "var(--color-text)" }}>{numberFor(r.handicap)}</b>
                {r.source === "frozen"
                  ? " — what this round was scored off"
                  : r.source === "override"
                    ? ` — set for this round, in place of ${numberFor(r.member)}`
                    : ""}
              </span>

              {r.editable && editing !== r.playerId && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "2px 10px", fontSize: 12 }}
                  onClick={() => {
                    setEditing(r.playerId);
                    setValue(String(r.handicap));
                  }}
                >
                  {r.source === "override" ? "Change" : "Set"}
                </button>
              )}

              {r.editable && r.source === "override" && editing !== r.playerId && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "2px 10px", fontSize: 12 }}
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => applyRoundHandicapToRest(stageId, r.playerId).then((res) => {
                          if (res.ok) {
                            setNote(
                              res.written === 0
                                ? "There are no later rounds to apply it to."
                                : `Set on ${res.written} later ${res.written === 1 ? "round" : "rounds"}` +
                                  (res.skipped > 0
                                    ? `, leaving ${res.skipped} that already has cards in.`
                                    : "."),
                            );
                          }
                          return res;
                        }),
                      )
                    }
                  >
                    Apply to the rest
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "2px 10px", fontSize: 12 }}
                    disabled={pending}
                    onClick={() => run(() => setRoundHandicapOverride(stageId, r.playerId, null))}
                  >
                    Back to roster
                  </button>
                </>
              )}

              {editing === r.playerId && (
                <>
                  <input
                    className="input"
                    inputMode="numeric"
                    style={{ width: 80 }}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    aria-label={`Handicap for ${r.name} in this round`}
                  />
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "2px 10px", fontSize: 12 }}
                    disabled={pending}
                    onClick={() => {
                      const n = Number(value.trim());
                      if (!Number.isFinite(n)) {
                        setError("A handicap is a number of strokes.");
                        return;
                      }
                      run(() => setRoundHandicapOverride(stageId, r.playerId, n));
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "2px 10px", fontSize: 12 }}
                    onClick={() => setEditing("")}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
