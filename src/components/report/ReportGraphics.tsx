import {
  BOTH,
  holeTone,
  ladderOrder,
  moveWords,
  type HeroGraphic,
  type HoleStripGraphic,
  type LadderGraphic,
  type PathGraphic,
  type PointsGraphic,
  type SideGraphic,
  type WeeksGraphic,
} from "@/lib/domain/report-graphics";
import { NAME_WITHHELD } from "@/lib/domain/report-settings";

/**
 * THE REPORT'S PICTURES, drawn (2026-10-23) — see `domain/report-graphics.ts`.
 *
 * Each is a `<figure>`: the caption says the finding in words, the picture is
 * drawn for the eye (and hidden from a screen reader, which is given the
 * table instead), and the TABLE beside it holds the same figures — drawn from
 * the SAME list, never a second one, so the two cannot disagree. The table is
 * out of sight on a screen and printed on paper (`fr-sr`).
 *
 * No axes, no gridlines, no hue alone: under par is solid, par is blank, over
 * par is outlined and hatched, a played week is a filled dot and a missed one
 * a ring. Every figure is 16px or more.
 */
export function ReportGraphic({ graphic, title }: { graphic: HeroGraphic; title: string }) {
  return (
    <figure className="fr-card fr-fig" data-graphic={graphic.kind} aria-labelledby={`fr-g-${graphic.kind}`}>
      <h2 id={`fr-g-${graphic.kind}`}>{title}</h2>
      <figcaption className="fr-caption">{graphic.caption}</figcaption>
      {graphic.kind === "ladder" && <Ladder g={graphic} />}
      {graphic.kind === "holes" && <Holes g={graphic} />}
      {graphic.kind === "points" && <Points g={graphic} />}
      {graphic.kind === "side" && <Side g={graphic} />}
      {graphic.kind === "path" && <Path g={graphic} />}
      {graphic.kind === "weeks" && <Weeks g={graphic} />}
    </figure>
  );
}

/** What each graphic is called on the page. */
export function graphicTitle(g: HeroGraphic): string {
  switch (g.kind) {
    case "ladder":
      return "Place after each round";
    case "holes":
      return "How the holes played";
    case "points":
      return "The points";
    case "side":
      return g.round ? `The winning card, ${g.round}` : "The winning card";
    case "path":
      return "The road to the title";
    case "weeks":
      return "The table, week by week";
  }
}

/** "Ann Example" → "Ann E." — a name that fits at either end of a line. */
function shortName(name: string): string {
  // A name withheld from public pages stays withheld, shortened too.
  if (name === NAME_WITHHELD) return "Withheld";
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

/* ------------------------------------------------------------------------ */

function Ladder({ g }: { g: LadderGraphic }) {
  // Drawn on a 360-wide canvas: on a phone the card is about 310px across, so the
  // canvas is scaled to 0.86 and the 19-unit words land at 16px or more
  // (`report-rich.spec.ts` measures them as drawn).
  const rowH = 44;
  const top = 38;
  const nameW = 104;
  const W = 360;
  const span = W - nameW * 2;
  const xAt = (c: number) => nameW + (g.columns.length === 1 ? span / 2 : (span * c) / (g.columns.length - 1));
  const orders = g.columns.map((_, c) => ladderOrder(g.rows, c));
  const yAt = (slot: number) => top + slot * rowH + rowH / 2;
  const H = top + g.rows.length * rowH + 8;
  const cut = g.cutAfter ? g.columns.indexOf(g.cutAfter) : -1;
  return (
    <>
      <svg className="fr-ladder" viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true" focusable="false">
        {g.columns.map((c, i) => (
          <text key={c} x={xAt(i)} y={20} textAnchor="middle" className="fr-svg-col">
            {c}
          </text>
        ))}
        {cut >= 0 && cut < g.columns.length - 1 && (
          <g className="fr-svg-cut">
            <line x1={(xAt(cut) + xAt(cut + 1)) / 2} x2={(xAt(cut) + xAt(cut + 1)) / 2} y1={top - 4} y2={H - 4} />
            <text x={(xAt(cut) + xAt(cut + 1)) / 2} y={H} textAnchor="middle">
              cut
            </text>
          </g>
        )}
        {g.rows.map((r, i) => {
          const pts = r.places.map((p, c) => ({ p, x: xAt(c), y: yAt(orders[c][i]) })).filter((q) => q.p);
          return (
            <g key={r.name} className={i === 0 ? "fr-svg-lead" : undefined}>
              <polyline points={pts.map((q) => `${q.x},${q.y}`).join(" ")} className="fr-svg-line" />
              {pts.map((q, c) => (
                <g key={c}>
                  <circle cx={q.x} cy={q.y} r={18} className="fr-svg-dot" />
                  <text x={q.x} y={q.y + 6.5} textAnchor="middle" className="fr-svg-place">
                    {q.p}
                  </text>
                </g>
              ))}
              <text x={nameW - 22} y={yAt(orders[0][i]) + 7} textAnchor="end" className="fr-svg-name">
                {r.places[0] ? shortName(r.name) : ""}
              </text>
              <text x={W - nameW + 22} y={yAt(orders[g.columns.length - 1][i]) + 7} className="fr-svg-name">
                {shortName(r.name)}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="fr-mini fr-gtable">
        <caption className="fr-sr">Place after each round</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            {g.columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              {r.places.map((p, i) => (
                <td key={i}>{p || "–"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Holes({ g }: { g: HoleStripGraphic }) {
  return (
    <>
      <div className="fr-holes keep-grid" aria-hidden="true">
        {g.cells.map((c) => (
          <div key={c.hole} className={`fr-hole fr-t-${holeTone(c.overPar)}`}>
            <span className="fr-hole-n">{c.hole}</span>
            <b>{c.figure || "–"}</b>
            <span className="fr-hole-p">par {c.par}</span>
          </div>
        ))}
      </div>
      <p className="fr-key" aria-hidden="true">
        <span className="fr-key-w">
          <span className="fr-hole fr-t-under fr-key-i" /> under par on average
        </span>
        <span className="fr-key-w">
          <span className="fr-hole fr-t-level fr-key-i" /> level
        </span>
        <span className="fr-key-w">
          <span className="fr-hole fr-t-over fr-key-i" /> over par
        </span>
        <span className="fr-key-w">{g.cards} cards, gross</span>
      </p>
      <table className="fr-mini fr-sr fr-gtable">
        <caption>Average gross against par, each hole</caption>
        <thead>
          <tr>
            <th scope="col">Hole</th>
            <th scope="col">Par</th>
            <th scope="col">Average</th>
            <th scope="col">Against par</th>
          </tr>
        </thead>
        <tbody>
          {g.cells.map((c) => (
            <tr key={c.hole}>
              <td>{c.hole}</td>
              <td>{c.par}</td>
              <td>{c.average || "–"}</td>
              <td>{c.figure || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Points({ g }: { g: PointsGraphic }) {
  return (
    <>
      <ol className="fr-bars" aria-hidden="true">
        {g.rows.map((r, i) => (
          <li key={`${r.name}-${i}`} className={i === 0 ? "fr-bar-lead" : undefined}>
            <span className="fr-bar-pl">{r.place}</span>
            <span className="fr-bar-nm">{r.name}</span>
            <span className="fr-bar-track">
              <i style={{ width: `${Math.max(4, (r.points / g.most) * 100)}%` }} />
            </span>
            <b className="fr-bar-fig">{r.points}</b>
          </li>
        ))}
      </ol>
      <table className="fr-mini fr-sr fr-gtable">
        <caption>The points</caption>
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Player</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r, i) => (
            <tr key={`${r.name}-${i}`}>
              <td>{r.place}</td>
              <td>{r.name}</td>
              <td>{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ------------------------------------------------------------------------ */

/** A hole's score drawn the way a scorecard marks it: a ring for a birdie, two for an eagle, a box for a bogey. */
function scoreShape(toPar: number | null): string {
  if (toPar === null) return "fr-s-none";
  if (toPar <= -2) return "fr-s-eagle";
  if (toPar === -1) return "fr-s-birdie";
  if (toPar === 0) return "fr-s-par";
  if (toPar === 1) return "fr-s-bogey";
  return "fr-s-double";
}

function initials(names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of names) {
    let k = 1;
    let key = n.slice(0, k);
    while ([...out.values()].includes(key) && k < n.length) key = n.slice(0, ++k);
    out.set(n, key);
  }
  return out;
}

function Side({ g }: { g: SideGraphic }) {
  const keys = initials(g.counted.map((c) => c.name));
  return (
    <>
      <div className="fr-holes keep-grid" aria-hidden="true">
        {g.holes.map((h) => (
          <div key={h.hole} className="fr-hole fr-t-level">
            <span className="fr-hole-n">{h.hole}</span>
            <b className={`fr-s ${scoreShape(h.toPar)}`}>{h.score ?? "–"}</b>
            <span className="fr-hole-p">{h.by === BOTH ? "both" : h.by ? keys.get(h.by) : `par ${h.par}`}</span>
          </div>
        ))}
      </div>
      <p className="fr-key" aria-hidden="true">
        {g.counted.map((c) => (
          <span key={c.name} className="fr-key-w">
            <b>{keys.get(c.name)}</b> {c.name}
          </span>
        ))}
        <span className="fr-key-w">
          <b className="fr-s fr-s-birdie">3</b> under par
        </span>
        <span className="fr-key-w">
          <b className="fr-s fr-s-bogey">5</b> over par · {g.basis}
        </span>
      </p>
      <table className="fr-mini fr-sr fr-gtable">
        <caption>The winning card</caption>
        <thead>
          <tr>
            <th scope="col">Hole</th>
            <th scope="col">Par</th>
            <th scope="col">Score</th>
            {g.counted.length > 0 && <th scope="col">Ball counted</th>}
          </tr>
        </thead>
        <tbody>
          {g.holes.map((h) => (
            <tr key={h.hole}>
              <td>{h.hole}</td>
              <td>{h.par}</td>
              <td>{h.score ?? "–"}</td>
              {g.counted.length > 0 && <td>{h.by}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Path({ g }: { g: PathGraphic }) {
  return (
    <ol className="fr-path">
      {g.steps.map((s, i) => (
        <li key={i}>
          <span className="fr-path-r">{s.round}</span>
          <span className="fr-path-w">
            beat <b>{s.opponent}</b>
            {s.margin && <span className="fr-chip">{s.margin.trim()}</span>}
            {s.upset && <span className="fr-upset">a higher seed</span>}
          </span>
        </li>
      ))}
      <li className="fr-path-end">
        <span className="fr-path-r">Champion</span>
        <span className="fr-path-w">
          <b>{g.champion}</b>
        </span>
      </li>
    </ol>
  );
}

/* ------------------------------------------------------------------------ */

function Weeks({ g }: { g: WeeksGraphic }) {
  return (
    <div className="fr-board-wrap" role="region" aria-label="The table, week by week" tabIndex={0}>
      <table className="fr-board fr-weeks">
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Player</th>
            <th scope="col">Weeks</th>
            <th scope="col">Played</th>
            <th scope="col">{g.unit}</th>
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r, i) => (
            <tr key={`${r.name}-${i}`}>
              <td>{r.place}</td>
              <td>{r.name}</td>
              <td
                className="fr-dots"
                aria-label={g.columns.map((c, w) => `${c} ${r.weeks[w] ? "played" : "missed"}`).join(", ")}
              >
                {r.weeks.map((w, k) => (
                  <i key={k} className={w ? "fr-dot-on" : "fr-dot-off"} aria-hidden="true" />
                ))}
              </td>
              <td className="fr-figs">{r.played}</td>
              {/* The figure, and the last week's move beside it — ▲ up, ▼ down: a shape, not a colour. */}
              <td className="fr-figs">
                {r.points}
                {r.move !== 0 && (
                  <span className="fr-move">
                    {" "}
                    <span aria-hidden="true">{r.move > 0 ? `▲${r.move}` : `▼${-r.move}`}</span>
                    <span className="fr-sr">{moveWords(r.move)}</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fr-key" aria-hidden="true">
        <span className="fr-key-w">
          <i className="fr-dot-on" /> played that week
        </span>
        <span className="fr-key-w">
          <i className="fr-dot-off" /> missed it
        </span>
        <span className="fr-key-w">▲▼ places moved in the last week</span>
      </p>
    </div>
  );
}
