import type React from "react";
import { TeeSheetPrint } from "@/components/TeeSheetPrint";
import { PrintStamp } from "./PrintStamp";
import { DOC_ORIENTATION, type DocKind, type SheetStatus } from "@/lib/domain/print-kit";
import type { CupPage, KitCode, KitPage, PrintKit, ScorecardPage, SignPage, SlipPage, SparePage, StartPage } from "@/lib/services/print-kit";

/**
 * THE ONE RENDERER: every sheet the Print kit prints, as the page it will be.
 *
 * Paper first (decision E): black on white, rules of at least half a point,
 * names at 14pt or more and nothing under 10pt but the one grey line of ours
 * at the foot; strokes as solid dots, never a colour; the club's theme colour
 * nowhere. The CLUB heads the page — its logo at full size, or its name in
 * type — and the competition is the headline. TourneyHQ is one small grey
 * line in the footer, pointing at `/play`, never near the scoring area.
 *
 * Each page is exactly a sheet of paper (`.pk-page`, sized from the paper the
 * hub is set to), so the preview IS the pages: what is drawn here is what the
 * printer gets, one sheet each, nothing split across a break.
 */
export function PrintPages({ kit }: { kit: PrintKit }) {
  const card = kit.card;
  if (!card) return null;
  const status = new Map(kit.statuses.map((s) => [s.key, s]));
  const foot = (key: string) => <Footer status={status.get(key)} groupsAsOf={kit.groupsAsOf} host={kit.host} />;

  const scorecards = (pages: ScorecardPage[], named: boolean) =>
    pages.length === 0 ? null : (
      <TeeSheetPrint
        groups={pages.map((p) => p.group)}
        clubName={card.clubName}
        clubLogoUrl={card.clubLogoUrl}
        courseName={card.courseName}
        dates={card.dates}
        roundLabel={card.roundLabel}
        pars={card.pars}
        strokeIndex={card.strokeIndex}
        holes={card.holes}
        teamRound={card.teamRound}
        sides={card.sides}
        pins={card.pins}
        firstHole={card.firstHole}
        eventName={card.eventName}
        yards={card.yards}
        named={named}
        points={named && card.points}
        startStyle={card.startStyle}
        signNote={named ? pages[0].signNote : ""}
        wrap={(g, body) => {
          // The very object handed in, so two cards from one group are told apart.
          const page = pages.find((p) => p.group === g)!;
          return (
            <Page page={page} status={status.get(page.key)} footer={foot(page.key)}>
              {body}
            </Page>
          );
        }}
      />
    );

  const byDoc = (kind: DocKind) => kit.docs.find((d) => d.kind === kind)?.pages ?? [];
  const head = { clubName: kit.club.name, logoUrl: kit.club.logoUrl, eventName: kit.eventName, sub: [card.roundLabel, card.dates, card.courseName].filter(Boolean).join(" · ") };

  return (
    <div id="pk-pages" className="pk-pages">
      <style>{paperCss()}</style>
      {scorecards(byDoc("cards") as ScorecardPage[], true)}
      {(byDoc("cup") as CupPage[]).map((p) => (
        <Page key={p.key} page={p} status={status.get(p.key)} footer={foot(p.key)}>
          <Header {...head} />
          <CupCard p={p} />
        </Page>
      ))}
      {(byDoc("slips") as SlipPage[]).map((p) => (
        <Page key={p.key} page={p} status={status.get(p.key)} footer={foot(p.key)}>
          <Header {...head} />
          <ResultSlip p={p} />
        </Page>
      ))}
      {scorecards(byDoc("group-cards") as ScorecardPage[], false)}
      {(byDoc("signs") as SignPage[]).map((p) => (
        <Page key={p.key} page={p} status={status.get(p.key)} footer={foot(p.key)}>
          <Header {...head} />
          <CartSign p={p} />
        </Page>
      ))}
      {(byDoc("spare") as SparePage[]).map((p) => (
        <Page key={p.key} page={p} status={status.get(p.key)} footer={foot(p.key)}>
          <Header {...head} />
          <SpareSign p={p} />
        </Page>
      ))}
      {(byDoc("start") as StartPage[]).map((p) => (
        <Page key={p.key} page={p} status={status.get(p.key)} footer={foot(p.key)}>
          <Header {...head} />
          <StartingSheet p={p} />
        </Page>
      ))}
    </div>
  );
}

function Page({ page, status, footer, children }: { page: KitPage; status?: SheetStatus; footer: React.ReactNode; children: React.ReactNode }) {
  return (
    <section
      className={`pk-page pk-${DOC_ORIENTATION[page.doc]}`}
      data-doc={page.doc}
      data-key={page.key}
      data-stale={status?.state === "stale" ? "1" : undefined}
      aria-label={page.label}
    >
      <div className="pk-body">{children}</div>
      {footer}
    </section>
  );
}

function Footer({ status, groupsAsOf, host }: { status?: SheetStatus; groupsAsOf: string; host: string }) {
  return (
    <footer className="pk-foot">
      <PrintStamp sheetKey={status?.key ?? ""} nextVersion={status?.nextVersion ?? 1} groupsAsOf={groupsAsOf} />
      {/* The one line of ours on a club's paper, and it points at /play — never at the front door. */}
      <span className="pk-brand">Scored live with TourneyHQ · {host}/play</span>
    </footer>
  );
}

function Header({ clubName, logoUrl, eventName, sub }: { clubName: string; logoUrl: string; eventName: string; sub: string }) {
  return (
    <header className="pk-head">
      <div className="pk-club">
        {logoUrl ? (
          // An arbitrary external host or the app's own logo route: a plain <img>, as the cards use.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={clubName} className="club-logo" />
        ) : (
          <span className="pk-clubname">{clubName}</span>
        )}
      </div>
      <h2 className="pk-event">{eventName}</h2>
      {sub && <div className="pk-sub">{sub}</div>}
    </header>
  );
}

const dots = (n: number) => (n > 0 ? "•".repeat(n) : "");

/** A figure is printed large; the words for a figure the Committee has not confirmed are not a figure. */
const figureClass = (playing: string) => (/^\+?-?\d+$/.test(playing) ? "pk-figure" : "pk-figure pk-tbc");

function CupCard({ p }: { p: CupPage }) {
  const c = p.cup;
  return (
    <div className="pk-cup">
      <div className="pk-row">
        <strong className="pk-big">{c.matchLabel}</strong>
        <span>{[c.start, c.time].filter(Boolean).join(" · ")}</span>
      </div>
      <table className="pk-grid">
        <thead>
          <tr>
            <th className="pk-namecol">Hole</th>
            {c.columns.map((h) => (
              <th key={h}>{h}</th>
            ))}
            <th className="pk-result">Result</th>
          </tr>
          <tr>
            <th className="pk-namecol">Par</th>
            {c.columns.map((h) => (
              <th key={h}>{c.pars[h] || ""}</th>
            ))}
            <th />
          </tr>
          <tr>
            <th className="pk-namecol">S.I.</th>
            {c.columns.map((h) => (
              <th key={h}>{c.strokeIndex[h] || ""}</th>
            ))}
            <th />
          </tr>
          {Object.values(c.yards).some((y) => y > 0) && (
            <tr>
              <th className="pk-namecol">Yards</th>
              {c.columns.map((h) => (
                <th key={h} style={{ fontWeight: 400 }}>
                  {c.yards[h] || ""}
                </th>
              ))}
              <th />
            </tr>
          )}
        </thead>
        <tbody>
          {c.sections.map((s) => (
            <SectionRows key={s.title} s={s} columns={c.columns} />
          ))}
        </tbody>
      </table>
      <div className="pk-sigs">
        <span>Signed for {c.sideNames[0]}</span>
        <span>Signed for {c.sideNames[1]}</span>
      </div>
      <div className="pk-note">Strokes are off the lowest handicap in each match, marked as dots. Shaded holes are not played in that match.</div>
    </div>
  );
}

function SectionRows({ s, columns }: { s: CupPage["cup"]["sections"][number]; columns: number[] }) {
  const inSection = new Set(s.holes);
  return (
    <>
      <tr className="pk-section">
        <td colSpan={columns.length + 2}>{s.title}</td>
      </tr>
      {s.matches.flatMap((m) =>
        m.rows.map((r, i) => (
          <tr key={`${m.label}-${i}`} className={r.kind === "player" ? "" : "pk-siderow"}>
            <td className="pk-namecol">
              <span className={r.kind === "player" ? "pk-pname" : ""}>{r.name}</span>
              {r.note && <span className="pk-small"> · {r.note}</span>}
            </td>
            {columns.map((h) =>
              inSection.has(h) ? (
                <td key={h} className="pk-box">
                  {r.kind === "player" && <span className="pk-dot">{dots(r.shots[h] ?? 0)}</span>}
                </td>
              ) : (
                <td key={h} className="pk-off" />
              ),
            )}
            <td className="pk-result">{r.kind === "match" ? "" : ""}</td>
          </tr>
        )),
      )}
    </>
  );
}

function ResultSlip({ p }: { p: SlipPage }) {
  const s = p.slip;
  return (
    <div className="pk-slip">
      <div className="pk-big">{s.matchLabel}</div>
      <div className="pk-sub">{[s.format, s.start, s.time].filter(Boolean).join(" · ")}</div>
      {s.sides.map((side) => (
        <div key={side.name} className="pk-side">
          <div className="pk-pname">{side.name}</div>
          {side.players.length > 1 || side.players[0] !== side.name ? <div>{side.players.join(" & ")}</div> : null}
          <div className="pk-small">{side.strokes}</div>
        </div>
      ))}
      <div className="pk-fill">
        <span>Won by</span>
        <span>Result (e.g. 3&amp;2, 1 up, halved)</span>
      </div>
      <div className="pk-sigs">
        {s.sides.map((side) => (
          <span key={side.name}>Signed for {side.name}</span>
        ))}
      </div>
      <div className="pk-note">Match play needs no scorecard: agree the result, both sides sign, and hand this to the Committee.</div>
    </div>
  );
}

function Code({ code, host, large }: { code: KitCode; host: string; large: boolean }) {
  return (
    <div className="pk-code">
      <svg viewBox={`0 0 ${code.qr.size} ${code.qr.size}`} role="img" aria-label={`QR code for ${code.label}`} shapeRendering="crispEdges" className="pk-qr" data-link={code.link}>
        <rect width={code.qr.size} height={code.qr.size} fill="#fff" />
        <path d={code.qr.d} fill="#000" />
      </svg>
      <div>
        {large && <div className="pk-small">{code.label}</div>}
        <div className="pk-codetext" data-code="">
          {code.code}
        </div>
        <div className="pk-url" data-code="">
          {host}/play#{code.code}
        </div>
      </div>
    </div>
  );
}

function CartSign({ p }: { p: SignPage }) {
  const s = p.sign;
  return (
    <div className="pk-sign">
      <div className="pk-row">
        <span className="pk-big">{s.groupName}</span>
        <span className={s.startLarge ? "pk-startbig" : "pk-big"}>{[s.start, s.time].filter(Boolean).join(" · ")}</span>
      </div>
      <table className="pk-list">
        <thead>
          <tr>
            <th>Player</th>
            <th>Plays off</th>
            <th>Strokes received{s.players.some((x) => x.note) ? ` ${s.players.find((x) => x.note)?.note}` : ""}</th>
          </tr>
        </thead>
        <tbody>
          {s.players.map((x) => (
            <tr key={x.name}>
              <td>
                <span className="pk-pname">{x.name}</span>
                {x.tee && <div className="pk-small">{x.tee}</div>}
              </td>
              <td className={figureClass(x.playing)}>{x.playing}</td>
              <td>
                {x.strokes.length === 0
                  ? "—"
                  : x.strokes.map((n) => (
                      <div key={n.label}>
                        <span className="pk-small">{n.label}:</span> {n.holes}
                      </div>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pk-job">{s.scorerJob}</p>
      {s.codes.length > 0 && (
        <div className="pk-codes">
          {s.codes.map((c) => (
            <Code key={c.code} code={c} host={s.host} large={s.codes.length > 1} />
          ))}
        </div>
      )}
      {s.liveLine && (
        <div className="pk-small" data-code="">
          Follow the board: {s.liveLine}
        </div>
      )}
    </div>
  );
}

function SpareSign({ p }: { p: SparePage }) {
  const s = p.spare;
  return (
    <section className="round-sign pk-spare" aria-label={`Sign for ${s.roundName}`} data-link={s.code.link}>
      <div className="rs-round">{s.roundName}</div>
      <svg viewBox={`0 0 ${s.code.qr.size} ${s.code.qr.size}`} role="img" aria-label={`QR code for ${s.roundName}`} shapeRendering="crispEdges" className="pk-qr pk-qr-big" data-link={s.code.link}>
        <rect width={s.code.qr.size} height={s.code.qr.size} fill="#fff" />
        <path d={s.code.qr.d} fill="#000" />
      </svg>
      <div className="rs-scan">Scan to enter your score</div>
      <div className="pk-codetext" data-code="">
        {s.code.code}
      </div>
      <div className="rs-small">
        Then tap your own name. No camera? Go to <b>{s.host}/play</b> and type the code.
        {s.liveLine ? (
          <>
            <br />
            <span data-code="">Leaderboard: {s.liveLine}</span>
          </>
        ) : null}
      </div>
    </section>
  );
}

function StartingSheet({ p }: { p: StartPage }) {
  const s = p.start;
  return (
    <div className="pk-start">
      <div className="pk-row">
        <span className="pk-big">Starting sheet — {s.copy === "noticeboard" ? "for the noticeboard" : "for the starter"}</span>
        {s.parts > 1 && (
          <span>
            Page {s.part} of {s.parts}
          </span>
        )}
      </div>
      <table className="pk-list">
        <thead>
          <tr>
            <th>Time</th>
            <th>Start</th>
            <th>Group</th>
            <th>Player</th>
            <th>Plays off</th>
            <th>Tees</th>
            {s.copy === "starter" && <th>On the tee</th>}
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r, i) => (
            <tr key={i} className={r.first ? "pk-first" : ""}>
              <td>{r.first ? r.time : ""}</td>
              <td>{r.first ? r.start : ""}</td>
              <td>{r.first ? r.group : ""}</td>
              <td className="pk-startname">{r.name}</td>
              <td className={figureClass(r.playing)}>{r.playing}</td>
              <td>{r.tee}</td>
              {s.copy === "starter" && <td className="pk-tick" />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Paper, in paper's units. `--pk-w`/`--pk-h` are the sheet upright, set by the
 * hub from the paper it is set to; the two named pages turn it.
 */
function paperCss(): string {
  // Read when a page is drawn, long after the module has finished loading; kept at the
  // foot so the components read first.
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  return PAPER_RULES;
}

const PAPER_RULES = `
.pk-pages { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; overflow-x: auto; max-width: 100%; padding: 4px 4px 12px; }
.pk-page {
  background: #fff; color: #000; box-sizing: border-box; padding: 9mm 10mm 7mm;
  display: flex; flex-direction: column; overflow: hidden; flex: none;
  box-shadow: 0 1px 6px rgba(0,0,0,.35); font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.3;
}
/* Half a millimetre short of the sheet, so rounding never spills a page onto a second one. */
.pk-portrait { width: calc(var(--pk-w, 210mm) - 0.5mm); height: calc(var(--pk-h, 297mm) - 0.5mm); }
.pk-landscape { width: calc(var(--pk-h, 297mm) - 0.5mm); height: calc(var(--pk-w, 210mm) - 0.5mm); }
.pk-body { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.pk-foot { flex: none; display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; border-top: 0.5pt solid #000; padding-top: 1.5mm; margin-top: 2mm; font-size: 10pt; }
.pk-brand { color: #666; font-size: 7.5pt; white-space: nowrap; }
.pk-hidden-name { display: none; }
.pk-head { margin-bottom: 4mm; }
.pk-club { min-height: 8mm; }
.pk-page .club-logo { height: 16mm !important; width: auto !important; max-width: 70mm !important; object-fit: contain; display: block; }
.pk-clubname { font-size: 14pt; font-weight: 700; }
.pk-event { font-family: inherit; font-size: 20pt; font-weight: 800; margin: 1mm 0 0; line-height: 1.15; overflow-wrap: anywhere; color: #000; }
.pk-sub { font-size: 11pt; margin-top: 1mm; }
.pk-row { display: flex; justify-content: space-between; align-items: center; gap: 6mm; margin: 2mm 0 3mm; flex-wrap: wrap; }
.pk-big { font-size: 16pt; font-weight: 800; overflow-wrap: anywhere; }
.pk-startbig { font-size: 26pt; font-weight: 900; border: 1.5pt solid #000; padding: 1mm 4mm; }
.pk-small { font-size: 10pt; }
.pk-note { font-size: 10pt; margin-top: 3mm; }
.pk-pname { font-size: 14pt; font-weight: 700; overflow-wrap: anywhere; }
.pk-grid, .pk-list { width: 100%; border-collapse: collapse; table-layout: fixed; }
.pk-grid th, .pk-grid td, .pk-list th, .pk-list td { border: 0.75pt solid #000; padding: 1mm; text-align: center; vertical-align: middle; }
.pk-grid .pk-namecol { width: 64mm; text-align: left; line-height: 1.1; overflow-wrap: anywhere; }
/* A cup card carries two sessions on one sheet: everything a size tighter, nothing under the floors. */
.pk-page[data-doc="cup"] .pk-event { font-size: 16pt; }
.pk-page[data-doc="cup"] .club-logo { height: 11mm !important; }
.pk-page[data-doc="cup"] .pk-head { margin-bottom: 1mm; }
.pk-page[data-doc="cup"] .pk-row { margin: 1mm 0 2mm; }
.pk-page[data-doc="cup"] .pk-big { font-size: 14pt; }
.pk-cup .pk-grid th { padding: 0.5mm; height: 5mm; }
.pk-cup .pk-grid td { padding: 0.4mm 0.8mm; }
.pk-cup .pk-grid td.pk-box, .pk-cup .pk-grid td.pk-off { height: 6.5mm; }
.pk-cup .pk-section td { font-size: 10.5pt; padding: 0.6mm 1mm; }
.pk-cup .pk-sigs { margin-top: 3mm; }
.pk-cup .pk-sigs span { padding-bottom: 5mm; }
.pk-cup .pk-note { margin-top: 1.5mm; }
.pk-grid .pk-result { width: 18mm; }
.pk-grid td.pk-box { height: 9mm; position: relative; }
.pk-grid td.pk-off { background: #d9d9d9; }
.pk-dot { position: absolute; top: 0.4mm; right: 0.8mm; font-size: 11pt; line-height: 1; letter-spacing: -1px; }
.pk-section td { text-align: left; font-weight: 800; font-size: 11pt; border-top-width: 1.5pt; }
.pk-siderow td { font-weight: 700; }
.pk-list th { font-size: 10pt; text-align: left; }
.pk-list td { text-align: left; }
.pk-list .pk-figure { text-align: center; font-size: 14pt; font-weight: 700; width: 22mm; }
.pk-list th:nth-child(2) { width: 22mm; }
.pk-list .pk-figure.pk-tbc, .pk-start .pk-list .pk-figure.pk-tbc { font-size: 10pt; font-weight: 400; line-height: 1.15; }
.pk-start .pk-list th:nth-child(1), .pk-start .pk-list th:nth-child(2) { width: 18mm; }
.pk-start .pk-list th:nth-child(3) { width: 20mm; }
.pk-start .pk-list th:nth-child(6) { width: 22mm; }
.pk-start .pk-list th:nth-child(7) { width: 18mm; }
.pk-start .pk-list td { padding: 0.8mm 1mm; }
.pk-start .pk-startname { font-size: 12pt; font-weight: 700; overflow-wrap: anywhere; }
.pk-start .pk-list .pk-figure { font-size: 11pt; }
.pk-first td { border-top-width: 1.5pt; }
.pk-sigs { display: flex; gap: 10mm; margin-top: 6mm; }
.pk-sigs span { flex: 1 1 0; min-width: 0; border-bottom: 0.75pt solid #000; padding-bottom: 7mm; font-size: 10pt; }
.pk-slip .pk-side { border: 0.75pt solid #000; padding: 3mm; margin: 3mm 0; }
.pk-fill { display: flex; gap: 10mm; margin-top: 8mm; }
.pk-fill span { flex: 1 1 0; border-bottom: 0.75pt solid #000; padding-bottom: 8mm; }
.pk-job { font-size: 11pt; margin: 4mm 0; }
.pk-codes { display: flex; flex-direction: column; gap: 4mm; }
.pk-code { display: flex; align-items: center; gap: 6mm; }
.pk-qr { width: 40mm; height: 40mm; flex: none; display: block; }
.pk-qr-big { width: 70mm; height: 70mm; }
.pk-codetext { font-family: "DejaVu Sans Mono", Consolas, "Courier New", ui-monospace, monospace; font-size: 40pt; font-weight: 700; letter-spacing: 0.06em; line-height: 1.1; }
.pk-url { font-size: 11pt; font-family: "DejaVu Sans Mono", Consolas, "Courier New", ui-monospace, monospace; }
.pk-spare { display: flex; flex-direction: column; align-items: center; gap: 5mm; text-align: center; padding-top: 6mm; }
.pk-spare .rs-round { font-size: 24pt; font-weight: 800; }
.pk-spare .rs-scan { font-size: 16pt; font-weight: 700; }
.pk-spare .rs-small { font-size: 11pt; max-width: 120mm; }
/* The cards the Tee sheet drew, set in paper's sizes. */
.pk-page .foursome-card { padding: 0; border-radius: 0; margin: 0; }
.pk-page .foursome-card table { font-size: 10pt; table-layout: fixed; }
.pk-page .foursome-card th, .pk-page .foursome-card td { border-width: 0.75pt; border-color: #000; padding: 1mm 0.5mm; }
.pk-page .foursome-card td:first-child, .pk-page .foursome-card th:first-child { width: 58mm; min-width: 0; }
.pk-page .foursome-card tbody td:first-child { font-size: 14pt; overflow-wrap: anywhere; }
.pk-page .foursome-card td span, .pk-page .foursome-card td div { font-size: 10pt !important; opacity: 1 !important; }
.pk-page .foursome-card td .pname { font-size: 14pt !important; }
.pk-page .foursome-card td .shot { font-size: 11pt !important; }
.pk-page .foursome-card .grid { overflow: visible; }
.pk-page .foursome-card .card-headline { font-size: 20pt; }
.pk-page .foursome-card .sigs, .pk-page .foursome-card .note { font-size: 10pt; }
.pk-page .foursome-card .result { font-size: 10pt; opacity: 1; }
.pk-page .foursome-card .pointsRow td:first-child { font-size: 10pt; }
/*
 * ON PAPER, ONLY THE PAGES — and in the normal flow, not lifted out of it with
 * a position: a page's own size and orientation (\`page: pk-landscape\`) and its
 * break are honoured only for a box in the document's flow. So everything that
 * is not the pages or on the way to them is taken out, and the boxes on the way
 * are flattened to nothing.
 */
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body *:not(:has(#pk-pages)):not(#pk-pages):not(#pk-pages *) { display: none !important; }
  body *:has(#pk-pages) {
    display: block !important; position: static !important; margin: 0 !important; padding: 0 !important;
    border: 0 !important; box-shadow: none !important; width: auto !important; max-width: none !important;
    min-height: 0 !important; height: auto !important; overflow: visible !important; background: #fff !important;
  }
  #pk-pages { display: block; overflow: visible; padding: 0; gap: 0; max-width: none; }
  /* A wrapper of cards is no box of its own: an empty one between two named pages would be a blank sheet. */
  #pk-pages .foursome-cards { display: contents !important; }
  /* A break BEFORE each sheet, not after: a break after the last one would hand the printer a blank page. */
  .pk-page { box-shadow: none; margin: 0; break-before: page; break-inside: avoid; }
  .pk-portrait { page: pk-portrait; }
  .pk-landscape { page: pk-landscape; }
}
`;
