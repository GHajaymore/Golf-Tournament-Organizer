import type { EventReport as Report } from "@/lib/services/event-report";
import { REPORT_CSS } from "@/lib/report/report-styles";
import { listWords } from "@/lib/domain/final-report";

/**
 * The final report of a tournament that is not a cup, drawn — the same page,
 * stylesheet and rulings as the cup's (`FinalReport`): a champion where a cup
 * has its score, then the story, the format and field, the whole field's
 * leaderboard with gross and net, and who won the prizes.
 */
export function EventReport({
  report,
  footer,
  embedded = false,
}: {
  report: Report;
  footer?: React.ReactNode;
  /** Inside the console, which already has the page's main landmark. */
  embedded?: boolean;
}) {
  const open = !report.completed;
  const page = (c: React.ReactNode) =>
    embedded ? <div className="fr-page">{c}</div> : <main className="fr-page">{c}</main>;

  return (
    <div className={embedded ? "fr fr-embedded" : "fr"}>
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      {page(
        <>
          {/* No teams, so no team colours: the masthead's edge is the gold. */}
          <header className="fr-mast fr-plain">
            <div className="fr-crest">
              <svg viewBox="0 0 32 32" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M9 4h14v3h4v4a6 6 0 0 1-6 6h-.4A6 6 0 0 1 17 20.6V24h4v3H11v-3h4v-3.4A6 6 0 0 1 11.4 17H11a6 6 0 0 1-6-6V7h4V4Zm-2 5v2a4 4 0 0 0 2.3 3.6A9 9 0 0 1 9 12V9H7Zm16 0v3a9 9 0 0 1-.3 2.6A4 4 0 0 0 25 11V9h-2Z"
                />
              </svg>
              {open ? "The results so far" : "Final report"}
            </div>
            <h1>{report.name}</h1>
            {report.where && <div className="fr-where">{report.where}</div>}
            {report.first && report.first.names.length > 0 && (
              <div className="fr-champ" role="group" aria-label={open ? "Leading" : "Winner"}>
                {/* "A, B and C" — never "&", which reads as one pair. */}
                <div className="fr-champ-name">{listWords(report.first.names)}</div>
                {report.first.figure && <div className="fr-champ-fig">{report.first.figure}</div>}
              </div>
            )}
            {report.ribbon && <span className="fr-ribbon">{report.ribbon}</span>}
          </header>

          {report.story.length > 0 && (
            <section className="fr-card fr-story" aria-label="The story">
              <p className="fr-eyebrow">The story</p>
              {report.story.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </section>
          )}

          <section className="fr-card" aria-labelledby="fr-day-h">
            <p className="fr-eyebrow">The day</p>
            <h2 id="fr-day-h">Format and field</h2>
            <div className="fr-facts">
              {report.facts.map((f, i) => (
                <div key={i}>
                  <b>{f.label}</b>
                  {f.value}
                </div>
              ))}
            </div>
          </section>

          {report.rows.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-board-h">
              <p className="fr-eyebrow">{report.rankedBy}</p>
              <h2 id="fr-board-h">{report.boardTitle}</h2>
              <div className="fr-board-wrap" role="region" aria-label={report.boardTitle} tabIndex={0}>
                <table className="fr-board">
                  <thead>
                    <tr>
                      <th scope="col">Pos</th>
                      <th scope="col">Player</th>
                      {report.columns.map((c) => (
                        <th key={c} scope="col">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r, i) => (
                      <tr key={`${r.name}-${i}`} className={r.first ? "fr-top" : undefined}>
                        <td>{r.place}</td>
                        <td>{r.name}</td>
                        {r.note ? (
                          <td className="fr-note" colSpan={report.columns.length}>
                            {r.note}
                          </td>
                        ) : (
                          r.cells.map((c, j) => (
                            <td key={j} className="fr-figs">
                              {c || "–"}
                            </td>
                          ))
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {report.prizes.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-prizes-h">
              <p className="fr-eyebrow">Prizes</p>
              <h2 id="fr-prizes-h">Prize winners</h2>
              <div className="fr-other">
                {report.prizes.map((p, i) => (
                  <div key={i}>
                    <span>{p.what}</span>
                    <b>{p.winners.join(", ")}</b>
                  </div>
                ))}
              </div>
            </section>
          )}

          <footer className="fr-foot">
            <span>
              <b>TourneyHQ</b> · {open ? "The results so far" : "Final report"}
            </span>
            {footer}
          </footer>
        </>,
      )}
    </div>
  );
}
