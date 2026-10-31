"use client";
import { Fragment } from "react";
import type React from "react";
import { PrintStamp } from "./PrintStamp";
import { holeNumber, startHoleNumber } from "@/lib/domain/hole-number";
import { indexFigure } from "@/lib/domain/handicap-label";
import {
  CARD_MM,
  FOLDOUT_MM,
  PAPER_MM,
  SHEET_SLOTS,
  cardName,
  sideMembersLine,
  twoUp,
  type PaperSize,
  type SheetStatus,
} from "@/lib/domain/print-kit";
import type {
  CupPage,
  KitCard,
  KitCode,
  KitPage,
  PrintKit,
  ScorecardPage,
  SignPage,
  SlipPage,
  SparePage,
  StartPage,
} from "@/lib/services/print-kit";

/**
 * THE ONE RENDERER: every sheet the Print kit prints, as the paper it will be.
 *
 * THE NORMAL SCORECARD (panel ruling, 30 Oct 2026 — Ajay: "any card is the card
 * size"). Every card is 9.5 × 3.75 in (241.3 × 95.25 mm), landscape, two to a
 * sheet of US Letter or A4 with crop marks and a cut line, so a club's card is the
 * same in every country and goes in a back pocket and a {cart}'s clip. The ONLY
 * exception is where a normal card genuinely cannot hold the content
 * (`cardFormat`, X1–X3): a card twice as tall that folds once to the normal card,
 * never smaller type. `e2e/print-kit-fits.spec.ts` measures every card at print
 * size and fails on anything outside its safe box, clipped, or under 7 pt.
 *
 * Paper first: black on white, one condensed face from disk (Oswald, the
 * scoreboard's — so the browser measures the face that prints), strokes as solid
 * dots, the club's theme colour nowhere. The CLUB heads every card; TourneyHQ is
 * one 7 pt line at the foot pointing at `/play`, never near the scoring area.
 *
 * A client component because the sheets are laid out from what is ticked: two
 * cards to a sheet means "print only the out-of-date ones" is a different set of
 * sheets, not the same sheets with some hidden.
 */
export function PrintPages({ kit, chosen, paper }: { kit: PrintKit; chosen: ReadonlySet<string>; paper: PaperSize }) {
  const card = kit.card;
  if (!card) return null;
  const status = new Map(kit.statuses.map((s) => [s.key, s]));
  const slots = SHEET_SLOTS[paper];
  const sheets: React.ReactNode[] = [];

  for (const d of kit.docs) {
    if (d.unavailable) continue;
    const mine = d.pages.filter((p) => chosen.has(p.key));
    if (mine.length === 0) continue;
    if (d.kind === "start") {
      for (const p of mine as StartPage[]) {
        sheets.push(
          <section key={p.key} className="pk-sheet pk-portrait" data-sheet="page" data-paper={paper}>
            <StartingSheet p={p} kit={kit} status={status.get(p.key)} />
            <Calibration portrait />
          </section>,
        );
      }
      continue;
    }
    const normal = mine.filter((p) => p.format === "card");
    const folded = mine.filter((p) => p.format === "fold-out");
    twoUp(normal).forEach(([top, bottom], i) => {
      sheets.push(
        <section key={`${d.kind}-${i}`} className="pk-sheet pk-landscape" data-sheet="cards" data-paper={paper}>
          <CropMarks slots={slots} count={bottom ? 2 : 1} />
          <Calibration />
          {[top, bottom].map((p, slot) =>
            p ? (
              <Card key={p.key} page={p} top={slots.cards[slot]} left={slots.x} height={CARD_MM.h}>
                <Body page={p} kit={kit} card={card} status={status.get(p.key)} />
              </Card>
            ) : null,
          )}
        </section>,
      );
    });
    for (const p of folded) {
      sheets.push(
        <section key={p.key} className="pk-sheet pk-landscape" data-sheet="fold-out" data-paper={paper}>
          <FoldMarks slots={slots} />
          <Calibration />
          <Card page={p} top={slots.foldout} left={slots.x} height={FOLDOUT_MM.h}>
            <Body page={p} kit={kit} card={card} status={status.get(p.key)} />
          </Card>
        </section>,
      );
    }
  }

  const { w, h } = PAPER_MM[paper];
  return (
    <div id="pk-pages" className="pk-pages" style={{ ["--pk-w" as string]: `${w}mm`, ["--pk-h" as string]: `${h}mm` }}>
      {/* eslint-disable-next-line @typescript-eslint/no-use-before-define -- read at render, long after the module loaded */}
      <style>{PAPER_RULES}</style>
      {sheets}
    </div>
  );
}

/** One card, at its slot on the sheet: the trim (with a hairline to cut on) and its safe box 4 mm inside. */
function Card({ page, top, left, height, children }: { page: KitPage; top: number; left: number; height: number; children: React.ReactNode }) {
  return (
    <article
      className={`pk-card${page.format === "fold-out" ? " pk-foldout" : ""}`}
      data-card={page.format}
      data-doc={page.doc}
      data-key={page.key}
      aria-label={page.label}
      style={{ top: `${top}mm`, left: `${left}mm`, height: `${height}mm` }}
    >
      {children}
    </article>
  );
}

function Body({ page, kit, card, status }: { page: KitPage; kit: PrintKit; card: KitCard; status?: SheetStatus }) {
  const foot = <Foot status={status} groupsAsOf={kit.groupsAsOf} host={kit.host} />;
  switch (page.doc) {
    case "cards":
      return <Scorecard p={page} kit={kit} card={card} foot={foot} />;
    case "cup":
      return <CupCard p={page} kit={kit} card={card} foot={foot} />;
    case "slips":
      return <ResultSlip p={page} kit={kit} card={card} foot={foot} />;
    case "signs":
      return <CartSign p={page} kit={kit} card={card} foot={foot} />;
    case "spare":
      return <SpareSign p={page} kit={kit} card={card} foot={foot} />;
    default:
      return null;
  }
}

/* ── The marks a pair of scissors needs ────────────────────────────────── */

/**
 * CROP MARKS (0.25 pt, 5 mm long, 2 mm off the trim) where the margin is 7 mm or
 * more — the side margins, for the horizontal cuts — and the shared cut through
 * the gutter as a dashed line marked "cut". No ink within 5 mm of the paper's
 * edge: home printers do not print there.
 */
function CropMarks({ slots, count }: { slots: (typeof SHEET_SLOTS)[PaperSize]; count: 1 | 2 }) {
  const edges = [slots.cards[0], slots.cards[0] + CARD_MM.h, ...(count === 2 ? [slots.cards[1], slots.cards[1] + CARD_MM.h] : [])];
  const right = slots.x + CARD_MM.w;
  const gutter = count === 2 ? (slots.cards[0] + CARD_MM.h + slots.cards[1]) / 2 : null;
  return (
    <div className="pk-marks" aria-hidden="true">
      {edges.map((y) => (
        <Fragment key={y}>
          <i className="pk-crop" style={{ top: `${y}mm`, left: `${slots.x - 7}mm` }} />
          <i className="pk-crop" style={{ top: `${y}mm`, left: `${right + 2}mm` }} />
        </Fragment>
      ))}
      {gutter !== null && (
        <>
          <i className="pk-gutter" style={{ top: `${gutter}mm`, left: `${slots.x}mm`, width: `${CARD_MM.w}mm` }} />
          <span className="pk-cutword" style={{ top: `${gutter - 1.5}mm`, left: `${right + 2}mm` }}>
            cut
          </span>
        </>
      )}
    </div>
  );
}

/** A fold-out's marks: its two cuts, and its fold — which is drawn on the card itself. */
function FoldMarks({ slots }: { slots: (typeof SHEET_SLOTS)[PaperSize] }) {
  const right = slots.x + CARD_MM.w;
  return (
    <div className="pk-marks" aria-hidden="true">
      {[slots.foldout, slots.foldout + FOLDOUT_MM.h].map((y) => (
        <Fragment key={y}>
          <i className="pk-crop" style={{ top: `${y}mm`, left: `${slots.x - 7}mm` }} />
          <i className="pk-crop" style={{ top: `${y}mm`, left: `${right + 2}mm` }} />
        </Fragment>
      ))}
    </div>
  );
}

/** THE CALIBRATION LINE: 50 mm to measure, on every sheet, in the margin. */
function Calibration({ portrait = false }: { portrait?: boolean }) {
  return (
    <div className={portrait ? "pk-cal pk-cal-across" : "pk-cal"} aria-hidden="true">
      <i className="pk-cal-line" />
      <span className="pk-cal-words">50 mm / 1.97 in: measure this if the cards come out the wrong size</span>
    </div>
  );
}

function Foot({ status, groupsAsOf, host }: { status?: SheetStatus; groupsAsOf: string; host: string }) {
  return (
    <footer className="pk-foot">
      <PrintStamp sheetKey={status?.key ?? ""} nextVersion={status?.nextVersion ?? 1} groupsAsOf={groupsAsOf} />
      {/* The one line of ours on a club's paper, and it points at /play — never at the front door. */}
      <span className="pk-brand">Scored live with TourneyHQ · {host}/play</span>
    </footer>
  );
}

/* ── The header strip every card shares ────────────────────────────────── */

/** Event 11 pt, down to 8 pt, at most two lines: the size is chosen by length, and the test measures it. */
const eventSize = (s: string) => (s.length <= 46 ? 11 : s.length <= 64 ? 9.5 : 8);
/** Club 9 pt bold, down to 7 pt, at most two lines. */
const clubSize = (s: string) => (s.length <= 30 ? 9 : s.length <= 44 ? 8 : 7);

function Head({ kit, card, start, sub }: { kit: PrintKit; card: KitCard; start: string; sub: string }) {
  const club = card.clubName || kit.club.name;
  return (
    <header className="pk-head">
      <div className="pk-club">
        {card.clubLogoUrl ? (
          // An arbitrary external host or the app's own logo route: a plain <img>.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.clubLogoUrl} alt={club} className="pk-logo" />
        ) : (
          <span className="pk-clubname" style={{ fontSize: `${clubSize(club)}pt` }}>
            {club}
          </span>
        )}
      </div>
      <div className="pk-title">
        <div className="pk-event" style={{ fontSize: `${eventSize(card.eventName)}pt` }}>
          {card.eventName}
        </div>
        {sub && <div className="pk-sub">{sub}</div>}
      </div>
      {start ? <div className="pk-start">{start}</div> : <div />}
    </header>
  );
}

const subOf = (card: KitCard, extra = "") => [card.roundLabel, card.dates, card.courseName, extra].filter(Boolean).join(" · ");

/* ── A. The scorecard ──────────────────────────────────────────────────── */

type Col = { kind: "hole"; i: number } | { kind: "total"; label: "Out" | "In" | "Tot"; idx: number[] } | { kind: "last"; label: "Net" | "Pts" };

/** The columns of a real card: 1–9, Out, 10–18, In, Tot, then Net or Pts. A nine has no "In" to fill. */
function columnsFor(holes: number, points: boolean): Col[] {
  const nums = Array.from({ length: holes }, (_, i) => i);
  const last: Col = { kind: "last", label: points ? "Pts" : "Net" };
  if (holes <= 9) return [...nums.map((i) => ({ kind: "hole" as const, i })), { kind: "total", label: "Tot", idx: nums }, last];
  const front = nums.slice(0, 9);
  const back = nums.slice(9);
  return [
    ...front.map((i) => ({ kind: "hole" as const, i })),
    { kind: "total", label: "Out", idx: front },
    ...back.map((i) => ({ kind: "hole" as const, i })),
    { kind: "total", label: "In", idx: back },
    { kind: "total", label: "Tot", idx: nums },
    last,
  ];
}

/** Names 10 pt, stepping down to 8 pt to fit one line; past that the initial and the surname. */
const NAME_CHARS = 30;
function NameText({ name, max = NAME_CHARS }: { name: string; max?: number }) {
  const shown = cardName(name, max);
  return (
    <span className="pk-name" style={{ fontSize: shown.length <= 22 ? "10pt" : "8pt" }} title={shown === name ? undefined : name}>
      {shown}
    </span>
  );
}

const dots = (n: number) => (n > 0 ? "•".repeat(n) : "");

function startWords(card: KitCard, g: { startHole: number; half?: string; time: string }): string {
  const n = startHoleNumber(g.startHole, card.firstHole);
  return card.startStyle === "tee" ? [`Tee ${n}`, g.time].filter(Boolean).join(" · ") : `Starts: Hole ${n}${g.half ?? ""}`;
}

/** The rows a scorecard carries, in order — a player, a four-ball side's best ball, a shared ball. */
type CardRow =
  | { kind: "player"; p: ScorecardPage["group"]["players"][number] }
  | { kind: "side"; name: string; best: number }
  | { kind: "shared"; name: string; members: string[]; playing: number; shots: number[] };

function rowsOf(p: ScorecardPage, card: KitCard): CardRow[] {
  const team = card.teamRound;
  const players = p.group.players;
  if (p.unit === "side" && team?.sharedBall) {
    const sideName = players[0]?.sideName ?? "";
    const side = card.sides.find((s) => s.name === sideName);
    return [{ kind: "shared", name: sideName, members: players.map((x) => x.name), playing: side?.playingHandicap ?? 0, shots: side?.shots ?? [] }];
  }
  const rows: CardRow[] = players.map((x) => ({ kind: "player", p: x }));
  if (p.unit === "side") rows.push({ kind: "side", name: players[0]?.sideName ?? "", best: team?.countBest ?? 1 });
  return rows;
}

function Scorecard({ p, kit, card, foot }: { p: ScorecardPage; kit: PrintKit; card: KitCard; foot: React.ReactNode }) {
  const rows = rowsOf(p, card);
  const fold = p.format === "fold-out";
  // X3: a shared ball whose players do not fit two lines lists them on the lower panel.
  const sharedFold = fold && rows[0]?.kind === "shared";
  const panels = sharedFold ? [rows, [] as CardRow[]] : fold ? [rows.slice(0, 4), rows.slice(4)] : [rows];
  const sigs = p.unit === "player" ? (["Marker", "Player"] as const) : (["Scorer", "Attested"] as const);
  const head = <Head kit={kit} card={card} start={startWords(card, p.group)} sub={subOf(card, p.unit === "group" ? p.group.name : "")} />;
  const panel = (rs: CardRow[], last: boolean) => (
    <>
      {rs.length > 0 && <Grid card={card} rows={rs} membersBelow={sharedFold} />}
      {last && sharedFold && rows[0].kind === "shared" && (
        <ul className="pk-memberlist">
          {rows[0].members.map((m) => (
            <li key={m}>{cardName(m, 60)}</li>
          ))}
        </ul>
      )}
      {last && (
        <>
          <div className="pk-sigs">
            {sigs.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
          {p.signNote && <div className="pk-note">{p.signNote}</div>}
        </>
      )}
    </>
  );
  if (!fold) {
    return (
      <div className="pk-safe">
        {head}
        {panel(panels[0], true)}
        {foot}
      </div>
    );
  }
  return (
    <div className="pk-safe">
      <div className="pk-panel">
        {head}
        {panel(panels[0], false)}
      </div>
      <Fold />
      <div className="pk-panel">
        <div className="pk-cont">{p.label} — continued</div>
        {panel(panels[1], true)}
        {foot}
      </div>
    </div>
  );
}

function Fold() {
  return (
    <div className="pk-fold" aria-hidden="true">
      <span>fold</span>
    </div>
  );
}

function Grid({ card, rows, membersBelow = false }: { card: KitCard; rows: CardRow[]; membersBelow?: boolean }) {
  const cols = columnsFor(card.holes, card.points);
  const box = card.holes <= 9 ? 14 : 8.5;
  const sum = (arr: number[], idx: number[]) => idx.reduce((s, i) => s + (arr[i] ?? 0), 0);
  const yards = card.yards.some((y) => y > 0);
  const headRow = (label: string, cls: string, cell: (c: Col) => React.ReactNode) => (
    <tr className={cls}>
      <th className="pk-namecol">{label}</th>
      {cols.map((c, i) => (
        <th key={i} className={c.kind === "hole" ? "" : "pk-tot"}>
          {cell(c)}
        </th>
      ))}
    </tr>
  );
  return (
    <table className="pk-grid">
      <colgroup>
        <col style={{ width: "40mm" }} />
        {cols.map((_, i) => (
          <col key={i} style={{ width: `${box}mm` }} />
        ))}
      </colgroup>
      <thead>
        {headRow("Hole", "pk-r-hole", (c) => (c.kind === "hole" ? holeNumber(c.i, card.firstHole) : c.label))}
        {yards && headRow("Yds", "pk-r-yds", (c) => (c.kind === "hole" ? card.yards[c.i] || "" : c.kind === "total" ? sum(card.yards, c.idx) || "" : ""))}
        {headRow("Par", "pk-r-par", (c) => (c.kind === "hole" ? card.pars[c.i] ?? "" : c.kind === "total" ? sum(card.pars, c.idx) || "" : ""))}
        {headRow("S.I.", "pk-r-si", (c) => (c.kind === "hole" ? card.strokeIndex[c.i] ?? "" : ""))}
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className={r.kind === "shared" ? "pk-r-shared" : r.kind === "side" ? "pk-r-side" : "pk-r-player"}>
            <td className="pk-namecol">
              {r.kind === "player" ? (
                <>
                  <NameText name={r.p.name} />
                  <span className="pk-fig">
                    {r.p.unconfirmed
                      ? "To be confirmed"
                      : `CH ${indexFigure(r.p.courseHandicap ?? 0)} · PH ${indexFigure(r.p.playingHandicap ?? 0)}${r.p.tee ? ` · ${r.p.tee}` : ""}`}
                  </span>
                </>
              ) : r.kind === "side" ? (
                <>
                  <span className="pk-name" style={{ fontSize: "8pt" }}>
                    Side — best {r.best}
                  </span>
                  <span className="pk-fig">{cardName(r.name, 40)} · for the Committee</span>
                </>
              ) : (
                <>
                  <span className="pk-name" style={{ fontSize: r.name.length <= 22 ? "10pt" : "8pt" }}>
                    {cardName(r.name, NAME_CHARS)}
                  </span>
                  <span className="pk-members">
                    {membersBelow ? "Players: below the fold" : sideMembersLine(r.members)} · PH {indexFigure(r.playing)}
                  </span>
                </>
              )}
            </td>
            {cols.map((c, i) => {
              if (c.kind !== "hole") return <td key={i} className="pk-tot" />;
              const n = r.kind === "player" ? (r.p.unconfirmed ? 0 : r.p.shots?.[c.i] ?? 0) : r.kind === "shared" ? r.shots[c.i] ?? 0 : 0;
              return (
                <td key={i} className="pk-box">
                  {n > 0 && <span className="pk-dot">{dots(n)}</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── E. The cup match card ─────────────────────────────────────────────── */

function CupCard({ p, kit, card, foot }: { p: CupPage; kit: PrintKit; card: KitCard; foot: React.ReactNode }) {
  const c = p.cup;
  const fold = p.format === "fold-out";
  // One format on the card: its name rides in the header, so the grid gets the room (the ruling's E budget).
  const head = <Head kit={kit} card={card} start={[c.start, c.time].filter(Boolean).join(" · ")} sub={fold ? c.matchLabel : [c.matchLabel, c.sections[0]?.title].filter(Boolean).join(" · ")} />;
  const section = (s: CupPage["cup"]["sections"][number], last: boolean) => (
    <>
      {fold && <div className="pk-section">{s.title}</div>}
      <CupGrid c={c} s={s} />
      {last && (
        <div className="pk-sigs">
          <span>Signed for {c.sideNames[0]}</span>
          <span>Signed for {c.sideNames[1]}</span>
        </div>
      )}
    </>
  );
  if (!fold) {
    return (
      <div className="pk-safe">
        {head}
        {section(c.sections[0], true)}
        {foot}
      </div>
    );
  }
  return (
    <div className="pk-safe">
      <div className="pk-panel">
        {head}
        {section(c.sections[0], false)}
      </div>
      <Fold />
      <div className="pk-panel">
        {c.sections.slice(1).map((s, i, all) => (
          <Fragment key={s.title}>{section(s, i === all.length - 1)}</Fragment>
        ))}
        {foot}
      </div>
    </div>
  );
}

function CupGrid({ c, s }: { c: CupPage["cup"]; s: CupPage["cup"]["sections"][number] }) {
  const holes = s.holes;
  const box = holes.length <= 9 ? 14 : 8.5;
  const yards = holes.some((h) => (c.yards[h] ?? 0) > 0);
  // A four-ball's match is written in its Result column; singles keep their match row.
  const fourBall = s.matches.some((m) => m.rows.some((r) => r.kind === "side"));
  const rows = s.matches.flatMap((m) => m.rows.filter((r) => !(fourBall && r.kind === "match")));
  const headRow = (label: string, cls: string, cell: (h: number) => React.ReactNode) => (
    <tr className={cls}>
      <th className="pk-namecol">{label}</th>
      {holes.map((h) => (
        <th key={h}>{cell(h)}</th>
      ))}
      <th className="pk-tot">{label === "Hole" ? "Result" : ""}</th>
    </tr>
  );
  return (
    <table className="pk-grid pk-cupgrid">
      <colgroup>
        <col style={{ width: "40mm" }} />
        {holes.map((h) => (
          <col key={h} style={{ width: `${box}mm` }} />
        ))}
        <col style={{ width: "18mm" }} />
      </colgroup>
      <thead>
        {headRow("Hole", "pk-r-hole", (h) => h)}
        {yards && headRow("Yds", "pk-r-yds", (h) => c.yards[h] || "")}
        {headRow("Par", "pk-r-par", (h) => c.pars[h] || "")}
        {headRow("S.I.", "pk-r-si", (h) => c.strokeIndex[h] || "")}
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.kind === "player" ? "pk-r-cup" : "pk-r-cup pk-r-side"}>
            <td className="pk-namecol">
              {/* One line in a 7 mm row: the strokes are the dots (off the low), as on Ajay's own cup card. */}
              <span className="pk-name" style={{ fontSize: r.kind === "player" && cardName(r.name, 34).length <= 24 ? "9pt" : "8pt" }}>
                {cardName(r.name, 34)}
              </span>
            </td>
            {holes.map((h) => (
              <td key={h} className="pk-box">
                {r.kind === "player" && (r.shots[h] ?? 0) > 0 && <span className="pk-dot">{dots(r.shots[h])}</span>}
              </td>
            ))}
            <td className="pk-tot" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── D. The match result slip ──────────────────────────────────────────── */

function ResultSlip({ p, kit, card, foot }: { p: SlipPage; kit: PrintKit; card: KitCard; foot: React.ReactNode }) {
  const s = p.slip;
  return (
    <div className="pk-safe">
      <Head kit={kit} card={card} start={[s.start, s.time].filter(Boolean).join(" · ")} sub={subOf(card)} />
      <div className="pk-matchlabel">{s.matchLabel}</div>
      <div className="pk-meta">{[s.format, s.start, s.time].filter(Boolean).join(" · ")}</div>
      <div className="pk-sides">
        {s.sides.map((side) => (
          <div key={side.name} className="pk-side">
            <div className="pk-sidename">{cardName(side.name, 40)}</div>
            {side.players.length > 1 || side.players[0] !== side.name ? <div className="pk-sideplayers">{side.players.map((x) => cardName(x, 30)).join(" & ")}</div> : null}
            <div className="pk-sidestrokes">{side.strokes}</div>
          </div>
        ))}
      </div>
      <div className="pk-fill">
        <span>Won by</span>
        <span>Result (3&amp;2, 1 up, halved)</span>
      </div>
      <div className="pk-sigs">
        {s.sides.map((side) => (
          <span key={side.name}>Signed for {cardName(side.name, 30)}</span>
        ))}
      </div>
      {foot}
    </div>
  );
}

/* ── B. The {cart} sign ────────────────────────────────────────────────── */

function Qr({ code, mm }: { code: KitCode; mm: number }) {
  return (
    <svg
      viewBox={`0 0 ${code.qr.size} ${code.qr.size}`}
      role="img"
      aria-label={`QR code for ${code.label}`}
      shapeRendering="crispEdges"
      className="pk-qr"
      data-link={code.link}
      style={{ width: `${mm}mm`, height: `${mm}mm` }}
    >
      <rect width={code.qr.size} height={code.qr.size} fill="#fff" />
      <path d={code.qr.d} fill="#000" />
    </svg>
  );
}

function CartSign({ p, kit, card, foot }: { p: SignPage; kit: PrintKit; card: KitCard; foot: React.ReactNode }) {
  const s = p.sign;
  const riders = new Set(s.riders);
  const two = s.codes.length > 1;
  return (
    <div className="pk-safe pk-signcard">
      <div className="pk-signleft">
        <div className="pk-sub">{[card.clubName || kit.club.name, card.eventName, card.roundLabel].filter(Boolean).join(" · ")}</div>
        <div className="pk-signtop">
          <span className="pk-cart">{s.cartName || s.groupName}</span>
          <span className="pk-startbox">{[s.start, s.time].filter(Boolean).join(" · ")}</span>
        </div>
        {s.cartName && <div className="pk-meta">{s.groupName}</div>}
        <ul className="pk-riders">
          {s.players.map((x) => (
            <li key={x.name}>
              <span className={riders.size === 0 || riders.has(x.name) ? "pk-rider pk-on" : "pk-rider"}>{cardName(x.name, 40)}</span>
              <span className="pk-strokes">
                {x.playing === "to be confirmed" ? "PH to be confirmed" : `PH ${x.playing}`}
                {x.strokes.map((n) => ` · strokes ${n.label.replace("Holes ", "")}: ${n.holes}`).join("")}
                {x.note ? ` · ${x.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="pk-job">{s.scorerJob}</p>
      </div>
      {s.codes.length > 0 && (
        <div className={two ? "pk-signright pk-two" : "pk-signright"}>
          {s.codes.map((c) => (
            <div key={c.code} className="pk-codeblock">
              <Qr code={c} mm={two ? 32 : 40} />
              <div className={two ? "pk-code pk-code-split" : "pk-code"} data-code="">
                {two ? (
                  <>
                    {c.code.split("-")[0]}
                    <br />
                    {c.code.split("-")[1] ?? ""}
                  </>
                ) : (
                  c.code
                )}
              </div>
              {!two && (
                <div className="pk-url" data-code="">
                  {s.host}/play#{c.code}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="pk-signfoot">{foot}</div>
    </div>
  );
}

/* ── C. The spare sign ─────────────────────────────────────────────────── */

function SpareSign({ p, kit, card, foot }: { p: SparePage; kit: PrintKit; card: KitCard; foot: React.ReactNode }) {
  const s = p.spare;
  return (
    <div className="pk-safe pk-sparecard" role="group" aria-label={`Sign for ${s.roundName}`} data-link={s.code.link}>
      <Qr code={s.code} mm={60} />
      <div className="pk-spareright">
        <div className="pk-sub">{[card.clubName || kit.club.name, card.eventName].filter(Boolean).join(" · ")}</div>
        <div className="pk-round">{s.roundName}</div>
        <div className="pk-scan">Scan to enter your score</div>
        <div className="pk-code pk-code-big" data-code="">
          {s.code.code}
        </div>
        <div className="pk-nocam">
          No camera? <span data-code="">{s.host}/play</span> and type the code
        </div>
      </div>
      <div className="pk-signfoot">{foot}</div>
    </div>
  );
}

/* ── X4. The starting sheet: a full page, read standing ────────────────── */

const figureClass = (playing: string) => (/^\+?-?\d+$/.test(playing) ? "pk-figure" : "pk-figure pk-tbc");

function StartingSheet({ p, kit, status }: { p: StartPage; kit: PrintKit; status?: SheetStatus }) {
  const s = p.start;
  const card = kit.card!;
  return (
    <div className="pk-startpage" role="group" data-doc="start" data-key={p.key} aria-label={p.label}>
      <header className="pk-starthead">
        <div className="pk-clubname" style={{ fontSize: "14pt" }}>
          {card.clubName || kit.club.name}
        </div>
        <h2 className="pk-startevent">{card.eventName}</h2>
        <div className="pk-startsub">{subOf(card)}</div>
      </header>
      <div className="pk-startrow">
        <span className="pk-startbig">Starting sheet</span>
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
            <th>On the tee</th>
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
              <td className="pk-tick" />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pk-startfoot">
        <Foot status={status} groupsAsOf={kit.groupsAsOf} host={kit.host} />
      </div>
    </div>
  );
}

/**
 * PAPER, IN PAPER'S UNITS. `--pk-w`/`--pk-h` are the sheet upright, from the
 * paper the hub is set to; the named pages turn it. Every size here is a floor
 * the fits test holds: nothing under 7 pt, a code at 40 pt, a QR at 30 mm.
 */
const PAPER_RULES = `
.pk-pages { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; overflow-x: auto; max-width: 100%; padding: 4px 4px 12px; }
.pk-sheet { position: relative; background: #fff; color: #000; flex: none; box-shadow: 0 1px 6px rgba(0,0,0,.35); overflow: hidden;
  font-family: var(--font-board, "Oswald Fallback"), sans-serif; font-size: 9pt; line-height: 1.3; font-weight: 400; }
/* Half a millimetre short of the sheet, so rounding never spills a sheet onto a second. */
.pk-landscape { width: calc(var(--pk-h, 297mm) - 0.5mm); height: calc(var(--pk-w, 210mm) - 0.5mm); }
.pk-portrait { width: calc(var(--pk-w, 210mm) - 0.5mm); height: calc(var(--pk-h, 297mm) - 0.5mm); }
.pk-card { position: absolute; width: ${CARD_MM.w}mm; box-sizing: border-box; border: 0.25pt solid #000; background: #fff; }
.pk-safe { position: absolute; inset: ${CARD_MM.safe}mm; overflow: hidden; display: flex; flex-direction: column; }
.pk-panel { height: calc(${CARD_MM.h}mm - ${2 * CARD_MM.safe}mm); display: flex; flex-direction: column; overflow: hidden; flex: none; }
/* The lower panel starts just under the fold: 3.5 mm, so the pair of panels fits the safe box exactly. */
.pk-foldout .pk-fold + .pk-panel { margin-top: 3.5mm; }
.pk-fold { flex: none; height: 0; border-top: 0.25pt dotted #000; position: relative; margin-top: ${CARD_MM.safe}mm; }
.pk-fold span { position: absolute; right: 0; top: -3.2mm; font-size: 7pt; }
.pk-cont { font-size: 7.5pt; margin-bottom: 1mm; }
.pk-marks i, .pk-marks span { position: absolute; }
.pk-crop { width: 5mm; height: 0; border-top: 0.25pt solid #000; }
.pk-gutter { height: 0; border-top: 0.25pt dashed #000; }
.pk-cutword { font-size: 7pt; }
.pk-cal { position: absolute; left: 8mm; top: 20mm; height: 50mm; width: 6mm; }
.pk-cal-line { position: absolute; left: 0; top: 0; height: 50mm; width: 0; border-left: 0.5pt solid #000; }
.pk-cal-words { position: absolute; left: 1.2mm; top: 0; width: 80mm; font-size: 7pt; transform-origin: 0 0; transform: rotate(90deg) translate(0, -4mm); white-space: nowrap; }
.pk-cal-across { left: 10mm; top: auto; bottom: 7mm; height: 4mm; width: 140mm; }
.pk-cal-across .pk-cal-line { width: 50mm; height: 0; border-left: 0; border-top: 0.5pt solid #000; }
.pk-cal-across .pk-cal-words { left: 52mm; top: -1.4mm; transform: none; }
/* The header strip: club left, the competition centred, the start boxed right. 13 mm. */
.pk-head { flex: none; height: 13mm; display: grid; grid-template-columns: 52mm minmax(0, 1fr) auto; gap: 3mm; align-items: center; overflow: hidden; }
.pk-club, .pk-title { min-width: 0; overflow: hidden; }
.pk-logo { display: block; height: 9mm; width: auto; max-width: 40mm; object-fit: contain; }
.pk-clubname { font-weight: 700; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3; }
.pk-event { font-weight: 700; text-align: center; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pk-sub { font-size: 7.5pt; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: clip; }
.pk-start { font-size: 16pt; font-weight: 700; border: 1pt solid #000; padding: 0.3mm 2mm; white-space: nowrap; line-height: 1.45; }
/* The grid. Columns in mm; rows at the ruling's heights. */
.pk-grid { flex: none; border-collapse: collapse; table-layout: fixed; width: max-content; margin-top: 0.8mm; }
.pk-grid th, .pk-grid td { border: 0.5pt solid #000; padding: 0; text-align: center; vertical-align: middle; overflow: hidden; white-space: nowrap; font-size: 9pt; line-height: 1.3; }
.pk-grid .pk-namecol { text-align: left; padding: 0 0.8mm; }
.pk-grid th { font-weight: 700; }
.pk-r-hole th { height: 5mm; }
.pk-r-yds th { height: 4mm; font-weight: 400; font-size: 7pt; }
.pk-r-par th { height: 5mm; }
.pk-r-si th { height: 4.5mm; font-weight: 400; font-size: 7.5pt; }
.pk-r-player td, .pk-r-side td { height: 8.5mm; }
.pk-r-shared td { height: 12mm; }
.pk-r-cup td { height: 7mm; }
.pk-r-side td.pk-namecol { background: #fff; }
.pk-tot { border-left-width: 1pt !important; }
.pk-box { position: relative; }
.pk-dot { position: absolute; top: 0.3mm; right: 0.5mm; font-size: 7pt; line-height: 1.3; letter-spacing: -0.3pt; }
.pk-name { display: block; font-weight: 700; white-space: nowrap; overflow: hidden; line-height: 1.3; }
.pk-fig { display: block; font-size: 7pt; white-space: nowrap; overflow: hidden; line-height: 1.3; margin-top: 0.4mm; }
.pk-members { display: block; font-size: 7.5pt; white-space: normal; line-height: 1.3; overflow: hidden; max-height: 6mm; }
.pk-memberlist { list-style: none; margin: 1mm 0 0; padding: 0; flex: none; columns: 2; column-gap: 6mm; }
.pk-memberlist li { font-size: 9pt; font-weight: 700; white-space: nowrap; overflow: hidden; }
.pk-section { flex: none; font-size: 8pt; font-weight: 700; margin-top: 0.6mm; white-space: nowrap; overflow: hidden; }
.pk-sigs { flex: none; display: flex; gap: 10mm; margin-top: 1mm; height: 7mm; }
.pk-sigs span { flex: 1 1 0; min-width: 0; border-bottom: 0.5pt solid #000; font-size: 7.5pt; display: flex; align-items: flex-end; padding-bottom: 0.4mm; white-space: nowrap; overflow: hidden; }
.pk-note { flex: none; font-size: 7pt; margin-top: 0.4mm; white-space: nowrap; overflow: hidden; }
.pk-foot { flex: none; margin-top: auto; display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; font-size: 7pt; line-height: 1.3; height: 3.4mm; overflow: hidden; }
.pk-foot > * { white-space: nowrap; overflow: hidden; min-width: 0; }
.pk-stamp { font-size: 7pt; }
.pk-brand { color: #555; font-size: 7pt; flex: none; }
/* D. The result slip. */
.pk-matchlabel { flex: none; font-size: 12pt; font-weight: 700; margin-top: 1mm; white-space: nowrap; overflow: hidden; }
.pk-meta { flex: none; font-size: 7.5pt; white-space: nowrap; overflow: hidden; }
.pk-sides { flex: none; display: grid; grid-template-columns: 110mm 110mm; gap: 3mm; margin-top: 1.5mm; }
.pk-side { border: 0.5pt solid #000; padding: 1mm 1.5mm; min-width: 0; overflow: hidden; height: 16mm; box-sizing: border-box; }
.pk-sidename { font-size: 11pt; font-weight: 700; white-space: nowrap; overflow: hidden; }
.pk-sideplayers { font-size: 9pt; white-space: nowrap; overflow: hidden; }
.pk-sidestrokes { font-size: 8pt; white-space: nowrap; overflow: hidden; }
.pk-fill { flex: none; display: flex; gap: 10mm; margin-top: 2mm; height: 8mm; }
.pk-fill span { flex: 1 1 0; border-bottom: 0.5pt solid #000; font-size: 7.5pt; display: flex; align-items: flex-end; padding-bottom: 0.4mm; }
/* B. The sign: names and strokes left, the code right. */
.pk-signcard { display: grid; grid-template-columns: 140mm 90mm; grid-template-rows: minmax(0, 1fr) auto; column-gap: 3mm; }
.pk-signleft { min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
.pk-signleft .pk-sub { text-align: left; white-space: normal; max-height: 7.2mm; }
.pk-signtop { display: flex; gap: 4mm; align-items: center; margin-top: 0.8mm; flex: none; }
.pk-cart { font-size: 18pt; font-weight: 700; white-space: nowrap; overflow: hidden; min-width: 0; line-height: 1.45; }
.pk-startbox { font-size: 18pt; font-weight: 700; border: 1pt solid #000; padding: 0 2mm; white-space: nowrap; line-height: 1.45; flex: none; }
.pk-riders { list-style: none; margin: 1.2mm 0 0; padding: 0; flex: none; }
.pk-riders li { margin-bottom: 0.8mm; }
.pk-rider { display: block; font-size: 11pt; white-space: nowrap; overflow: hidden; line-height: 1.3; }
.pk-rider.pk-on { font-weight: 700; }
.pk-strokes { display: block; font-size: 7.5pt; line-height: 1.3; overflow: hidden; max-height: 5.6mm; }
.pk-job { font-size: 8pt; margin: 0.8mm 0 0; line-height: 1.3; overflow: hidden; max-height: 7.5mm; flex: none; }
.pk-signright { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; min-width: 0; overflow: hidden; }
.pk-signright.pk-two { flex-direction: row; justify-content: space-between; align-items: flex-start; }
.pk-codeblock { display: flex; flex-direction: column; align-items: center; min-width: 0; }
.pk-qr { display: block; flex: none; }
.pk-code { font-family: var(--font-geist-mono), ui-monospace, monospace; font-size: 40pt; font-weight: 700; line-height: 1.3; letter-spacing: 0.02em; white-space: nowrap; margin-top: 0.5mm; }
.pk-code-split { text-align: center; }
.pk-code-big { font-size: 48pt; }
.pk-url { font-family: var(--font-geist-mono), ui-monospace, monospace; font-size: 8pt; white-space: nowrap; margin-top: 0.6mm; }
.pk-signfoot { grid-column: 1 / -1; display: flex; flex-direction: column; }
/* C. The spare sign. */
.pk-sparecard { display: grid; grid-template-columns: 60mm minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; column-gap: 6mm; align-items: start; }
.pk-spareright { min-width: 0; overflow: hidden; display: flex; flex-direction: column; gap: 1mm; }
.pk-spareright .pk-sub { text-align: left; white-space: normal; max-height: 7.2mm; }
.pk-round { font-size: 18pt; font-weight: 700; white-space: nowrap; overflow: hidden; line-height: 1.45; }
.pk-scan { font-size: 14pt; font-weight: 700; line-height: 1.45; }
.pk-nocam { font-size: 9pt; }
/* X4. The starting sheet, a full page (its type rule is the old one: names 12 pt, nothing under 10). */
.pk-startpage { position: absolute; inset: 10mm 12mm 12mm; display: flex; flex-direction: column; overflow: hidden; font-size: 10pt; line-height: 1.25; }
.pk-starthead { flex: none; margin-bottom: 3mm; }
.pk-startevent { font-family: inherit; font-size: 18pt; font-weight: 700; margin: 1mm 0 0; color: #000; overflow-wrap: anywhere; line-height: 1.3; }
.pk-startsub { font-size: 10pt; }
.pk-startrow { flex: none; display: flex; justify-content: space-between; align-items: baseline; margin: 1mm 0 2mm; }
.pk-startbig { font-size: 14pt; font-weight: 700; }
.pk-list { width: 100%; border-collapse: collapse; table-layout: fixed; }
.pk-list th, .pk-list td { border: 0.5pt solid #000; padding: 0.6mm 1mm; text-align: left; vertical-align: middle; font-size: 10pt; }
.pk-list th:nth-child(1), .pk-list th:nth-child(2) { width: 22mm; }
.pk-list th:nth-child(3) { width: 20mm; }
.pk-list th:nth-child(5) { width: 18mm; }
.pk-list th:nth-child(6) { width: 18mm; }
.pk-list th:nth-child(7) { width: 16mm; }
.pk-startname { font-size: 12pt !important; font-weight: 700; overflow-wrap: anywhere; }
.pk-list .pk-figure { text-align: center; font-size: 11pt; font-weight: 700; }
.pk-list .pk-figure.pk-tbc { font-size: 10pt; font-weight: 400; }
.pk-first td { border-top-width: 1.25pt; }
.pk-startfoot { margin-top: auto; padding-top: 2mm; flex: none; }
/*
 * ON PAPER, ONLY THE SHEETS — and in the normal flow, not lifted out of it with
 * a position: a sheet's own size and orientation (\`page: pk-landscape\`) and its
 * break are honoured only for a box in the document's flow.
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
  /* A break BEFORE each sheet, not after: a break after the last one would hand the printer a blank page. */
  .pk-sheet { box-shadow: none; margin: 0; break-before: page; break-inside: avoid; }
  .pk-portrait { page: pk-portrait; }
  .pk-landscape { page: pk-landscape; }
}
`;
