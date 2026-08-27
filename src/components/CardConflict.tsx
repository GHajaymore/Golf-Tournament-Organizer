"use client";

/**
 * Two versions of the same card, and a person to choose between them.
 *
 * Since scoring works offline, a card can be minutes old when it reaches the
 * server — and it is written WHOLE, so replaying it would replace everything
 * stored, including a correction an organizer made in between. Nobody would
 * see that happen: the write succeeds, the screen looks right, and the
 * corrected hole is simply gone.
 *
 * The app does not get to decide whose scorecard was right. Only one of these
 * two people was standing on the hole, and no rule available here knows which.
 * So it shows both, marks the holes that differ, and asks.
 *
 * Deliberately NOT a merge. Taking the newest value per hole would produce a
 * third card that neither person entered and nobody can vouch for — which,
 * under Rule 3.3b, is precisely what a scorecard cannot be.
 */
export function CardConflict({
  mine,
  theirs,
  pars,
  onKeepMine,
  onTakeTheirs,
  busy = false,
}: {
  mine: (number | null)[];
  theirs: (number | null)[];
  pars: number[];
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  busy?: boolean;
}) {
  const holes = Math.max(mine.length, theirs.length);
  const differing = Array.from({ length: holes }, (_, i) => i).filter(
    (i) => (mine[i] ?? null) !== (theirs[i] ?? null),
  );

  const cell = (v: number | null, changed: boolean) => (
    <td
      style={{
        padding: "5px 8px",
        textAlign: "center",
        fontVariantNumeric: "tabular-nums",
        fontWeight: changed ? 700 : 400,
        color: changed ? "var(--color-danger)" : "var(--color-text)",
        whiteSpace: "nowrap",
      }}
    >
      {v ?? "–"}
    </td>
  );

  return (
    <section
      className="card elev-sm"
      style={{ gap: 12, borderColor: "var(--color-danger)" }}
      role="alertdialog"
      aria-label="This card was changed somewhere else"
    >
      <span className="card-title" style={{ fontSize: 15 }}>
        This card changed while you were out of signal
      </span>
      <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
        Somebody else — usually the committee — edited this card while your phone was
        offline. Your holes are still here and nothing has been sent. Pick which card is
        right; only one of you was standing on{" "}
        {differing.length === 1 ? "that hole" : "those holes"}.
      </p>

      {/*
        Only the holes that actually differ. Showing all eighteen buries the
        one number in dispute among seventeen that agree, and a person cannot
        make this decision by scanning two full rows on a phone.
      */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "5px 8px", fontSize: 11.5 }}>Hole</th>
              {differing.map((i) => (
                <th
                  key={i}
                  style={{ padding: "5px 8px", textAlign: "center", fontSize: 11.5 }}
                >
                  {i + 1}
                  {pars[i] ? (
                    <span className="text-muted" style={{ display: "block", fontWeight: 400 }}>
                      par {pars[i]}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: "1px solid var(--color-divider)" }}>
              <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 600 }}>Yours</th>
              {differing.map((i) => (
                <span key={i} style={{ display: "contents" }}>
                  {cell(mine[i] ?? null, true)}
                </span>
              ))}
            </tr>
            <tr style={{ borderTop: "1px solid var(--color-divider)" }}>
              <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 600 }}>Theirs</th>
              {differing.map((i) => (
                <span key={i} style={{ display: "contents" }}>
                  {cell(theirs[i] ?? null, true)}
                </span>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {/*
          "Theirs" leads. The other version is already what the tournament
          holds, so taking it is the outcome that changes nothing — and a
          destructive choice should never be the easier one to hit with a
          glove on.
        */}
        <button
          type="button"
          className="btn btn-secondary touch-target"
          style={{ flex: 1, minWidth: 140 }}
          disabled={busy}
          onClick={onTakeTheirs}
        >
          Use theirs
        </button>
        <button
          type="button"
          className="btn btn-primary touch-target"
          style={{ flex: 1, minWidth: 140 }}
          disabled={busy}
          onClick={onKeepMine}
        >
          Keep mine
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.5 }}>
        Keeping yours replaces their version. If you are not sure, use theirs and tell the
        committee what you had — a card is a statement under Rule 3.3b, not a race.
      </p>
    </section>
  );
}
