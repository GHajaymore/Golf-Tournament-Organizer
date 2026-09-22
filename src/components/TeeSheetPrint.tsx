"use client";
import { indexLabel } from "@/lib/domain/handicap-label";
import { Fragment, useState } from "react";
import { Icon } from "./Icon";

export interface PrintGroup {
  name: string;
  startHole: number;
  half?: "A" | "B";
  time: string;
  /**
   * Each player with the tee they are playing from.
   *
   * `tee` is the name resolved by the round the card belongs to, so a
   * single-tee competition prints the same set beside every name and a mixed
   * field prints each player their own. Empty when the course has no rated
   * tees, in which case the card says nothing rather than inventing a set.
   */
  players: Array<{
    name: string;
    handicap: number;
    handicapType?: string | null;
    handicapSource?: string | null;
    tee?: string;
    /**
     * The side they play for on a team round, by name; empty otherwise.
     *
     * The card groups its rows by this, so two pairs in one four-ball print as
     * two blocks rather than as four names in draw order — which is the whole
     * difference between a card a side can use and a list of who was there.
     */
    sideName?: string;
    /**
     * What they play off, after the round's allowance — the number that goes
     * in the Hcp box. Not the index beside the name, which is the figure they
     * carry between clubs.
     */
    playingHandicap?: number;
    /**
     * Shots received per hole, in hole order, from the round's own allocation.
     *
     * Computed on the server through the same chain the round is scored on so
     * the paper cannot disagree with the screen — see the note where it is
     * built in `foursomes/page.tsx`. Absent for a caller that has not been
     * taught, in which case the card prints boxes and no dots, exactly as it
     * did before.
     */
    shots?: number[];
  }>;
}

/** One side of a team round, as the card needs it. */
export interface PrintSide {
  name: string;
  /** The side's own number, allowance already applied — what a shared ball
   *  plays off, and what `singleBallTeamCard` scores it against. */
  playingHandicap: number;
  /** The side's shots per hole, in hole order. */
  shots: number[];
}

/** What kind of team round this is, or null on an individual one. */
export interface PrintTeamRound {
  format: string;
  /** The allowance in force, as a percentage. */
  allowance: number;
  /** One ball between the side (foursomes, a scramble) rather than one each. */
  sharedBall: boolean;
  /** How many partners' scores count on a hole, where they each play a ball. */
  countBest: number;
}

/**
 * Printed scorecards, one per foursome, straight from the saved sheet.
 *
 * This is the scorecard-printing merge: the sheet of record already knows
 * who plays together, from which tee, at what time — so the card each group
 * carries to the first tee is generated from it rather than assembled by
 * hand. Header carries club, course and date, because a card without its
 * provenance is a page of numbers; body carries par and stroke index so net
 * strokes can be marked where they fall.
 *
 * Print isolation is the classic visibility trick: on screen this renders a
 * button and nothing else; on paper, only the cards exist. Each card breaks
 * to its own page — a foursome shares one card, not half of someone else's.
 */
export function TeeSheetPrint({
  groups,
  clubName,
  clubLogoUrl = "",
  courseName,
  dates,
  roundLabel,
  pars,
  strokeIndex,
  holes,
  teamRound = null,
  sides = [],
}: {
  groups: PrintGroup[];
  clubName: string;
  /** The club's logo, printed beside its name. Empty for a club that has not
   *  set one, in which case the name alone heads the card — the same rule the
   *  on-screen card follows, and no TourneyHQ mark on a club's paper. */
  clubLogoUrl?: string;
  courseName: string;
  dates: string;
  roundLabel: string;
  pars: number[];
  strokeIndex: number[];
  holes: number;
  teamRound?: PrintTeamRound | null;
  sides?: PrintSide[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const all = selected.size === 0;
  const printable = all ? groups : groups.filter((g) => selected.has(g.name));
  const nums = Array.from({ length: holes }, (_, i) => i);
  if (groups.length === 0) return null;

  /**
   * THE COLUMNS OF A REAL SCORECARD, which break at the turn.
   *
   * This printed one flat strip of eighteen boxes and a "Tot" — a grid, not a
   * card. Ajay, 2026-09-22: "printed cards should looks like the actual score
   * cards." Every club card in the world runs 1-9, OUT, 10-18, IN, TOT, and a
   * player adds up the front nine at the turn while the group waits on the
   * tenth tee. A card with nowhere to write that number is a card they will
   * write it on anyway, in the margin.
   *
   * Built as a spec rather than three hand-written rows, so the header, the
   * par line, the stroke index and every player row cannot disagree about
   * which column is which — the fault that puts a score in the wrong box.
   *
   * A NINE-HOLE ROUND GETS ONE BLOCK AND NO "IN", because there is no back
   * nine to total: its OUT is the total, and printing an empty IN beside it
   * invites somebody to fill it in. `holes` is 9 or 18 (see `holesPlayed`).
   */
  const FRONT = nums.slice(0, 9);
  const BACK = nums.slice(9);
  const sumPars = (idx: number[]) => idx.reduce((s, i) => s + (pars[i] ?? 0), 0);
  type Col =
    | { kind: "hole"; i: number }
    | { kind: "total"; label: "OUT" | "IN" | "TOT"; par: number };
  const cols: Col[] = [
    ...FRONT.map((i) => ({ kind: "hole" as const, i })),
    { kind: "total" as const, label: "OUT" as const, par: sumPars(FRONT) },
    ...(BACK.length
      ? [
          ...BACK.map((i) => ({ kind: "hole" as const, i })),
          { kind: "total" as const, label: "IN" as const, par: sumPars(BACK) },
          { kind: "total" as const, label: "TOT" as const, par: sumPars(nums) },
        ]
      : []),
  ];

  const sideByName = new Map(sides.map((s) => [s.name, s]));

  /**
   * The group's players in blocks, one block per side.
   *
   * Draw order is who tees off when; it is not who is partnered with whom, and
   * a four-ball card printed in draw order can interleave two sides. Grouping
   * here keeps a side's rows together and gives the side row something to sit
   * under. On an individual round every player falls in one nameless block,
   * which renders exactly as it did before there were sides at all.
   */
  const blocksOf = (g: PrintGroup) => {
    const order: string[] = [];
    const by = new Map<string, PrintGroup["players"]>();
    for (const p of g.players) {
      const key = teamRound ? (p.sideName ?? "") : "";
      if (!by.has(key)) {
        by.set(key, []);
        order.push(key);
      }
      by.get(key)!.push(p);
    }
    return order.map((name) => ({
      name,
      side: name ? sideByName.get(name) : undefined,
      players: by.get(name)!,
    }));
  };

  /** What the side is doing with the scores, in the words a player needs on
   *  the tee. No percentage on a shared ball: a scramble's side handicap comes
   *  from a descending share of each member's, not from one figure, so naming
   *  a percentage there would be stating something untrue. */
  const termsLine = !teamRound
    ? ""
    : teamRound.sharedBall
      ? `${teamRound.format} — one ball between the side`
      : `${teamRound.format} — best ${teamRound.countBest} score${
          teamRound.countBest === 1 ? "" : "s"
        } on each hole · ${teamRound.allowance}% handicap`;

  return (
    <>
      <div
        /**
         * NAMED, so something can link to it.
         *
         * Reports offers "Scorecards — open printable scorecards for the
         * field" and sent an organizer to `/foursomes`, which is headed "Tee
         * sheet" and opens on "Re-draw this sheet". The print button was on
         * the page and below the fold, under the pairing editor. Ajay,
         * 2026-09-22: "when I click on the print scorecards on the reports
         * menu, it takes me to teesheet and not the actual scorecards".
         *
         * The redirect itself is right and stays — one print control, not two
         * producing different groupings; see `app/(app)/scorecard/page.tsx`.
         * What was missing is a way to land ON it.
         *
         * `scrollMarginTop` because the console header is sticky and an anchor
         * without it parks the target underneath.
         */
        id="print-scorecards"
        style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12, scrollMarginTop: 80 }}
      >
        <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
          <Icon name="cards" /> Print scorecards
          {all ? " (all groups)" : ` (${selected.size} selected)`}
        </button>
        <span className="text-muted" style={{ fontSize: 12 }}>
          One card per group, from the saved sheet.
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {groups.map((g) => (
            <label key={g.name} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={selected.has(g.name)}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.name)) next.delete(g.name);
                    else next.add(g.name);
                    return next;
                  })
                }
              />
              {g.name}
            </label>
          ))}
        </div>
      </div>

      <style>{`
        /**
         * THE CARDS ARE ON SCREEN NOW, and that is the fix.
         *
         * They were display:none here and visible only on paper, so the app
         * had nowhere you could LOOK at a scorecard: "Scorecards" on Reports
         * gave you a button that opens the browser's print dialog, and the
         * only way to see what would come out was to print it. Ajay,
         * 2026-09-22, twice: "it takes me to the teesheet and not the actual
         * scorecards to print for players to use on the course."
         *
         * Drawn as paper rather than as app furniture — white, black text, the
         * same ruled table — because the question being asked is "what will
         * come out of the printer", and a card restyled for a dark ground
         * would answer a different one. That is also why these rules sit
         * OUTSIDE the print block now: one set of styles, so the preview
         * cannot drift from the page.
         */
        .foursome-card {
          background: #fff;
          color: #000;
          padding: 24px;
          border-radius: 10px;
          margin-bottom: 12px;
        }
        .foursome-card table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .foursome-card th, .foursome-card td { border: 1px solid #333; padding: 4px 3px; text-align: center; }
        .foursome-card td:first-child, .foursome-card th:first-child { text-align: left; min-width: 110px; }
        /* OUT, IN, TOT, Hcp and Net read as totals rather than as another
           hole — shaded and ruled heavier, the way a club card prints them.
           Grey rather than a tint, because this is going on white paper and
           a colour is one more thing a club's printer can render badly. */
        .foursome-card .tot { background: #ececec; font-weight: 700; border-left-width: 2px; }
        /* The side's own line, shaded so the eye finds it under its players. */
        .foursome-card .sideRow td { background: #f4f4f4; }
        .foursome-card .sideRow td:first-child { font-size: 10.5px; }
        /* A signature is a line to write on, not a box to score in — and it
           goes UNDER the grid, as it does on a real card. It was briefly a row
           inside the table, where the colSpan arithmetic squeezed "Player's
           signature" into one narrow mid-table cell. */
        .foursome-card .sigs {
          display: flex; gap: 28px; margin-top: 14px; font-size: 10px;
        }
        .foursome-card .sigs span {
          flex: 1 1 0; min-width: 0; border-bottom: 1px solid #333; padding-bottom: 16px;
        }
        /* The grid is wider than a phone. It scrolls in its own box so the
           page never goes sideways — the rule everything wide here follows —
           and the header, the signatures and the club's name stay put. */
        .foursome-card .grid { overflow-x: auto; }
        /* The shot dots sit in the corner of the box, out of the way of the
           figure somebody writes in it — the same placement as the entry
           screen, so the paper and the phone read alike. Black, because this
           is printed and an accent colour is one more thing a club's printer
           renders badly or not at all. */
        .foursome-card .box { position: relative; }
        .foursome-card .shot {
          position: absolute; top: 0; right: 2px;
          font-size: 9px; line-height: 1; letter-spacing: -1px; color: #000;
        }

        /* Wide on a phone, so it scrolls in its own box rather than taking the
           page sideways — the rule everything wide in this app follows. */
        #foursome-cards { overflow-x: auto; }

        @media print {
          body * { visibility: hidden; }
          #foursome-cards, #foursome-cards * { visibility: visible; }
          #foursome-cards { display: block; position: absolute; left: 0; top: 0; width: 100%; overflow: visible; }
          /* Paper needs no rounding, no gap and one card per sheet. */
          .foursome-card { page-break-after: always; border-radius: 0; margin-bottom: 0; }
        }
      `}</style>

      <div id="foursome-cards">
        {printable.map((g) => (
          <div key={g.name} className="foursome-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {/* The club's own badge on the card its members carry round.
                    An arbitrary external host, so a plain <img> — the same
                    reason and the same exemption the on-screen card carries. */}
                {clubLogoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={clubLogoUrl}
                    alt=""
                    style={{ height: 30, width: "auto", maxWidth: 110, objectFit: "contain" }}
                  />
                )}
                <strong style={{ fontSize: 16 }}>{clubName || courseName}</strong>
              </span>
              <span style={{ fontSize: 12 }}>{[courseName, dates].filter(Boolean).join(" · ")}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 10 }}>
              <span>
                {roundLabel} — {g.name}
              </span>
              <span>
                Hole {g.startHole}
                {g.half ?? ""} · {g.time}
              </span>
            </div>
            {/* WHAT IS BEING PLAYED. A card that does not say changes how the
                hole is played and says nothing about it — best-ball-one-of-four
                and best-two-of-four are different games on the same paper. */}
            {termsLine && (
              <div style={{ fontSize: 11, marginTop: -6, marginBottom: 10, fontWeight: 600 }}>
                {termsLine}
              </div>
            )}
            <div className="grid">
            <table>
              <thead>
                <tr>
                  <th>Hole</th>
                  {cols.map((c) =>
                    c.kind === "hole" ? (
                      <th key={`h${c.i}`}>{c.i + 1}</th>
                    ) : (
                      <th key={c.label} className="tot">
                        {c.label}
                      </th>
                    ),
                  )}
                  {/* Where the medal is actually decided, and a card without
                      them is one somebody works out on the back. */}
                  <th className="tot">Hcp</th>
                  <th className="tot">Net</th>
                </tr>
                <tr>
                  <th>Par</th>
                  {cols.map((c) =>
                    c.kind === "hole" ? (
                      <th key={`p${c.i}`}>{pars[c.i] ?? ""}</th>
                    ) : (
                      <th key={c.label} className="tot">
                        {c.par || ""}
                      </th>
                    ),
                  )}
                  <th className="tot" />
                  <th className="tot" />
                </tr>
                <tr>
                  <th>S.I.</th>
                  {cols.map((c) =>
                    c.kind === "hole" ? (
                      <th key={`s${c.i}`}>{strokeIndex[c.i] ?? ""}</th>
                    ) : (
                      // A stroke index has no total — the column is there to
                      // keep the grid square, not to be added up.
                      <th key={c.label} className="tot" />
                    ),
                  )}
                  <th className="tot" />
                  <th className="tot" />
                </tr>
              </thead>
              <tbody>
                {blocksOf(g).map((b, bi) => {
                  /**
                   * ONE BALL, ONE ROW. `sharesOneCard` says the side shares a
                   * single scorecard rather than one card each, and this
                   * printed a row of boxes per player anyway — three of them
                   * unwritable, each beside a handicap the side does not play
                   * off. The side's own number and its own strokes go here
                   * instead, allocated exactly as `singleBallTeamCard` does.
                   */
                  if (teamRound?.sharedBall && b.side) {
                    const side = b.side;
                    const members = b.players.map((p) => p.name).join(" & ");
                    return (
                      <tr key={`s${bi}`} className="sideRow" style={{ height: 34 }}>
                        <td>
                          <strong>{side.name}</strong>
                          {members !== side.name && (
                            <div style={{ fontSize: 8.5, opacity: 0.75 }}>{members}</div>
                          )}
                        </td>
                        {cols.map((c) => {
                          if (c.kind !== "hole") return <td key={c.label} className="tot" />;
                          const n = side.shots[c.i] ?? 0;
                          return (
                            <td key={`c${c.i}`} className="box">
                              {n > 0 && <span className="shot">{"•".repeat(n)}</span>}
                            </td>
                          );
                        })}
                        <td className="tot">{side.playingHandicap}</td>
                        <td className="tot" />
                      </tr>
                    );
                  }
                  return (
                    <Fragment key={`b${bi}`}>
                      {b.players.map((p) => (
                        <tr key={p.name} style={{ height: 30 }}>
                          <td>
                            {p.name} <span style={{ fontSize: 9 }}>({indexLabel(p)})</span>
                            {p.tee ? (
                              <span style={{ fontSize: 8.5, marginLeft: 4, opacity: 0.75 }}>{p.tee}</span>
                            ) : null}
                          </td>
                          {cols.map((c) => {
                            if (c.kind !== "hole") return <td key={c.label} className="tot" />;
                            /**
                             * HOW MANY, not merely that there are some — the
                             * same rule the entry screen follows. A twenty-shot
                             * difference gives two strokes on the hardest hole,
                             * and one dot there would be a card that under-reads
                             * by one.
                             */
                            const n = p.shots?.[c.i] ?? 0;
                            return (
                              <td key={`c${c.i}`} className="box">
                                {n > 0 && <span className="shot">{"•".repeat(n)}</span>}
                              </td>
                            );
                          })}
                          <td className="tot">{p.playingHandicap ?? ""}</td>
                          <td className="tot" />
                        </tr>
                      ))}
                      {/* THE NUMBER THAT DECIDES THE ROUND, which had nowhere
                          to be written. Each partner plays their own ball and
                          the side's score is the best of them — so a four-ball
                          card carries a better-ball line, and this one did not.
                          Blank boxes: it is arithmetic done on the course, not
                          something the sheet can know in advance. */}
                      {b.side && (
                        <tr className="sideRow" style={{ height: 30 }}>
                          <td>
                            <strong>{b.side.name}</strong>
                            <div style={{ fontSize: 8.5, opacity: 0.75 }}>
                              Best {teamRound?.countBest ?? 1} counts
                            </div>
                          </td>
                          {cols.map((c) =>
                            c.kind === "hole" ? (
                              <td key={`c${c.i}`} className="box" />
                            ) : (
                              <td key={c.label} className="tot" />
                            ),
                          )}
                          <td className="tot" />
                          <td className="tot" />
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>
            {/* WHAT MAKES IT A SCORECARD RATHER THAN A GRID. Rule 3.3b: the
                marker certifies the hole scores and the player certifies their
                card. A card with nowhere to sign is one a committee cannot
                accept, and every club card in the world has these two lines. */}
            <div className="sigs">
              <span>Marker&rsquo;s signature</span>
              <span>Player&rsquo;s signature</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
