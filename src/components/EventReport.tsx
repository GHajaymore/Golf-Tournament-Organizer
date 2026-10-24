import type { EventReport as Report } from "@/lib/services/event-report";
import { REPORT_CSS } from "@/lib/report/report-styles";
import { listWords } from "@/lib/domain/final-report";
import { ReportGraphic, graphicTitle } from "@/components/report/ReportGraphics";

/**
 * The final report of a tournament that is not a cup, drawn — the same page,
 * stylesheet and rulings as the cup's (`FinalReport`).
 *
 * REBUILT 2026-10-23 as the rich report (Ajay: "make all the reports rich and
 * add some graphics … I see reports for all formats look same"; the panel's
 * decision is in `docs/final-report-every-format.md`). Top to bottom:
 *
 *   the masthead        the CLUB first (its name and logo), the event, the champion
 *   the prize list      overall and each flight, in the format's own words, with
 *                       how a tie was decided
 *   the picture         one, chosen for the format (`ReportGraphic`)
 *   on the course       twos, nearest the pin, longest drive — where they ran
 *   side games          one line a game, then the settle-up: the fewest payments
 *                       and each player's net — only once nothing can change
 *   the story           the organizer's, or one told from the results
 *   the rest            how it was won, format and field, the leaderboard, each
 *                       round, prizes, highlights, numbers, the hole strip
 *   what's next         always last
 *
 * Every section is drawn only when the report carries it. Amounts appear only
 * where the report says it may (`report.amounts`); this file prints whatever
 * strings it is handed and works nothing out.
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

  const games = report.skins.length > 0 || report.sideGames.length > 0;
  const money = games || !!report.costs || !!report.settleUp || !!report.moneyPending;
  // The ladder draws the place after each round; the podium's copy of it would say it twice.
  const ladder = report.hero?.kind === "ladder";
  // A casual round is one short screen: the result, the settle-up as its picture, the games.
  const casual = report.kind === "casual";

  const settleCard = report.settleUp && (
    <section
      className={`fr-card${casual ? " fr-fig" : ""}`}
      data-graphic={casual ? "settle" : undefined}
      aria-labelledby="fr-settle-h"
    >
      <h2 id="fr-settle-h">Settle up</h2>
      <p className="fr-line">
        {casual
          ? "The round's games, netted into the fewest payments."
          : "Everything above, netted into the fewest payments."}
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
      {report.standing && report.standing.length > 0 && (
        <>
          <p className="fr-eyebrow fr-sub-eyebrow" style={{ marginTop: 16 }}>
            Where everybody ends up
          </p>
          <div className="fr-lines">
            {report.standing.map((s, i) => (
              <div key={i}>
                <span>{s.name}</span>
                <span className={`fr-amt${s.net.startsWith("+") ? " fr-net-pos" : ""}`}>{s.net}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="fr-line">Recorded by TourneyHQ. Settle between yourselves.</p>
    </section>
  );

  return (
    <div className={embedded ? "fr fr-embedded" : "fr"} data-report-kind={report.kind}>
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      {page(
        <>
          {/* No teams, so no team colours: the masthead's edge is the gold. */}
          <header className="fr-mast fr-plain">
            {(report.club.name || report.club.logoUrl) && (
              <div className="fr-club">
                {report.club.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a club's own logo, any host, drawn as uploaded
                  <img src={report.club.logoUrl} alt={report.club.name ? "" : "The club's logo"} />
                )}
                {report.club.name && <span>{report.club.name}</span>}
              </div>
            )}
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

          {report.lead.length > 0 && (
            <section className="fr-card fr-lead" aria-labelledby="fr-lead-h">
              <p className="fr-eyebrow">{casual ? "The result" : report.rankedBy || "The result"}</p>
              <h2 id="fr-lead-h">{open ? "Where it stands" : casual ? "The round" : "The prize list"}</h2>
              {report.lead.map((g) => (
                <div key={g.label} className="fr-lead-group">
                  {report.lead.length > 1 && <p className="fr-eyebrow fr-sub-eyebrow">{g.label}</p>}
                  {g.lines.map((l, i) => (
                    <div key={i} className={`fr-lead-line${i === 0 ? " fr-first" : ""}`}>
                      <span className="fr-lp">{l.place}</span>
                      <span className="fr-ln">{listWords(l.names)}</span>
                      <span className="fr-lf">{l.figure}</span>
                      {l.how && <span className="fr-lh">{l.how}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          )}

          {casual && settleCard}

          {report.hero && <ReportGraphic graphic={report.hero} title={graphicTitle(report.hero)} />}

          {report.onTheCourse.length > 0 && (
            <section className="fr-card fr-course" aria-labelledby="fr-course-h">
              <p className="fr-eyebrow">On the course</p>
              <h2 id="fr-course-h">Twos and contests</h2>
              <div className="fr-lines">
                {report.onTheCourse.map((c, i) => (
                  <div key={i}>
                    <span>
                      <b>{c.what}</b> · {c.who}
                    </span>
                    <span className="fr-amt">{c.detail}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {money && <p className="fr-part">Side games</p>}

          {money && report.settleUp?.yours && (
            <p className="fr-yours" role="status">
              {report.settleUp.yours}
            </p>
          )}

          {games && (
            <section className="fr-card" aria-labelledby="fr-side-h">
              <h2 id="fr-side-h">Side games</h2>
              {[...report.skins, ...report.sideGames].map((g, i) => (
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

          {report.moneyPending && (
            <p className="fr-yours" role="status">
              {report.moneyPending}
            </p>
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

          {!casual && settleCard}

          {money && report.amounts && (
            <p className="fr-small fr-noprint">
              Amounts are shown to the organizer and to the players in this tournament. The public link names the
              winners only.
            </p>
          )}

          {!casual && (
            <>
              {report.story.length > 0 && (
                <section className="fr-card fr-story" aria-label="The story">
                  <p className="fr-eyebrow">{report.storyByOrganizer ? "From the organizer" : "The story"}</p>
                  {report.story.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
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
                  {!ladder && report.movement.rows.length > 0 && (
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

              {report.holeStrip && <ReportGraphic graphic={report.holeStrip} title={graphicTitle(report.holeStrip)} />}
            </>
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
              {/* TourneyHQ once, small: the club's document. Where it points follows the launch switch. */}
              <a href={report.foot.href} className="fr-by">
                {report.foot.text}
              </a>
              {report.foot.cta && (
                <>
                  {" · "}
                  <a href={report.foot.href}>{report.foot.cta}</a>
                </>
              )}
            </span>
            {footer}
          </footer>
        </>,
      )}
    </div>
  );
}
