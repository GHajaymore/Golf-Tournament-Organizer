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
 *
 * TWO SITUATIONS, and they are opposites. This chooser is shown for both, and
 * for a long time it described only one of them.
 *
 *   "conflict"  — the server holds a card that changed under us. Both versions
 *                 exist. Taking theirs changes nothing, because the server
 *                 already holds exactly that, so it is the safe default.
 *
 *   "recovered" — holes are sitting on this phone that the server has NEVER
 *                 seen. Nobody edited anything. Taking "theirs" deletes the
 *                 device copy, and the device copy is the only copy.
 *
 * Rendered with the conflict's wording, the recovery case told the player
 * "Somebody else — usually the committee — edited this card while your phone
 * was offline" (nobody had), and advised "If you are not sure, use theirs"
 * (which erased five holes they had walked in with). The safe button and the
 * destructive one are swapped between the two, so the wording, the order and
 * the footnote all have to swap with them.
 */
export type CardConflictKind = "conflict" | "recovered";

export function CardConflict({
  mine,
  theirs,
  pars,
  onKeepMine,
  onTakeTheirs,
  kind = "conflict",
  busy = false,
}: {
  mine: (number | null)[];
  theirs: (number | null)[];
  pars: number[];
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  /**
   * Which situation this is. Defaults to "conflict" — the stricter reading, in
   * that it never calls unsent holes a committee edit.
   */
  kind?: CardConflictKind;
  busy?: boolean;
}) {
  const holes = Math.max(mine.length, theirs.length);
  const differing = Array.from({ length: holes }, (_, i) => i).filter(
    (i) => (mine[i] ?? null) !== (theirs[i] ?? null),
  );

  const recovered = kind === "recovered";

  /**
   * Every word that differs between the two situations, in one place.
   *
   * Gathered rather than sprinkled through the JSX so that adding a third
   * situation later cannot half-describe it — which is the failure this whole
   * prop exists to fix.
   */
  const copy = recovered
    ? {
        title: "Holes on this phone that were never sent",
        // No accusation, because nothing happened: these simply never left the
        // phone. Saying the committee edited the card sent players to ask an
        // organizer about a change nobody had made.
        body: "These holes are saved on this phone and have never reached the committee. Nothing has been sent yet. Below them is the card the committee currently holds.",
        mineLabel: "On this phone",
        theirsLabel: "Sent so far",
        keepLabel: "Send these holes",
        takeLabel: "Discard them",
        // Reversed, and it has to be: discarding is the irreversible choice
        // here, and the phone is holding the only copy.
        footnote:
          "Discarding cannot be undone — this phone holds the only copy of these holes. If you are not sure, send them and tell the committee.",
        aria: "Holes on this phone were never sent",
      }
    : {
        title: "This card changed while you were out of signal",
        body: "Somebody else — usually the committee — edited this card while your phone was offline. Your holes are still here and nothing has been sent. Pick which card is right; only one of you was standing on",
        mineLabel: "Mine",
        theirsLabel: "Theirs",
        keepLabel: "Keep mine",
        takeLabel: "Use theirs",
        footnote:
          "Keeping yours replaces their version. If you are not sure, use theirs and tell the committee what you had — a card is a statement under Rule 3.3b, not a race.",
        aria: "This card was changed somewhere else",
      };

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
      aria-label={copy.aria}
    >
      <span className="card-title" style={{ fontSize: 15 }}>
        {copy.title}
      </span>
      <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
        {recovered ? (
          copy.body
        ) : (
          <>
            {copy.body} {differing.length === 1 ? "that hole" : "those holes"}.
          </>
        )}
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
              <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 600 }}>{copy.mineLabel}</th>
              {differing.map((i) => (
                <span key={i} style={{ display: "contents" }}>
                  {cell(mine[i] ?? null, true)}
                </span>
              ))}
            </tr>
            <tr style={{ borderTop: "1px solid var(--color-divider)" }}>
              <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 600 }}>{copy.theirsLabel}</th>
              {differing.map((i) => (
                <span key={i} style={{ display: "contents" }}>
                  {cell(theirs[i] ?? null, true)}
                </span>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/*
        THE NON-DESTRUCTIVE CHOICE LEADS, and which one that is flips between
        the two situations.

        In a conflict, "theirs" is already what the tournament holds, so taking
        it changes nothing — it leads, and a destructive choice should never be
        the easier one to hit with a glove on.

        In a recovery the same button DELETES the device's only copy of holes
        the server has never seen, while sending them changes nothing that
        exists anywhere else. So the order swaps with the meaning; leaving it
        fixed would have put the irreversible option under the thumb.
      */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(recovered
          ? ([
              { label: copy.keepLabel, onClick: onKeepMine, primary: true },
              { label: copy.takeLabel, onClick: onTakeTheirs, primary: false },
            ] as const)
          : ([
              { label: copy.takeLabel, onClick: onTakeTheirs, primary: false },
              { label: copy.keepLabel, onClick: onKeepMine, primary: true },
            ] as const)
        ).map((b) => (
          <button
            key={b.label}
            type="button"
            className={`btn ${b.primary ? "btn-primary" : "btn-secondary"} touch-target`}
            style={{ flex: 1, minWidth: 140 }}
            disabled={busy}
            onClick={b.onClick}
          >
            {b.label}
          </button>
        ))}
      </div>
      <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.5 }}>
        {copy.footnote}
      </p>
    </section>
  );
}
