import { indexFigure, indexLabel } from "@/lib/domain/handicap-label";
import { Fragment } from "react";
import type React from "react";
import { holeNumber, startHoleNumber } from "@/lib/domain/hole-number";

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
     * Strokes received in THIS match, where the round is one: their playing
     * handicap less the lowest in the match. Null on a medal round, and on a
     * match-play round for anybody not drawn into a match yet.
     */
    matchStrokes?: number | null;
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
    /** The whole-number course handicap off their tees, for a named card (Rule 3.3b(4)). */
    courseHandicap?: number;
    /**
     * Nobody has claimed an index for them (`handicapSource: "none"`). Paper
     * prints "to be confirmed" and no dots, rather than a zero that reads as
     * scratch.
     */
    unconfirmed?: boolean;
  }>;
}

/** One side of a team round, as the card needs it. */
export interface PrintSide {
  name: string;
  /** The side's own number, allowance already applied — what a shared ball
   *  plays off, and what `singleBallTeamCard` scores it against. */
  playingHandicap: number;
  /** Strokes received in this match, where the round is one. */
  matchStrokes?: number | null;
  /** The side's shots per hole, in hole order. */
  shots: number[];
}

/** What kind of team round this is, or null on an individual one. */
export interface PrintTeamRound {
  format: string;
  /** The allowance in force, as a percentage. */
  allowance: number;
  /** Sides of more than one. False for singles match play, which shares every
   *  other rule on this card and has no better ball. */
  teams: boolean;
  /** One ball between the side (foursomes, a scramble) rather than one each. */
  sharedBall: boolean;
  /** How many partners' scores count on a hole, where they each play a ball. */
  countBest: number;
  /** The round pits side against side, so it is decided hole by hole and the
   *  strokes come off the lowest handicap in the match. */
  matchPlay: boolean;
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
 * ONE PRINT PATH (2026-10-23). This drew its own Print button and hid the
 * rest of the page on paper; the Print kit (`/print`) is now the only way to
 * the printer, and this is the CARD it draws — the Tee sheet's group card, and
 * with one player or one side in the group, the named scorecard. `wrap` puts
 * each card on its page; without it the cards render bare, as they always did.
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
  pins = [],
  firstHole = 1,
  eventName = "",
  yards = [],
  named = false,
  points = false,
  startStyle = "tee",
  signNote = "",
  wrap,
}: {
  /** The competition's name, as the card's headline. */
  eventName?: string;
  /** Yards per hole, as a row on the card. Empty prints no row. */
  yards?: number[];
  /** A NAMED card: course AND playing handicap beside each name (Rule 3.3b(4)). */
  named?: boolean;
  /** A Stableford card: a points row under each score row, for the Committee. */
  points?: boolean;
  /** How the field starts. A shotgun or two-tee start prints the starting hole large. */
  startStyle?: "tee" | "split" | "shotgun";
  /** Who signs, in the format's words — printed under the signature lines. */
  signNote?: string;
  /** Each card's page: the Print kit's sheet, with its footer. */
  wrap?: (group: PrintGroup, card: React.ReactNode) => React.ReactNode;
  /** The course's number for the first hole on the card — 10 on a back nine (`firstHoleOf`). */
  firstHole?: number;
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
  /** The round's pin sheet in card notation ("22 / 6R"), one per hole; empty
   *  strings for holes with no position. No pin sheet, no row. */
  pins?: string[];
}) {
  const printable = groups;
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
    : [
        teamRound.matchPlay && !/match/i.test(teamRound.format)
          ? `${teamRound.format} match play`
          : teamRound.format,
        !teamRound.teams
          ? ""
          : teamRound.sharedBall
            ? "one ball between the side"
            : `best ${teamRound.countBest} score${teamRound.countBest === 1 ? "" : "s"} on each hole`,
        // No percentage on a shared ball: a scramble's side handicap is a
        // descending share of each member's, not one figure, so naming a
        // percentage there would state something untrue.
        teamRound.sharedBall ? "" : `${teamRound.allowance}% handicap`,
        // Singles: "the lower" reads oddly of four people and correctly of two.
        teamRound.matchPlay && !teamRound.teams ? "shots off the lower handicap" : "",
        // WHERE THE DOTS COME FROM, said out loud. On a match card they are
        // the difference off the lowest handicap in the match, which is why
        // a player's dots do not match the Hcp box beside their name.
        teamRound.matchPlay && teamRound.teams
          ? "shots off the lowest handicap in the match"
          : "",
      ]
        .filter(Boolean)
        .join(" · ");

  /** A match card carries the strokes given as well as what each plays off. */
  const showsMatchStrokes = !!teamRound?.matchPlay;

  return (
    <>
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
        /* The one box a committee reads afterwards, so it is a box and not a
           column heading: left-aligned, roomy, and obviously for writing in. */
        .foursome-card .result {
          text-align: left; font-size: 8.5px; font-weight: 400;
          opacity: 0.75; background: #fff; vertical-align: top;
        }
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
        .foursome-cards { overflow-x: auto; }
        /* The starting hole, large, where the field does not all go off one tee. */
        .foursome-card .startBig { font-size: 20pt; font-weight: 800; border: 1.5pt solid #000; padding: 2px 10px; }
        .foursome-card .note { font-size: 10px; margin-top: 6px; }
        .foursome-card .card-headline { font-size: 18px; font-weight: 800; margin: 2px 0 6px; overflow-wrap: anywhere; }
        .foursome-card td.named { min-width: 160px; }
        .foursome-card .pname { font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
        .foursome-card .pfig { font-size: 10px; margin-top: 2px; }
        .foursome-card .pointsRow td { font-size: 9px; }
        /* Printing is the Print kit's (\`/print\`): it puts each card on a page of its own. */
      `}</style>

      <div className="foursome-cards">
        {printable.map((g, gi) => {
          const blocks = blocksOf(g);
          /**
           * WHOSE VIEW THE MATCH ROW IS, because "2 up" on its own is the very
           * thing that makes a card hard to read. Ajay: "ITs hard to know who
           * won." The first side on the card owns the row and is named on it,
           * so every entry in it means one thing.
           */
          const matchSide = blocks.find((b) => b.side)?.side?.name ?? "";
          /**
           * THE CONTEST, NAMED. Ajay, looking at the first version: "its hard
           * to read which team is the winner and how many points vs what I
           * shared with you." The card he shared heads the grid with
           * "Josh Wheeler / Joe Bunnell vs. Jim Lythgoe / Mike Doyle" — one
           * line that says what this piece of paper is about. Ours said
           * "Match 1", which is a slot in a draw and not a fixture.
           */
          /*
           * ONLY WHERE THE CARD IS ONE FIXTURE. A team card's two sides are
           * one match, so heading it "<A> vs <B>" is true. A SINGLES card can
           * hold two matches — four players who are two pairs of opponents —
           * and joining every block with "vs" said that Ada and Dee were a
           * side playing Bo and Cal, which is not a thing that is happening.
           * Found by rendering all nineteen formats and reading them, not by
           * looking at the one I had just changed.
           *
           * Singles put the fixture on each block's own Match line instead.
           */
          const contest =
            teamRound?.matchPlay && teamRound.teams
              ? blocks
                  .map((b) => b.side?.name ?? b.players.map((p) => p.name).join(" & "))
                  .filter(Boolean)
                  .join("  vs  ")
              : "";
          const card = (
          <div key={`${g.name}-${gi}`} className="foursome-card">
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
                    className="club-logo"
                    style={{ height: 30, width: "auto", maxWidth: 110, objectFit: "contain" }}
                  />
                )}
                <strong style={{ fontSize: 16 }}>{clubName || courseName}</strong>
              </span>
              <span style={{ fontSize: 12 }}>{[courseName, dates].filter(Boolean).join(" · ")}</span>
            </div>
            {/* THE COMPETITION, as the headline (Rule 3.3b(4)'s "the competition
                in which the score is made"): a card is filed afterwards, and a
                card that does not say which competition is a page of numbers. */}
            {eventName && <div className="card-headline">{eventName}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 10 }}>
              <span>
                {roundLabel} — {g.name}
              </span>
              {/* A SHOTGUN SENDS EVERY GROUP TO A DIFFERENT HOLE, so the hole a
                  group starts on is the first thing the card says, large. */}
              {startStyle !== "tee" ? (
                <span>
                  <span className="startBig">
                    Start: hole {startHoleNumber(g.startHole, firstHole)}
                    {g.half ?? ""}
                  </span>{" "}
                  {g.time}
                </span>
              ) : (
                <span>
                  Hole {startHoleNumber(g.startHole, firstHole)}
                  {g.half ?? ""} · {g.time}
                </span>
              )}
            </div>
            {/* WHAT IS BEING PLAYED. A card that does not say changes how the
                hole is played and says nothing about it — best-ball-one-of-four
                and best-two-of-four are different games on the same paper. */}
            {contest && (
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  textAlign: "center",
                  marginTop: -2,
                  marginBottom: 4,
                  borderTop: "1px solid #333",
                  borderBottom: "1px solid #333",
                  padding: "4px 0",
                }}
              >
                {contest}
              </div>
            )}
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
                      <th key={`h${c.i}`}>{holeNumber(c.i, firstHole)}</th>
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
                {yards.some((y) => y > 0) && (
                  <tr>
                    <th>Yards</th>
                    {cols.map((c) =>
                      c.kind === "hole" ? (
                        <th key={`y${c.i}`} style={{ fontWeight: 400 }}>
                          {yards[c.i] || ""}
                        </th>
                      ) : (
                        <th key={c.label} className="tot" />
                      ),
                    )}
                    <th className="tot" />
                    <th className="tot" />
                  </tr>
                )}
                {/* Where the hole is cut, when the committee has set a pin
                    sheet — the line a player reads on the tee. */}
                {pins.some(Boolean) && (
                  <tr>
                    <th>Pin</th>
                    {cols.map((c) =>
                      c.kind === "hole" ? (
                        <th key={`pin${c.i}`} style={{ fontSize: "0.8em", whiteSpace: "nowrap" }}>
                          {pins[c.i] ?? ""}
                        </th>
                      ) : (
                        <th key={c.label} className="tot" />
                      ),
                    )}
                    <th className="tot" />
                    <th className="tot" />
                  </tr>
                )}
              </thead>
              <tbody>
                {blocks.map((b, bi) => {
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
                          {/* A shared ball has no player row to carry a
                              bracket, so the side's received strokes go here —
                              otherwise the card shows a side handicap of 12
                              and five dots with nothing joining them up. */}
                          {showsMatchStrokes && side.matchStrokes != null && (
                            <div style={{ fontSize: 8.5, opacity: 0.75 }}>
                              receives {side.matchStrokes}
                            </div>
                          )}
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
                        <Fragment key={p.name}>
                        <tr style={{ height: 30 }}>
                          {named ? (
                            <td className="named">
                              {/* A NAMED CARD (Rule 3.3b(4)): the player, their
                                  tees, and both figures — the course handicap
                                  off those tees and what they play off once
                                  the round's allowance is taken. A figure the
                                  committee has not confirmed is said so, never
                                  printed as a nought that reads as scratch. */}
                              <span className="pname">{p.name}</span>
                              <div className="pfig">
                                {p.unconfirmed
                                  ? "Handicap to be confirmed by the Committee"
                                  : `Course hcp ${indexFigure(p.courseHandicap ?? 0)} · Playing hcp ${indexFigure(p.playingHandicap ?? 0)}${showsMatchStrokes ? ` · receives ${p.matchStrokes ?? 0}` : ""}`}
                                {p.tee ? ` · ${p.tee}` : ""}
                              </div>
                            </td>
                          ) : (
                          <td>
                            {/*
                             * ON A MATCH CARD THE BRACKET IS THE SHOTS THEY GET,
                             * not the index they carry between clubs.
                             *
                             * Ajay sent the league card his club already reads —
                             * "Josh Wheeler (1) … Mike Doyle (5)" — and said
                             * "I need in similar format. make it simple". That
                             * number is the difference off the lowest handicap
                             * in the match, and it is the one a player checks on
                             * the first tee. It is also the number the dots on
                             * this row were drawn from, so the two agree.
                             *
                             * A medal card keeps the index, because there no
                             * shots are "given" to anybody.
                             */}
                            {p.name}{" "}
                            <span style={{ fontSize: 9 }}>
                              ({showsMatchStrokes ? (p.matchStrokes ?? 0) : indexLabel(p)})
                            </span>
                            {p.tee ? (
                              <span style={{ fontSize: 8.5, marginLeft: 4, opacity: 0.75 }}>{p.tee}</span>
                            ) : null}
                          </td>
                          )}
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
                          <td className="tot">{p.unconfirmed ? "" : (p.playingHandicap ?? "")}</td>
                          <td className="tot" />
                        </tr>
                        {/* STABLEFORD: the points are the Committee's to work
                            out (Rule 21.1b — the player returns gross scores),
                            so the row says whose it is. */}
                        {points && (
                          <tr className="pointsRow" style={{ height: 24 }}>
                            <td>Points — for Committee use</td>
                            {cols.map((c) =>
                              c.kind === "hole" ? <td key={`pt${c.i}`} className="box" /> : <td key={c.label} className="tot" />,
                            )}
                            <td className="tot" />
                            <td className="tot" />
                          </tr>
                        )}
                        </Fragment>
                      ))}
                      {/* THE NUMBER THAT DECIDES THE ROUND, which had nowhere
                          to be written. Each partner plays their own ball and
                          the side's score is the best of them — so a four-ball
                          card carries a better-ball line, and this one did not.
                          Blank boxes: it is arithmetic done on the course, not
                          something the sheet can know in advance. */}
                      {/* SINGLES: a block IS a match, so its line goes here.
                          A team round's two sides are one match between them,
                          so that card carries a single Match row at its foot
                          instead — see below. */}
                      {showsMatchStrokes && !teamRound?.teams && (
                        <tr className="sideRow" style={{ height: 30 }}>
                          <td>
                            <strong>Match</strong>
                            {/* THE FIXTURE, on the line that carries it. This
                                named only the first player, which tells a
                                reader whose view the "2 up" is from and not
                                who it is against — and on a card holding two
                                separate matches that is the whole question. */}
                            <div style={{ fontSize: 8.5, opacity: 0.75 }}>
                              {b.players.map((p) => p.name).join(" vs ")}
                            </div>
                            <div style={{ fontSize: 8, opacity: 0.6 }}>
                              {b.players[0]?.name ?? ""} — up / down / AS
                            </div>
                          </td>
                          {cols.map((c) =>
                            c.kind === "hole" ? (
                              <td key={`bm${c.i}`} className="box" />
                            ) : (
                              <td key={c.label} className="tot" />
                            ),
                          )}
                          <td className="tot result" colSpan={2}>
                            Result
                          </td>
                        </tr>
                      )}
                      {b.side && (
                        <tr className="sideRow" style={{ height: 30 }}>
                          <td>
                            {/* "Net Score", as the card Ajay's club already
                                reads calls it — the side's better ball, on the
                                line directly under the players it came from. */}
                            <strong>Net Score</strong>
                            <div style={{ fontSize: 8.5, opacity: 0.75 }}>
                              {b.side.name} · best {teamRound?.countBest ?? 1}
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
                {/* THE MATCH, which is the only score that matters on a match
                    card and had nowhere to go.
                    A match is not a total — it is a state carried from hole to
                    hole, and a player writes "2 up" or "AS" in it as they walk
                    off each green. So it is a row of boxes with no OUT, no IN
                    and no total: adding a match up is not a thing anybody
                    does, and a box inviting it would be inviting a mistake. */}
                {showsMatchStrokes && teamRound?.teams && (
                  <tr className="sideRow" style={{ height: 30 }}>
                    <td>
                      <strong>Match</strong>
                      <div style={{ fontSize: 8.5, opacity: 0.75 }}>
                        {matchSide ? `${matchSide} — up / down / AS` : "up / down / AS"}
                      </div>
                    </td>
                    {cols.map((c) =>
                      c.kind === "hole" ? (
                        <td key={`m${c.i}`} className="box" />
                      ) : (
                        <td key={c.label} className="tot" />
                      ),
                    )}
                    {/* WHERE THE ANSWER GOES. The Match line carries the state
                        hole by hole; this is the one box a committee reads
                        afterwards — "1 up", "3&2", "halved" — and the card had
                        nowhere to write it. */}
                    <td className="tot result" colSpan={2}>
                      Result
                    </td>
                  </tr>
                )}
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
            {signNote && <div className="note">{signNote}</div>}
          </div>
          );
          return wrap ? <Fragment key={`${g.name}-${gi}`}>{wrap(g, card)}</Fragment> : card;
        })}
      </div>
    </>
  );
}
