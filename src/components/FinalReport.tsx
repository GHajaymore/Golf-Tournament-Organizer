import type { FinalReport as Report } from "@/lib/services/final-report";
import { countWords, halves } from "@/lib/domain/final-report";
import { REPORT_CSS } from "@/lib/report/report-styles";

/**
 * A team cup's final report, drawn — the same page for the public link, the
 * organizer's copy and print. See `services/final-report.ts` for what is on it
 * and `report/report-styles.ts` for why it looks the way it does.
 */
export function FinalReport({
  report,
  footer,
  embedded = false,
}: {
  report: Report;
  footer?: React.ReactNode;
  /** Inside the console, which already has the page's main landmark. */
  embedded?: boolean;
}) {
  // Inside the console the page already has its main landmark.
  const page = (c: React.ReactNode) =>
    embedded ? <div className="fr-page">{c}</div> : <main className="fr-page">{c}</main>;
  const [ta, tb] = report.teams;
  const [sa, sb] = report.score;
  const won = report.verdict.kind === "won" || report.verdict.kind === "retained" ? report.verdict.by : null;
  const open = report.verdict.kind === "open";
  const t = report.track;
  const pct = (cells: number) => (t.cells ? (cells / t.cells) * 100 : 50);
  // The masthead's bottom edge is split where the two teams' points meet.
  const split = `${pct(t.outsideA + t.a + t.open / 2).toFixed(1)}%`;
  const cells = [
    ...Array<string>(t.outsideA).fill("fr-cx"),
    ...Array<string>(t.a).fill("fr-ca"),
    ...Array<string>(t.open).fill(""),
    ...Array<string>(t.b).fill("fr-cb"),
    ...Array<string>(t.outsideB).fill("fr-cx"),
  ];
  const outsideAwarded = report.outside.filter((o) => o.side);
  const matchPoints = (side: "A" | "B") =>
    (side === "A" ? sa : sb) - report.outside.filter((o) => o.side === side).reduce((n, o) => n + o.points, 0);

  return (
    <div className={embedded ? "fr fr-embedded" : "fr"} style={{ ["--fr-split" as string]: split }}>
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      {page(
        <>
          <header className="fr-mast">
            <div className="fr-crest">
              <svg viewBox="0 0 32 32" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M9 4h14v3h4v4a6 6 0 0 1-6 6h-.4A6 6 0 0 1 17 20.6V24h4v3H11v-3h4v-3.4A6 6 0 0 1 11.4 17H11a6 6 0 0 1-6-6V7h4V4Zm-2 5v2a4 4 0 0 0 2.3 3.6A9 9 0 0 1 9 12V9H7Zm16 0v3a9 9 0 0 1-.3 2.6A4 4 0 0 0 25 11V9h-2Z"
                />
              </svg>
              {open ? "The cup so far" : "Final report"}
            </div>
            <h1>{report.name}</h1>
            {report.where && <div className="fr-where">{report.where}</div>}
            <div className="fr-score" role="group" aria-label={`Score: ${ta} ${halves(sa)}, ${tb} ${halves(sb)}`}>
              <div className={`fr-team fr-team-a${won === "A" ? " fr-win" : ""}`}>
                <div className="fr-n">{halves(sa)}</div>
                <div className="fr-nm">{ta}</div>
              </div>
              <div className="fr-v">v</div>
              <div className={`fr-team fr-team-b${won === "B" ? " fr-win" : ""}`}>
                <div className="fr-n">{halves(sb)}</div>
                <div className="fr-nm">{tb}</div>
              </div>
            </div>
            {report.ribbon && <span className="fr-ribbon">{report.ribbon}</span>}
          </header>

          {t.cells > 0 && (
            <section className="fr-card" aria-labelledby="fr-track-h">
              <div className="fr-track-head">
                <h2 id="fr-track-h">
                  {Number.isInteger(report.inPlay)
                    ? `${countWords(report.inPlay).replace(/^./, (c) => c.toUpperCase())} points`
                    : `${halves(report.inPlay)} points`}
                </h2>
                {report.target > 0 && <span>{halves(report.target)} to win</span>}
              </div>
              <div
                className="fr-track"
                aria-hidden="true"
                style={{
                  gridTemplateColumns: `repeat(${t.cells}, minmax(0, 1fr))`,
                }}
              >
                {cells.map((c, i) => (
                  <i key={i} className={c || undefined} />
                ))}
                {report.target > 0 && report.target < report.inPlay && (
                  <div className="fr-mark" style={{ left: `${pct(report.target * 2)}%` }}>
                    <span>{halves(report.target)}</span>
                  </div>
                )}
              </div>
              <div className="fr-legend">
                <span>
                  <b className="fr-ka" />
                  {ta} {halves(matchPoints("A"))}
                  {outsideAwarded.length > 0 && " in the matches"}
                </span>
                <span>
                  <b className="fr-kb" />
                  {tb} {halves(matchPoints("B"))}
                  {outsideAwarded.length > 0 && " in the matches"}
                </span>
                {outsideAwarded.map((o, i) => (
                  <span key={i}>
                    <b className="fr-kx" />
                    {o.label} · {o.side === "A" ? ta : tb}
                  </span>
                ))}
              </div>
            </section>
          )}

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

          {report.sessions.map((s) => (
            <section key={s.id} className="fr-card" aria-labelledby={`fr-s-${s.id}`}>
              <div className="fr-session-head">
                <div>
                  <p className="fr-eyebrow">{s.eyebrow}</p>
                  <h2 id={`fr-s-${s.id}`}>{s.title}</h2>
                </div>
                <span className="fr-tally">
                  <span className="fr-ta">
                    {ta} {halves(s.tally[0])}
                  </span>
                  <span className="fr-tb">
                    {tb} {halves(s.tally[1])}
                  </span>
                </span>
              </div>
              <div className="fr-cols" aria-hidden="true">
                <span>{ta}</span>
                <span />
                <span>{tb}</span>
              </div>
              <ul className="fr-matches">
                {s.matches.map((m, i) => (
                  <li
                    key={i}
                    className={m.winner === "A" ? "fr-wa" : m.winner === "B" ? "fr-wb" : m.final ? "fr-hv" : undefined}
                  >
                    <span>{m.a}</span>
                    <span className="fr-chip">{m.label || "—"}</span>
                    <span>{m.b}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {report.outside.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-other-h">
              <p className="fr-eyebrow">Outside the matches</p>
              <h2 id="fr-other-h">Other points</h2>
              <div className="fr-other">
                {report.outside.map((o, i) => (
                  <div key={i}>
                    <span>{o.label}</span>
                    <span className="fr-tally">
                      {o.side ? (
                        <span className={o.side === "A" ? "fr-ta" : "fr-tb"}>
                          {o.side === "A" ? ta : tb} {halves(o.points)}
                        </span>
                      ) : (
                        <span>To be decided</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.stars.length > 0 && (
            <section className="fr-card" aria-labelledby="fr-stars-h">
              <p className="fr-eyebrow">Stars of the day</p>
              <h2 id="fr-stars-h">Won every match</h2>
              <div className="fr-stars">
                {report.stars.map((s) => (
                  <div key={`${s.side}:${s.name}`} className="fr-star">
                    <div className="fr-who">{s.name}</div>
                    <div className="fr-rec">
                      {s.played} – 0 · {s.side === "A" ? ta : tb}
                    </div>
                    <div className="fr-how">
                      {s.how.map((h, i) => (i ? h.charAt(0).toLowerCase() + h.slice(1) : h)).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.records.most > 0 && (
            <section className="fr-card" aria-labelledby="fr-rec-h">
              <p className="fr-eyebrow">Every player</p>
              <h2 id="fr-rec-h">
                Points won
                {report.records.most > 1 ? `, of ${countWords(report.records.most)}` : ""}
              </h2>
              <div className="fr-grid2">
                {(["A", "B"] as const).map((side) => (
                  <div key={side}>
                    <div className="fr-rec-h">{side === "A" ? ta : tb}</div>
                    {report.records[side].map((r) => (
                      <div key={r.name} className="fr-row">
                        <span>{r.name}</span>
                        <span className="fr-bar">
                          <i
                            style={{
                              width: `${(r.points / report.records.most) * 100}%`,
                            }}
                          />
                        </span>
                        <span className="fr-pts">{halves(r.points)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          <footer className="fr-foot">
            <span>
              <b>TourneyHQ</b> · {open ? "The cup so far" : "Final report"}
            </span>
            {footer}
          </footer>
        </>,
      )}
    </div>
  );
}
