"use client";
import { toParText } from "@/lib/domain";
import { cardHeading } from "@/lib/domain/card-heading";
import { parseStroke, scoreMark } from "@/lib/domain/score-payload";

/**
 * A scorecard, the way a scorecard looks.
 *
 * Every hole, the reference rows a player checks against, and the totals — out,
 * in, and the whole round — with gross AND net side by side. There were two
 * grids in this app and neither had all of it: the organizer's showed yards,
 * par, stroke index and a gross total but never the shots a player receives or
 * the net they produce, and the player's card had no grid at all, only one
 * hole at a time. A player who wants to check their card against the paper one
 * could not.
 *
 * One component now, so the console and the phone print the same card. It
 * renders read-only by default and takes `onSet` to become editable, which is
 * the only real difference between the two uses.
 *
 * The shots row is the part worth having: dots on the holes where this player
 * gets a stroke, from the server's own allocation. A net figure with no
 * working shown is a number a player has to take on trust — and they will not.
 */

/**
 * The club's mark as a scorecard needs it: a name, a logo, an optional second
 * line, and nothing else.
 *
 * Declared here rather than importing `Brand` from OrgBrand, and exported so
 * every screen that puts a card on the page threads the same shape. `Brand`
 * also carries `monogram` and `showAttribution`, which belong to a sidebar mark
 * and mean nothing on a scorecard — taking the whole type would invite somebody
 * to render a TourneyHQ credit onto a club's card.
 */
export interface CardBrand {
  name: string;
  logoUrl?: string;
  secondary?: string;
}

/**
 * ONE HOLE ON A CARD — the box a score is read from or typed into.
 *
 * Exported because the match card in `ScoreEntryClient` is NOT this table and
 * should not be made into it. That grid holds two players against one set of
 * reference rows, which is what lets a match be read across; rendering it as
 * two `ScorecardTable`s would give it two headings, two Par rows, two S.I.
 * rows and two totals blocks, and the thing a referee actually does with it —
 * compare the two rows hole by hole — would be gone. Merging the TABLES would
 * be a worse card in service of a tidier file.
 *
 * The CELL is the part that was genuinely written twice, and the part that can
 * drift without anybody seeing: the class, the mark, the parse and the name a
 * screen reader is given. `scoreMark` and `parseStroke` already made two of
 * those one; this makes the other two one as well.
 *
 * The read-only branch is a `span` rather than a disabled input, deliberately.
 * A disabled input is skipped by screen readers and greyed by the browser, and
 * an approved card is not a broken form — it is a record.
 */
export function ScoreCell({
  hole,
  value,
  par,
  shots = 0,
  who = "",
  shotsFor = "",
  onSet,
}: {
  /** Zero-based, as the arrays are. The label says `hole + 1`. */
  hole: number;
  value: number | null;
  par?: number;
  /**
   * Strokes this player receives here, drawn in the corner.
   *
   * For a card with no Shots row of its own — the match grid, where two
   * players receive different numbers and a shared row could not say so.
   * `ScorecardTable` passes nothing and keeps its Shots row.
   */
  shots?: number;
  /** Named when one grid holds more than one player's row. */
  who?: string;
  /** What the shots tooltip calls the player — usually a short label. */
  shotsFor?: string;
  /** Provided when the card is being filled in rather than read. */
  onSet?: (value: number | null) => void;
}) {
  /**
   * The one name this control is given.
   *
   * A single-player card says "Hole 3, par 4" — its heading already says
   * whose card it is. A grid with two rows in it has to say which row, or a
   * screen reader hears eighteen identical boxes twice over.
   */
  const label = `${who ? `${who}, hole` : "Hole"} ${hole + 1}${par ? `, par ${par}` : ""}`;
  const mark = scoreMark(value, par);

  const dots =
    shots > 0 ? (
      <span
        /* HOW MANY, not merely that there are some. This printed one dot
           whatever the number, so a player receiving TWO shots on the
           stroke-index-1 hole — an ordinary twenty-shot difference — saw the
           same mark as somebody receiving one. */
        title={`${shotsFor || who || "This player"} receives ${shots} shot${shots === 1 ? "" : "s"} here`}
        style={{
          position: "absolute",
          top: 1,
          right: 3,
          color: "var(--color-accent)",
          fontSize: 11,
          lineHeight: 1,
          letterSpacing: -1,
        }}
      >
        {"•".repeat(shots)}
      </span>
    ) : null;

  if (!onSet) {
    return (
      <td style={{ padding: 2, position: "relative" }}>
        <span
          className={`sc-score${mark}`}
          aria-label={label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 30,
            minHeight: 30,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value ?? "–"}
        </span>
        {dots}
      </td>
    );
  }

  return (
    <td style={{ padding: 2, position: "relative" }}>
      <input
        className={`input sc-score${mark}`}
        inputMode="numeric"
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onSet(parseStroke(e.target.value))}
      />
      {dots}
    </td>
  );
}

const sum = (arr: Array<number | null | undefined>, from: number, to: number): number => {
  let total = 0;
  for (let i = from; i < to; i += 1) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
};

export function ScorecardTable({
  holes,
  pars,
  yards = [],
  strokeIndex = [],
  strokes,
  shotsPerHole = [],
  playingHandicap,
  onSet,
  scoreLabel = "Score",
  brand,
  courseName = "",
  venueIsHome = false,
}: {
  holes: number;
  pars: number[];
  yards?: number[];
  strokeIndex?: number[];
  strokes: (number | null)[];
  /** The club's mark, for the head of the card. Omit for an unbranded one. */
  brand?: CardBrand | null;
  /** The course this card is for. A scorecard is the COURSE's card, so this
   *  leads the heading — see `cardHeading`. */
  courseName?: string;
  /** Whether that course is the club's own. Then the club's mark alone heads
   *  the card, because it really is their card rather than a claim. */
  venueIsHome?: boolean;
  /** Handicap strokes per hole, from the server's allocation. */
  shotsPerHole?: number[];
  /** Shown beside the net total, so the number can be checked. */
  playingHandicap?: number;
  /** Provided when the card is being filled in rather than read. */
  onSet?: (hole: number, value: number | null) => void;
  scoreLabel?: string;
}) {
  /**
   * Whose name tops this card.
   *
   * One rule, in the domain, so the player's card on a phone and the
   * organizer's on the console cannot disagree about whose card it is.
   */
  const heading = cardHeading({
    courseName,
    clubName: brand?.name,
    clubSecondary: brand?.secondary,
    clubLogoUrl: brand?.logoUrl,
    venueIsHome,
  });

  const isEighteen = holes > 9;
  const front = Array.from({ length: Math.min(9, holes) }, (_, i) => i);
  const back = isEighteen ? Array.from({ length: holes - 9 }, (_, i) => i + 9) : [];

  const played = strokes.slice(0, holes).filter((s) => typeof s === "number" && s > 0).length;
  const gross = sum(strokes, 0, holes);
  // Par and strokes received over the holes actually PLAYED, so both mean
  // something through nine as well as eighteen — the same rule the board
  // totals by. Typed as numbers explicitly: the array holds nulls, and an
  // accumulator that can be null is an accumulator that will be.
  let parThru = 0;
  let received = 0;
  for (let i = 0; i < holes; i += 1) {
    const s = strokes[i];
    if (typeof s !== "number" || s <= 0) continue;
    parThru += pars[i] ?? 0;
    received += shotsPerHole[i] ?? 0;
  }
  const net = gross - Math.round(received);
  const hasShots = shotsPerHole.some((n) => (n ?? 0) > 0);
  const hasYards = yards.some((y) => typeof y === "number" && y > 0);
  const hasSi = strokeIndex.some((n) => typeof n === "number" && n > 0);

  /**
   * One hole, from the shared cell — see `ScoreCell` above.
   *
   * This used to be forty lines here and forty more in the match card, with
   * the mark, the parse and the screen-reader name written out in both. The
   * Shots row below is why nothing is passed for `shots`: a single-player
   * card has room to show the allocation on its own row, which is clearer
   * than a dot in the corner of a box.
   */
  const cell = (i: number) => (
    <ScoreCell
      key={i}
      hole={i}
      value={strokes[i] ?? null}
      par={pars[i]}
      onSet={onSet ? (v) => onSet(i, v) : undefined}
    />
  );

  return (
    <div>
      {/* The club's own mark, at the top of the card, the way it is at the top
          of the paper one.

          The app already carries a club's logo and name — the sidebar, the play
          shell and the reports all render them — and the scorecard, the screen
          that most wants to look like the club's own, was the one place that
          did not. A card with somebody else's branding on it is a form; a card
          with the club's badge is their card.

          Optional, and absent by default, so every existing caller renders
          exactly what it rendered before. Absent rather than falling back to
          the TourneyHQ mark: an unbranded card should look like plain paper,
          not like it belongs to us. `OrgBrand` does fall back that way, which
          is right in a sidebar and wrong here, so this does not use it.

          `logoUrl` points at an arbitrary external host, so a plain <img> —
          the same reason and the same exemption OrgBrand carries. */}
      {heading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 2px 10px",
            borderBottom: "1px solid var(--color-divider)",
            marginBottom: 10,
          }}
        >
          {/* The logo sits beside the CLUB name, wherever that ends up.
              When the course leads, a mark next to the course name reads as
              that course's mark, and it is the club's — so on somebody
              else's course it drops to the second line, with the club. */}
          {heading.logoUrl && !heading.leadIsCourse && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heading.logoUrl}
              alt=""
              style={{ height: 28, width: "auto", maxWidth: 120, objectFit: "contain", flex: "none" }}
            />
          )}
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontFamily: "var(--font-heading)",
                fontSize: 15,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {heading.primary}
            </span>
            {heading.secondary && (
              <span
                className="text-muted"
                style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}
              >
                {heading.logoUrl && heading.leadIsCourse && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={heading.logoUrl}
                    alt=""
                    style={{ height: 14, width: "auto", maxWidth: 44, objectFit: "contain", flex: "none" }}
                  />
                )}
                {heading.secondary}
              </span>
            )}
          </span>
        </div>
      )}
      <div className="sc-wrap">
        <table className="sc" style={{ minWidth: isEighteen ? 960 : 560 }}>
          <thead>
            <tr>
              <th>Hole</th>
              {front.map((i) => (<th key={i}>{i + 1}</th>))}
              {isEighteen && <th className="sc-tot">Out</th>}
              {back.map((i) => (<th key={i}>{i + 1}</th>))}
              {isEighteen && <th className="sc-tot">In</th>}
              <th className="sc-tot">Tot</th>
            </tr>
          </thead>
          <tbody>
            {hasYards && (
              <tr className="sc-ref">
                <td>Yards</td>
                {front.map((i) => (<td key={i}>{yards[i] ?? "-"}</td>))}
                {isEighteen && <td className="sc-tot">{sum(yards, 0, 9)}</td>}
                {back.map((i) => (<td key={i}>{yards[i] ?? "-"}</td>))}
                {isEighteen && <td className="sc-tot">{sum(yards, 9, holes)}</td>}
                <td className="sc-tot">{sum(yards, 0, holes)}</td>
              </tr>
            )}
            <tr className="sc-ref sc-par">
              <td>Par</td>
              {front.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot">{sum(pars, 0, 9)}</td>}
              {back.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot">{sum(pars, 9, holes)}</td>}
              <td className="sc-tot">{sum(pars, 0, holes)}</td>
            </tr>
            {hasSi && (
              <tr className="sc-ref">
                <td>S.I.</td>
                {front.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
                {isEighteen && <td className="sc-tot" />}
                {back.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
                {isEighteen && <td className="sc-tot" />}
                <td className="sc-tot" />
              </tr>
            )}
            {/* Where the shots fall. The working behind the net total, on the
                holes it actually happens. */}
            {hasShots && (
              <tr className="sc-ref">
                <td>Shots</td>
                {front.map((i) => (
                  <td key={i} style={{ color: "var(--color-accent-400)", fontWeight: 700 }}>
                    {shotsPerHole[i] ? "•".repeat(shotsPerHole[i]) : ""}
                  </td>
                ))}
                {isEighteen && <td className="sc-tot">{sum(shotsPerHole, 0, 9)}</td>}
                {back.map((i) => (
                  <td key={i} style={{ color: "var(--color-accent-400)", fontWeight: 700 }}>
                    {shotsPerHole[i] ? "•".repeat(shotsPerHole[i]) : ""}
                  </td>
                ))}
                {isEighteen && <td className="sc-tot">{sum(shotsPerHole, 9, holes)}</td>}
                <td className="sc-tot">{sum(shotsPerHole, 0, holes)}</td>
              </tr>
            )}
            <tr>
              <td>{scoreLabel}</td>
              {front.map((i) => cell(i))}
              {isEighteen && <td className="sc-tot">{sum(strokes, 0, 9) || "—"}</td>}
              {back.map((i) => cell(i))}
              {isEighteen && <td className="sc-tot">{sum(strokes, 9, holes) || "—"}</td>}
              <td className="sc-tot">{gross || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* The totals, spelled out. Gross and net together, because a card that
          shows one of them makes the player work the other out. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          marginTop: 10,
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Total label="Holes in" value={`${played} of ${holes}`} />
        <Total label="Gross" value={gross ? String(gross) : "—"} />
        {pars.length > 0 && (
          <Total label="To par" value={played ? toParText(gross - parThru) : "—"} />
        )}
        {hasShots && (
          <Total
            label="Net"
            value={gross ? String(net) : "—"}
            hint={
              playingHandicap != null
                ? `${gross || 0} gross less ${Math.round(received)} of a ${playingHandicap} playing handicap`
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

function Total({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <span title={hint}>
      <span className="text-muted" style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}{" "}
      </span>
      <strong style={{ fontSize: 15 }}>{value}</strong>
    </span>
  );
}
