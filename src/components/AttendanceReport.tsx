import { MoreInfo } from "./MoreInfo";
import type { AttendanceReport as Report } from "@/lib/services/attendance-report";

/**
 * WHO TURNED OUT, FOR THE WHOLE SEASON, ON ONE SHEET.
 *
 * The weekly control on `/foursomes` answers "who is in for Thursday" while
 * somebody draws Thursday's sheet. This answers the question a secretary asks
 * in September: who actually came, how often, and who never replies.
 *
 * A SERVER COMPONENT. Nothing here is interactive — changing an answer stays
 * on the weekly control, where the person doing it is looking at the round
 * they are changing. A report that also edited would be a second writer for
 * the same act, and the one furthest from the context that makes it safe.
 *
 * The grid is horizontally scrollable in its own wrapper rather than by the
 * page, which is the rule for anything wide: a twenty-week league is twenty
 * columns and the page body must never scroll sideways.
 */
export function AttendanceReport({ report }: { report: Report }) {
  /**
   * NOT TRACKED IS A REAL ANSWER, and it is said rather than drawn.
   *
   * On `everyone` the confirmed field plays every round and nothing is
   * recorded. An empty grid would read as "nobody has answered"; a grid full
   * of "in" would read as forty people having confirmed. Both are lies about a
   * tournament that never asked.
   */
  if (!report.tracked) {
    return (
      <div className="card elev-sm" style={{ gap: 6 }}>
        <span className="card-title" style={{ fontSize: 15 }}>
          Weekly sign-up
        </span>
        <MoreInfo short="Not used — every confirmed player is in every round.">
          This tournament doesn&rsquo;t use weekly sign-up — every confirmed player is in every round,
          so there is nothing to report. Turn it on in Settings if your league needs members to say
          which weeks they can make.
        </MoreInfo>
      </div>
    );
  }

  return (
    <div className="card elev-sm" style={{ gap: 10 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>
          Who turned out ({report.rows.length})
        </span>
        {/* One line, the rest an ⓘ away (2026-10-05). */}
        <MoreInfo short={`${report.modeLabel}.`} style={{ marginTop: 4 }}>
          Every round of the season.{" "}
          {report.playersAnswerThemselves
            ? "Players answer on their own phone; your staff can set anyone's."
            : "Captains send their pairs in and your staff record them."}
        </MoreInfo>
        {/* THE CHASE LIST, as a number. "Nobody has answered" is the state an
            opt-in league starts every week in, and a secretary needs to know
            how much of the grid below is a real answer before reading it. */}
        {report.neverAnswered > 0 && (
          <MoreInfo
            warn
            short={
              report.neverAnswered === 1
                ? "1 player has never answered for any round"
                : `${report.neverAnswered} players have never answered for any round`
            }
            style={{ marginTop: 4 }}
          >
            Their rows below are the league&rsquo;s default, not their word.
          </MoreInfo>
        )}
      </div>

      <div className="table-scroll">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 130 }}>Player</th>
              {report.rounds.map((r) => (
                <th key={r.stageId} style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  {r.label}
                  {r.dateLabel && (
                    <div className="text-muted" style={{ fontSize: 13, fontWeight: 400 }}>
                      {r.dateLabel}
                    </div>
                  )}
                </th>
              ))}
              <th style={{ textAlign: "center" }}>In</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.playerId}>
                <td style={{ fontWeight: 500 }}>{row.name}</td>
                {row.cells.map((c, i) => (
                  <td
                    key={report.rounds[i]?.stageId ?? i}
                    style={{ textAlign: "center" }}
                    /* The stated answer and the default are different facts —
                       the distinction the whole feature turns on — so the
                       accessible name carries it even though the glyph is
                       terse. */
                    title={
                      // A returned card says they turned out, whatever the
                      // sign-up said (2026-10-09) — see `played`.
                      c.played
                        ? "Played — returned a card"
                        : c.explicit
                          ? `${c.status === "in" ? "In" : "Out"}${c.decidedBy ? ` — recorded by ${c.decidedBy}` : ""}`
                          : `${c.status === "in" ? "In" : "Out"} by default — never answered`
                    }
                  >
                    <span
                      role="img"
                      aria-label={
                        c.played
                          ? "Played"
                          : c.explicit
                            ? c.status === "in"
                              ? "In"
                              : "Out"
                            : c.status === "in"
                              ? "In by default"
                              : "Out by default"
                      }
                      style={{
                        // Solid for a stated answer, outlined for a default —
                        // the same vocabulary the calendar uses, so a member
                        // and a secretary read one language.
                        color: c.status === "in" ? "var(--color-accent-2-200)" : "var(--color-text-muted)",
                        opacity: c.explicit || c.played ? 1 : 0.55,
                        fontWeight: c.explicit || c.played ? 700 : 400,
                      }}
                    >
                      {c.played ? "✓" : c.status === "in" ? (c.explicit ? "✓" : "·") : c.explicit ? "✕" : "–"}
                    </span>
                  </td>
                ))}
                <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {row.inCount}
                </td>
              </tr>
            ))}
            <tr>
              <td className="text-muted" style={{ fontSize: 13 }}>
                In this round
              </td>
              {report.rounds.map((r) => (
                <td
                  key={r.stageId}
                  className="text-muted"
                  style={{ textAlign: "center", fontVariantNumeric: "tabular-nums", fontSize: 13 }}
                >
                  {r.in}
                  {/* How many of those are in only because nobody said
                      otherwise. Sixteen confirmed and eight silent is a
                      different Wednesday from twenty-four confirmed, which is
                      the whole reason `inByDefault` exists. */}
                  {/* 10px, not smaller. `brand-consistency` refuses text below
                      that and is right to: this is a number a secretary reads
                      off a printed sheet. */}
                  {r.inByDefault > 0 && (
                    <div style={{ fontSize: 13, opacity: 0.75 }}>{r.inByDefault} by default</div>
                  )}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* The key the grid is read with — an instruction, so it stays on
          screen, at reading size (2026-10-05). */}
      <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
        <b>✓</b> said they were in · <b>✕</b> said they were out · <b>·</b> in by default ·{" "}
        <b>–</b> out by default. Change an answer on the round itself, from Tee sheet or Score
        entry.
      </p>
    </div>
  );
}
