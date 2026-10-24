import type { EventReport as Report } from "@/lib/services/event-report";
import { REPORT_CSS } from "@/lib/report/report-styles";
import { listWords } from "@/lib/domain/final-report";

/**
 * The final report of a tournament that is not a cup, drawn — the same page,
 * stylesheet and rulings as the cup's (`FinalReport`): a champion where a cup
 * has its score, then the story, the format and field, the whole field's
 * leaderboard with gross and net, and who won the prizes.
 *
 * Since 2026-10-21 it is the tournament's conclusion, read top to bottom on a
 * phone in four parts — the result, the players, the money, what's next — and
 * every section is drawn only when the report carries it, which is only when
 * the tournament used that part of the app. Numbers are a figure and a
 * sentence, never a chart (Ajay rejected a chart-heavy mock as "very complex
 * and hard to understand"). Amounts appear only where the report says it may
 * (`report.amounts`); this file prints whatever strings it is handed and works
 * nothing out.
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

  const results =
    report.flights.length > 0 || report.draw.length > 0 || report.movement || report.rows.length > 0 || report.rounds.length > 0 || report.prizes.length > 0;
  const players = report.highlights.length > 0 || report.numbers.length > 0;
  const money = report.skins.length > 0 || report.sideGames.length > 0 || !!report.costs || !!report.settleUp;

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
              <p className="fr-eyebrow">{report.storyByOrganizer ? "From the organizer" : "The story"}</p>
              {report.story.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </section>
          )}

          {results && <p className="fr-part">The result</p>}

          {report.flights.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-flights-h">
              {/* Nobody has won a flight while it is still being played. */}
              <h2 id="fr-flights-h">{open ? "Flight leaders" : "Flight winners"}</h2>
              <div className="fr-lines">
                {report.flights.map((f) => (
                  <div key={f.label}>
                    <span>
                      <b>{f.label}</b> · {listWords(f.names)}
                      {f.names.length > 1 ? ", shared" : ""}
                    </span>
                    <span className="fr-amt">{f.figure}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.draw.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-draw-h">
              <h2 id="fr-draw-h">The draw</h2>
              {report.draw.map((d) => (
                <div key={d.label} className="fr-lines">
                  {report.draw.length > 1 && <p className="fr-eyebrow fr-sub-eyebrow">{d.label}</p>}
                  {d.ties.map((t, i) => (
                    <div key={i}>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          )}

          {report.movement && (
            <section className="fr-card" aria-labelledby="fr-move-h">
              <h2 id="fr-move-h">How it was won</h2>
              <div className="fr-moves">
                {report.movement.story.map((s) => (
                  <div key={s.label}>
                    <span className="fr-r">{s.label}</span>
                    <p>{s.text}</p>
                  </div>
                ))}
              </div>
              {report.movement.rows.length > 0 && (
                <div className="fr-board-wrap" role="region" aria-label="Place after each round" tabIndex={0}>
                  <table className="fr-mini">
                    <thead>
                      <tr>
                        <th scope="col">Place after each round</th>
                        {report.movement.columns.map((c) => (
                          <th key={c} scope="col">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.movement.rows.map((r) => (
                        <tr key={r.name}>
                          <td>{r.name}</td>
                          {r.places.map((p, i) => (
                            <td key={i} className={r.up[i] ? "fr-up" : undefined}>
                              {p || "–"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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

          {report.rounds.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-rounds-h">
              <h2 id="fr-rounds-h">Each round</h2>
              <div className="fr-lines fr-stack">
                {report.rounds.map((r) => (
                  <div key={r.label}>
                    <span>
                      <b>{r.label}</b>
                      {r.date ? ` · ${r.date}` : ""}
                    </span>
                    <span className="fr-res">{r.result}</span>
                  </div>
                ))}
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
                    <b>
                      {p.winners.join(", ")}
                      {p.amount ? <span className="fr-amt"> · {p.amount}</span> : null}
                    </b>
                  </div>
                ))}
              </div>
            </section>
          )}

          {players && <p className="fr-part">The players</p>}

          {report.highlights.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-hl-h">
              <h2 id="fr-hl-h">Highlights</h2>
              <div className="fr-feats">
                {report.highlights.map((h, i) => (
                  <div key={i} className="fr-feat">
                    <span className="fr-k">{h.label}</span>
                    <span className="fr-who">{h.who}</span>
                    {h.what && <span className="fr-how">{h.what}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.numbers.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-nums-h">
              <h2 id="fr-nums-h">In numbers</h2>
              <div className="fr-nums">
                {report.numbers.map((n, i) => (
                  <div key={i}>
                    <b>{n.figure}</b>
                    <span>{n.label}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {money && <p className="fr-part">The money</p>}

          {money && report.settleUp?.yours && (
            <p className="fr-yours" role="status">
              {report.settleUp.yours}
            </p>
          )}

          {report.skins.map((pot, i) => (
            <section key={`s${i}`} className="fr-card" aria-labelledby={`fr-skins-${i}`}>
              <h2 id={`fr-skins-${i}`}>{pot.title}</h2>
              {pot.line && <p className="fr-line">{pot.line}</p>}
              {pot.winners.length > 0 && (
                <div className="fr-lines">
                  {pot.winners.map((w, j) => (
                    <div key={j}>
                      <span>
                        {w.name}
                        {w.detail ? ` · ${w.detail}` : ""}
                      </span>
                      {w.amount && <span className="fr-amt">{w.amount}</span>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}

          {report.sideGames.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-side-h">
              <h2 id="fr-side-h">Side games</h2>
              {report.sideGames.map((g, i) => (
                <div key={i} className="fr-game">
                  <p className="fr-line">
                    <b>{g.title}</b>
                    {g.line ? ` · ${g.line}` : ""}
                  </p>
                  {g.winners.length > 0 && (
                    <div className="fr-lines">
                      {g.winners.map((w, j) => (
                        <div key={j}>
                          <span>
                            {w.name}
                            {w.detail ? ` · ${w.detail}` : ""}
                          </span>
                          {w.amount && <span className="fr-amt">{w.amount}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {report.costs && (
            <section className="fr-card" aria-labelledby="fr-costs-h">
              <h2 id="fr-costs-h">Entry fees and costs</h2>
              <div className="fr-lines">
                {report.costs.lines.map((l, i) => (
                  <div key={i}>
                    <span>{l.what}</span>
                    <span className="fr-amt">{l.amount}</span>
                  </div>
                ))}
                {report.costs.total && (
                  <div className="fr-total">
                    <span>
                      <b>{report.costs.total.what}</b>
                    </span>
                    <span className="fr-amt">{report.costs.total.amount}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {report.settleUp && (
            <section className="fr-card" aria-labelledby="fr-settle-h">
              <h2 id="fr-settle-h">Settle-up</h2>
              <p className="fr-line">
                Everything above, netted into the fewest payments. TourneyHQ records them; players pay each other.
                {open ? " The tournament is still being played, so this is what stands today." : ""}
              </p>
              <div className="fr-lines">
                {report.settleUp.lines.map((l, i) => (
                  <div key={i}>
                    <span>
                      {l.from} pays {l.to}
                    </span>
                    <span className="fr-amt">{l.amount}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {money && report.amounts && (
            <p className="fr-small fr-noprint">
              Amounts are shown to the organizer and to the players in this tournament. The public link names the
              winners only.
            </p>
          )}

          {report.comingUp.length > 0 && (
            <>
              <p className="fr-part">What&rsquo;s next</p>
              <section className="fr-card" aria-labelledby="fr-next-h">
                <h2 id="fr-next-h">Coming up</h2>
                <div className="fr-next">
                  {report.comingUp.map((c, i) => (
                    <div key={i}>
                      <span className="fr-d">{c.when}</span>
                      <p>{c.text}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
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
