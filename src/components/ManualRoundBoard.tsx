/**
 * What the leaderboard says about a round the app does not score.
 *
 * The temptation is to show something — a field list, a table of gross scores,
 * anything so the screen is not empty. That is exactly the failure this
 * format was added to prevent. A table on a leaderboard is read as a result,
 * whatever the caption says, and a club that posts the wrong winner because
 * the app showed a plausible one has been let down badly.
 *
 * So it shows no ranking at all, says why, and points at the two places the
 * result actually comes from: the committee, and the announcement they post.
 */
export function ManualRoundBoard({ format }: { format: string }) {
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Live</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Leaderboard</h2>
      </div>
      <ManualRoundNotice format={format} />
    </>
  );
}

/**
 * The same refusal without the leaderboard's page header, so Reports can say
 * it too.
 *
 * Reports used to print a branded "Final standings snapshot" with an Advancing
 * column for these rounds — a *more* authoritative-looking wrong answer than
 * the leaderboard would have given, on the page whose output gets pinned to a
 * noticeboard. One message, one component, both screens.
 */
export function ManualRoundNotice({ format }: { format: string }) {
  return (
    <>
      <div className="card elev-sm" style={{ gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <i className="ph ph-clipboard-text" style={{ fontSize: 20, opacity: 0.7 }} />
          <span className="card-title" style={{ fontSize: 16 }}>
            This round is scored by hand
          </span>
          <span className="tag" style={{ fontSize: 10.5 }}>{format}</span>
        </div>

        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7 }}>
          There is no leaderboard for this round because the app doesn&rsquo;t work out the result —
          the committee does. Everything else still runs here: the field, the tee sheet, the
          groupings and the prize list.
        </p>

        <p className="text-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7 }}>
          When the result is settled, post it as an announcement and it appears on every
          player&rsquo;s dashboard.
        </p>
      </div>
    </>
  );
}
