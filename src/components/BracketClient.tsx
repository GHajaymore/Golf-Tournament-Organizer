"use client";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { setBracketWinner, setBracketResult } from "@/app/actions/tournament";
import type { BracketMatch, BracketView } from "@/lib/domain";
import { tieNotReady } from "@/lib/domain/bracket";
import {
  drawSections,
  layoutSection,
  playerPath,
  sectionOfPlayer,
  drawPlayers,
  type SectionKey,
  type SeatMark,
} from "@/lib/domain/bracket-layout";
import { marginWords } from "@/lib/domain/my-tie";
import type { PlayBy } from "@/lib/domain/knockout-play-by";
import { createPortal } from "react-dom";
import { BracketPrint } from "./BracketPrint";
import { formatDayAt } from "@/lib/domain/locale";
import { bracketScreenName } from "@/lib/domain/bracket-name";
import { Icon } from "./Icon";
import { leaveOnEnter } from "@/lib/leave-on-enter";

/* The drawing's measures, in pixels. A seat is a tap target: 44px, the touch
   minimum (CLAUDE.md; `globals.css` holds `.bracket-seat` to it under a finger
   as well). A tie is two seats. */
const SEAT = 44;
const TIE_W = 236;
const COL_GAP = 40;
const HEAD = 40;
const CHAMP_W = 150;

/** `Quarter 1 · 3 to play`, or `all played`. */
function toPlayWords(n: number): string {
  return n === 0 ? "all played" : `${n} to play`;
}

/**
 * A KNOCKOUT'S DRAW, DRAWN — the one drawing behind every surface that shows one
 * (the organizer's Bracket screen and the read-only leaderboard of a straight
 * knockout through `BracketClient`; the player's Board and the club's public
 * board through `TheDraw`). The sections, where each tie sits and the lines
 * between them are `bracket-layout.ts`; this only paints them.
 *
 * What the panel of 2026-10-23 decided it is (`docs/bracket-panel-2026-10-23.md`):
 * tabs by section for a big draw, each with how many of its ties are still to
 * play; a real bracket — each tie midway between the two it came from, thin
 * lines between them, the winner in bold with a tick and the margin in golf's
 * words, never colour alone; a bye a word beside a name, never a box; and a
 * search box that opens a player's section and lights their path. The section
 * and the player found are in the address (`?section=q2&p=…`), so a link can be
 * shared and Back works; the last tab a viewer chose is remembered in their own
 * browser for when the address says nothing.
 *
 * On a phone the drawing scrolls inside its own box, both ways, with the round
 * headings held at the top of it; the page itself never scrolls sideways.
 */
export function BracketDrawing({
  view,
  results,
  readOnly,
  seeds,
  seeded,
  me = "",
  param = "section",
  name = "",
  playBy,
  printTitle = "",
  locale,
}: {
  view: BracketView;
  /** The tournament's name, for the printed sheets' heading. */
  printTitle?: string;
  /** The club's locale, for "Printed on …". */
  locale?: string;
  /** Each round's play-by date, by round index (`roundPlayBy`); a round with none is absent. */
  playBy?: Record<number, PlayBy>;
  /** Each player's place in the qualifying order, shown in place of the draw's own numbering. */
  seeds?: Record<string, number>;
  /**
   * Whether the draw was SEEDED at all (the panel: "seed numbers shown only when
   * the draw was actually seeded"). False while it is the entry order because
   * nothing before it has been played, and for a plate (`drawsSeeded`).
   */
  seeded: boolean;
  results: Record<string, string>;
  readOnly: boolean;
  /** The signed-in player's id on the player app: the drawing opens on their section and marks "You". */
  me?: string;
  /** The address key this draw's tab is kept under; a second draw on the same page needs its own. */
  param?: string;
  /** The draw's name ("Plate", "Championship flight"), for the tabs' label; "" for the only draw. */
  name?: string;
}) {
  const [pending, startTransition] = useTransition();
  /**
   * The match whose margin the server has just confirmed (2026-10-05).
   *
   * The margin saves when the box is left, and said nothing either way — an
   * organizer typing "2&1" and moving on could not tell it was kept, and one
   * who went straight to another screen could leave before it was. Found when
   * the knockout e2e spec, which did exactly that, lost a "1 UP" on CI.
   */
  const [savedKey, setSavedKey] = useState("");
  /**
   * What the server said no with, shown. A press here names one of the tie's
   * own two players, so it is not refused — unless the draw moved underneath
   * (a second organizer, a result taken back) and this screen is a moment
   * old. Then the press did nothing, and saying so is the difference between
   * "try again" and a result somebody believes they recorded.
   */
  const [refused, setRefused] = useState("");

  const sections = useMemo(() => drawSections(view), [view]);
  const tabbed = sections.length > 1;
  const storeKey = `thq-draw:${param}:${view.rounds[0]?.matches[0]?.a.playerId ?? ""}`;

  // What the address says. `useSearchParams` is null outside the app's router (a unit render).
  const search = useSearchParams();
  const urlSection = search?.get(param) ?? "";
  const urlPlayer = search?.get("p") ?? "";
  const [stored, setStored] = useState("");
  useEffect(() => {
    try {
      setStored(window.localStorage.getItem(storeKey) ?? "");
    } catch {
      // A private window or blocked storage: the default tab, every time.
    }
  }, [storeKey]);

  const valid = (k: string) => sections.some((s) => s.key === k);
  const found = urlPlayer && playerPath(view, urlPlayer).length > 0 ? urlPlayer : "";
  const mineKey = me ? sectionOfPlayer(view, sections, me) : null;
  const sectionKey: SectionKey = (
    valid(urlSection)
      ? urlSection
      : found
        ? (sectionOfPlayer(view, sections, found) ?? "whole")
        : mineKey
          ? mineKey
          : valid(stored)
            ? stored
            : "whole"
  ) as SectionKey;
  const current = sections.find((s) => s.key === sectionKey) ?? sections[sections.length - 1];

  /** Into the address, as a new entry, so Back returns to the last tab. */
  const go = (next: { section?: SectionKey; p?: string | null }) => {
    const params = new URLSearchParams(window.location.search);
    if (next.section) params.set(param, next.section);
    if (next.p === null) params.delete("p");
    else if (next.p) params.set("p", next.p);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
    if (next.section) {
      try {
        window.localStorage.setItem(storeKey, next.section);
      } catch {
        // Not kept: the address still holds it.
      }
    }
  };

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = sections.length - 1;
    const to = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    go({ section: sections[to].key });
    tabRefs.current[to]?.focus();
  };

  const highlightId = found || me;
  const path = useMemo(() => new Set(highlightId ? playerPath(view, highlightId) : []), [view, highlightId]);

  /*
   * THE PLAYER FOUND IS BROUGHT INTO VIEW — inside the drawing's own box, never by
   * scrolling the page: their latest tie is centred in the box as the section
   * opens. Without it a player in the bottom of a quarter was "found" on a tab
   * whose visible part held nobody lit at all.
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /*
   * PRINT THE DRAW (part c): the sheets are mounted under <body> only while
   * printing, the body is marked so the print stylesheet prints them and nothing
   * else, and both are taken down when the print dialog closes.
   */
  const [printing, setPrinting] = useState(false);
  const [printedOn, setPrintedOn] = useState("");
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("printing-draw");
    const done = () => {
      document.body.classList.remove("printing-draw");
      setPrinting(false);
    };
    window.addEventListener("afterprint", done);
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", done);
      document.body.classList.remove("printing-draw");
    };
  }, [printing]);
  const sectionShown = sectionKey;
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || !highlightId) return;
    const lit = box.querySelectorAll<HTMLElement>('[data-on-path="true"]');
    const el = lit[lit.length - 1];
    if (!el) return;
    const b = box.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    box.scrollTop += e.top - b.top - box.clientHeight / 2 + e.height / 2;
    box.scrollLeft += e.left - b.left - box.clientWidth / 2 + e.width / 2;
  }, [highlightId, sectionShown]);
  const gap = readOnly ? 0.5 : 1;
  const layout = useMemo(() => layoutSection(view, current.keys, gap), [view, current.keys, gap]);
  const finalKey = view.rounds[view.rounds.length - 1]?.matches[0]?.key ?? "";
  const finalBox = layout.columns.flatMap((c) => c.ties).find((t) => t.match.key === finalKey);

  const left = (col: number) => col * (TIE_W + COL_GAP);
  // A heading with a play-by date under its name is two lines tall.
  const head = playBy && Object.keys(playBy).length > 0 ? HEAD + 18 : HEAD;
  const top = (y: number) => head + y * SEAT;
  const width = left(layout.columns.length) - COL_GAP + (finalBox ? COL_GAP + CHAMP_W : 0);
  const height = top(layout.height) + 12;
  const idBase = `draw-${param}`;
  const headStyle = {
    position: "sticky" as const,
    top: 0,
    zIndex: 2,
    height: head,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-surface)",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--color-text-muted)",
    whiteSpace: "nowrap" as const,
  };

  // Find a player.
  const people = useMemo(() => drawPlayers(view), [view]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q ? people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8) : [];
  const foundName = people.find((p) => p.id === found)?.name ?? "";

  const slotButton = (
    m: BracketMatch,
    slot: { playerId: string | null; seed: number | null; name: string },
    mark: SeatMark,
  ) => {
    const matchKey = m.key;
    const winnerId = m.winnerId;
    const isWinner = winnerId !== null && slot.playerId === winnerId;
    // A name is pressed only in a tie between two players (`tieNotReady`): not a
    // bye, which goes through on its own, and not a tie waiting on "TBD".
    const clickable = !readOnly && slot.playerId !== null && !tieNotReady(m);
    const seed = seeded ? ((slot.playerId && seeds?.[slot.playerId]) ?? slot.seed ?? "") : "";
    const margin = isWinner ? marginWords(results[m.key]).trim() : "";
    const lit = !!highlightId && slot.playerId === highlightId;
    /*
     * THE WORDS ABOUT A SEAT GO UNDER THE NAME, NOT BESIDE IT (#935's captures,
     * 2026-10-23): a "bye" badge and a margin beside the name cut it to
     * "Cressida Ra…". Under it they cost no width: "You", "bye", "through the
     * preliminary round", and the winner's margin.
     */
    const isMe = !!me && slot.playerId === me;
    const viaPrelim = mark.prelim && slot.playerId !== null;
    const notes = isMe || mark.bye || viaPrelim || !!margin;
    const body = (
      <>
        <span style={{ display: "grid", minWidth: 0, lineHeight: 1.2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            {isWinner && <Icon name="check" weight="bold" />}
            <span
              className="bracket-name"
              data-player={slot.playerId ? "true" : undefined}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontStyle: slot.playerId ? "normal" : "italic",
                color: slot.playerId ? "inherit" : "var(--color-text-muted)",
              }}
            >
              {slot.name}
            </span>
            {/* After the name, so a seat is still found by the name it starts with. */}
            {isWinner && <span className="sr-only">, won</span>}
          </span>
          {notes && (
            <span className="bracket-notes">
              {isMe && <span className="bracket-tag-you">You</span>}
              {mark.bye && <span className="bracket-tag">bye</span>}
              {viaPrelim && <span>through the preliminary round</span>}
              {margin && <span style={{ fontWeight: 700, color: "var(--color-text)" }}>won {margin}</span>}
            </span>
          )}
        </span>
        {/* THE SEED A PLAYER BROUGHT (2026-10-16): a plate or a second flight
            numbered its own players from 1, so seed 16 read as a top seed. */}
        <span style={{ fontSize: 13, color: "var(--color-text-muted)", fontWeight: 400, flex: "none" }}>{seed}</span>
      </>
    );
    const style = {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      width: "100%",
      height: SEAT,
      minHeight: SEAT,
      padding: "0 10px",
      border: "none",
      borderLeft: lit ? "4px solid var(--color-accent-400)" : "4px solid transparent",
      background: isWinner ? "var(--color-surface-2)" : "transparent",
      color: "var(--color-text)",
      cursor: clickable ? "pointer" : "default",
      fontSize: 13.5,
      fontWeight: isWinner ? 700 : 400,
      textAlign: "left" as const,
    };
    if (readOnly) return <div style={style}>{body}</div>;
    return (
      <button
        type="button"
        className="bracket-seat"
        disabled={!clickable || pending}
        onClick={() =>
          clickable &&
          startTransition(async () => {
            const result = await setBracketWinner(matchKey, slot.playerId!);
            setRefused(result.ok ? "" : (result.error ?? "That result could not be recorded."));
          })
        }
        style={style}
      >
        {body}
      </button>
    );
  };

  return (
    <div className="card elev-sm bracket-drawing" style={{ padding: 0, overflow: "hidden" }}>
      {printing &&
        createPortal(
          <BracketPrint
            view={view}
            results={results}
            seeded={seeded}
            title={[printTitle, name].filter(Boolean).join(" · ") || "The draw"}
            printedOn={printedOn}
          />,
          document.body,
        )}
      {refused && (
        <p className="form-error" role="alert" style={{ margin: "12px 14px 0" }}>
          {refused} Reload the draw and record it again.
        </p>
      )}
      {people.length > 0 && (
        <div style={{ padding: "12px 14px 0", display: "grid", gap: 8 }}>
          <div className="no-print" style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-sm"
              style={{ minHeight: 44 }}
              onClick={() => {
                // The day it is printed, stamped by the press — never read during render.
                setPrintedOn(`Printed on ${formatDayAt(new Date(), locale)}`);
                setPrinting(true);
              }}
            >
              <Icon name="printer" /> Print the draw
            </button>
          </div>
          <label style={{ display: "grid", gap: 4, fontSize: 13, maxWidth: 360 }}>
            <span className="text-muted">Find a player</span>
            <span style={{ position: "relative", display: "block" }}>
              <input
                className="input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a name"
                aria-controls={`${idBase}-found`}
                autoComplete="off"
                style={{ width: "100%", minHeight: 44 }}
              />
            </span>
          </label>
          {matches.length > 0 && (
            <ul id={`${idBase}-found`} aria-label="Players found" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ minHeight: 44 }}
                    onClick={() => {
                      setQuery("");
                      go({ section: sectionOfPlayer(view, sections, p.id) ?? "whole", p: p.id });
                    }}
                  >
                    <Icon name="magnifying-glass" /> Show {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q && matches.length === 0 && (
            <p className="text-muted" role="status" style={{ margin: 0, fontSize: 13 }}>
              Nobody in this draw by that name.
            </p>
          )}
          {foundName && (
            <p role="status" style={{ margin: 0, fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>
                <Icon name="map-pin" /> Showing <strong>{foundName}</strong>&rsquo;s path through the draw
              </span>
              <button type="button" className="btn btn-sm" style={{ minHeight: 44 }} onClick={() => go({ p: null })}>
                <Icon name="x" /> Clear
              </button>
            </p>
          )}
        </div>
      )}
      {tabbed && (
        <div
          role="tablist"
          aria-label={name ? `${name}: sections of the draw` : "Sections of the draw"}
          style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "12px 14px 0" }}
        >
          {sections.map((s, i) => {
            const selected = s.key === current.key;
            return (
              <button
                key={s.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${idBase}-tab-${s.key}`}
                aria-selected={selected}
                aria-controls={`${idBase}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => go({ section: s.key })}
                onKeyDown={(e) => onTabKey(e, i)}
                className="bracket-tab"
                style={{
                  minHeight: 44,
                  padding: "5px 12px",
                  borderRadius: 8,
                  border: selected ? "2px solid var(--color-accent-400)" : "1px solid var(--color-divider)",
                  background: selected ? "var(--color-surface-2)" : "transparent",
                  color: "var(--color-text)",
                  display: "grid",
                  justifyItems: "start",
                  lineHeight: 1.25,
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: selected ? 700 : 500 }}>{s.label}</span>
                <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{toPlayWords(s.toPlay)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div
        id={`${idBase}-panel`}
        ref={scrollRef}
        role={tabbed ? "tabpanel" : "region"}
        aria-labelledby={tabbed ? `${idBase}-tab-${current.key}` : undefined}
        className="bracket-scroll"
        tabIndex={0}
        aria-label={tabbed ? undefined : name ? `${name}: the draw` : "The draw"}
        style={{ overflow: "auto", maxHeight: "min(78vh, 1400px)", margin: "12px 0 0", overscrollBehavior: "contain" }}
      >
        {layout.columns.length === 0 ? (
          <p className="text-muted" style={{ margin: 0, padding: "4px 14px 16px", fontSize: 13.5 }}>
            {people.length === 1 ? `${people[0].name} is the only player in this draw, so there is no tie to play.` : "Nobody is in this draw yet."}
          </p>
        ) : (
          <div style={{ position: "relative", width: width + 28, height, minWidth: "100%" }}>
            <div style={{ position: "absolute", inset: "0 14px" }}>
              {/* The lines between the ties: decoration, so a screen reader is not read them. */}
              <svg
                aria-hidden="true"
                width={width}
                height={height}
                style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
              >
                {layout.connectors.map((c) => {
                  const x1 = left(c.fromCol) + TIE_W;
                  const x2 = left(c.toCol);
                  const xm = x1 + COL_GAP / 2;
                  const on = path.has(c.fromKey) && path.has(c.toKey);
                  return (
                    <path
                      key={`${c.fromKey}>${c.toKey}`}
                      d={`M ${x1} ${top(c.fromY)} H ${xm} V ${top(c.toY)} H ${x2}`}
                      fill="none"
                      stroke={on ? "var(--color-accent-400)" : "var(--color-divider)"}
                      strokeWidth={on ? 3 : 1.5}
                    />
                  );
                })}
                {finalBox && (
                  <path
                    d={`M ${left(finalBox.col) + TIE_W} ${top(finalBox.y)} H ${left(finalBox.col) + TIE_W + COL_GAP}`}
                    fill="none"
                    stroke={path.has(finalKey) && view.champion?.playerId === highlightId ? "var(--color-accent-400)" : "var(--color-divider)"}
                    strokeWidth={1.5}
                  />
                )}
              </svg>
              {/* Column by column, each with its heading held at the top of the box while
                  it scrolls — and in reading order, heading then ties, so the page reads
                  (and a screen reader walks) a round at a time. */}
              {layout.columns.map((col, c) => (
                <div
                  key={col.roundIndex}
                  className="bracket-col"
                  style={{ position: "absolute", left: left(c), top: 0, width: TIE_W, height }}
                >
                  <div className="bracket-round-head" style={headStyle}>
                    <span className="bracket-round-name">{col.label}</span>
                    {/* The round's play-by date, in the club's words — and "overdue" written
                        out once the club's day is past it (the panel, 2026-10-23). */}
                    {playBy?.[col.roundIndex] && (
                      <span className="bracket-round-by" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                        Play by {playBy[col.roundIndex].words}
                        {playBy[col.roundIndex].overdue && <strong style={{ color: "var(--color-danger)" }}> · Overdue</strong>}
                      </span>
                    )}
                  </div>
                  {col.ties.map((t) => {
                    const m = t.match;
                    const onPath = path.has(m.key);
                    return (
                      <div
                        key={m.key}
                        data-tie={m.key}
                        data-on-path={onPath ? "true" : undefined}
                        className="bracket-tie"
                        style={{ position: "absolute", left: 0, top: top(t.y - 1), width: TIE_W }}
                      >
                        <div
                          style={{
                            border: onPath ? "2px solid var(--color-accent-400)" : "1px solid var(--color-divider)",
                            borderRadius: 8,
                            overflow: "hidden",
                            background: "var(--color-surface)",
                            height: SEAT * 2,
                            boxSizing: "border-box",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                          }}
                        >
                          {slotButton(m, m.a, t.a)}
                          {slotButton(m, m.b, t.b)}
                        </div>
                        <div className="bracket-result" style={{ position: "absolute", top: "100%", left: 0, right: 0, display: "flex", alignItems: "center", gap: 6 }}>
                          {/* No margin for a bye: nobody played it. */}
                          {m.winnerId && !readOnly && !tieNotReady(m) && (
                            <input
                              className="input"
                              defaultValue={results[m.key] ?? ""}
                              placeholder="Result e.g. 3&2"
                              // A placeholder is not a name, and there is one of these
                              // per finished match — each says whose match it records.
                              aria-label={`Result of ${m.a?.name ?? "TBD"} v ${m.b?.name ?? "TBD"}, ${col.label}`}
                              onKeyDown={leaveOnEnter}
                              onBlur={(e) => {
                                const value = e.target.value;
                                // Leaving the box unchanged saves nothing, and says nothing.
                                if (value.trim() === (results[m.key] ?? "").trim()) return;
                                setSavedKey("");
                                startTransition(async () => {
                                  await setBracketResult(m.key, value);
                                  setSavedKey(m.key);
                                });
                              }}
                              style={{ marginTop: 4, fontSize: 13, minHeight: 30, padding: "2px 8px", flex: 1, minWidth: 0 }}
                            />
                          )}
                          {m.winnerId && !readOnly && savedKey === m.key && !pending && (
                            <span role="status" className="text-muted" style={{ fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
                              <Icon name="check" /> Saved
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {finalBox && (
                <div
                  className="bracket-col"
                  style={{ position: "absolute", left: left(finalBox.col) + TIE_W + COL_GAP, top: 0, width: CHAMP_W, height }}
                >
                  <div className="bracket-round-head" style={headStyle}>
                    Champion
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: top(finalBox.y - 1),
                      height: SEAT * 2,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      alignItems: "center",
                      gap: 4,
                      textAlign: "center",
                    }}
                  >
                    <Icon name="trophy" weight="fill" style={{ fontSize: 26, color: "var(--color-accent-200)" }} />
                    <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 15 }}>{view.champion?.name ?? "TBD"}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function BracketClient({
  winners,
  consolation,
  mainLabel = "Main draw",
  secondLabel = "",
  results = {},
  readOnly = false,
  straight = false,
  draws,
  awaitingFlights = false,
  notYetPlayed = false,
  seeds,
  seeded,
  playBy,
  toPlay,
  printTitle,
  locale,
}: {
  /** The tournament's name and the club's locale, for the printed sheets. */
  printTitle?: string;
  locale?: string;
  /** Each draw's play-by dates by round index, keyed by the draw's kind (`roundPlayBy`). */
  playBy?: Record<string, Record<number, PlayBy>>;
  /**
   * The secretary's "To play" list (`KnockoutToPlay`). Handed in, the screen opens
   * on it with the drawing as the next tab; left out (a read-only board), the
   * drawing is all there is.
   */
  toPlay?: ReactNode;
  /** Nothing in the rounds before the draw has been played: it is the entry order for now. */
  notYetPlayed?: boolean;
  seeds?: Record<string, number>;
  /**
   * Which draws were SEEDED, in list order (`drawsSeeded`): one that was not —
   * the entry order before qualifying, a plate filled from the losers — shows no
   * seed numbers. Required, so a new caller cannot forget to ask.
   */
  seeded: boolean[];
  winners: BracketView;
  consolation: BracketView;
  /**
   * EVERY draw, where the knockout is divided into flights (2026-10-12) — as
   * many as the organizer made, each with the name they gave it. When this is
   * handed in it is the whole list and the two props above are not read; the
   * older arrangements leave it out and are shown exactly as before.
   */
  draws?: { label: string; view: BracketView }[];
  /**
   * What the FIRST draw is called, which also depends on the mode.
   *
   * It read "Winners" whatever the arrangement. In `split` there are no
   * winners yet — the two draws are flights, divided by qualifying rank
   * before anybody tees off — so the tab named a thing that had not happened.
   * `drawBrackets` names both draws; this prints what it is given.
   */
  mainLabel?: string;
  /**
   * What the second bracket is called, or "" when there is not one.
   *
   * `drawBrackets` decides both: `single` returns no second field and an empty
   * label, `split` returns "Consolation", `plate` returns "Plate". This is the
   * same string the mode picker is handed, so the toggle and the arrangement
   * cannot come to disagree about whether a second bracket exists.
   */
  secondLabel?: string;
  results?: Record<string, string>;
  readOnly?: boolean;
  /** No qualifying round before this bracket: the whole field is in it. */
  straight?: boolean;
  /**
   * Arranged in several flights and not yet divided. There is no draw then —
   * not an empty one. Without this the screen drew a bracket of "TBD v TBD"
   * under "The whole field, seeded in order": a draw nobody had made, described
   * by a sentence about a different arrangement.
   */
  awaitingFlights?: boolean;
}) {
  // "Seeded from qualification" was printed over a knockout nobody qualified
  // for — the bracket was the tournament's first round.
  const inFlights = !!draws && draws.length > 0;
  const seededFrom = inFlights
    ? "Each flight is its own knockout, seeded in order."
    : straight
      ? "The whole field, seeded in order."
      : notYetPlayed
        ? "Nothing before the draw has been played, so it is in entry order for now."
        : "Seeded from qualification.";
  // Which draw is on screen, by its place in the list.
  const [tab, setTab] = useState(0);
  /**
   * ONLY WHERE THERE IS A SECOND BRACKET — and it is named, not assumed.
   *
   * Two faults, both read off the seeded club's knockout on 2026-09-23.
   *
   * The toggle rendered ALWAYS. That knockout is `single` mode — the panel
   * directly above says "One bracket … lose and you're out" — and an organizer
   * was still offered a Consolation tab, which shows a draw that does not
   * exist. The same fault the flights toggle had on `LeaderboardBoard`, fixed
   * there on 2026-09-11 for the same reason: a control that switches to a view
   * containing nothing is worse than no control.
   *
   * And the label was HARDCODED. In `plate` mode the second bracket is a
   * Plate — `drawBrackets` says so, and a club calls it that — while this tab
   * said "Consolation". One thing with two names, on the screen that runs it.
   */
  const hasSecond = secondLabel !== "";
  const list = inFlights
    ? draws
    : hasSecond
      ? [
          { label: mainLabel, view: winners },
          { label: secondLabel, view: consolation },
        ]
      : [{ label: mainLabel, view: winners }];
  const at = list[tab] ? tab : 0;
  const shown = list[at];
  /*
   * THE SECRETARY OPENS ON "TO PLAY" (the panel, 2026-10-23): the ties that can
   * be played now, with their dates and their result entry. The drawing is the
   * next tab. The choice is in the address (`?view=draw`), so Back returns.
   */
  const search = useSearchParams();
  const [drawView, setDrawView] = useState<boolean | null>(null);
  const onDraw = !toPlay || (drawView ?? search?.get("view") === "draw");
  const showView = (draw: boolean) => {
    setDrawView(draw);
    const params = new URLSearchParams(window.location.search);
    if (draw) params.set("view", "draw");
    else params.delete("view");
    const q = params.toString();
    window.history.pushState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  };
  useEffect(() => {
    const back = () => setDrawView(null);
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const viewTabs = [
    { key: "to-play", label: "To play", draw: false },
    { key: "draw", label: "The draw", draw: true },
  ];
  const onViewKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const to = e.key === "Home" ? 0 : e.key === "End" ? 1 : 1 - i;
    showView(viewTabs[to].draw);
    document.getElementById(`bracket-view-${viewTabs[to].key}`)?.focus();
  };
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-kicker">Manage</div>
          <h1 className="page-title">{bracketScreenName(readOnly)}</h1>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {awaitingFlights
              ? readOnly
                ? "The field has not been divided into flights yet, so there is no draw."
                : "Nothing is drawn until the field is divided into flights."
              : readOnly
                ? `${seededFrom} Winners advance automatically as results come in.`
                : `${seededFrom} Click a name to advance the winner (results auto-advance the next round).`}
          </p>
        </div>
        {onDraw && !awaitingFlights && list.length > 1 && (
          // Wraps: a knockout in flights may have a dozen of these.
          <div className="seg" style={{ flexWrap: "wrap" }}>
            {list.map((d, i) => (
              <label className="seg-opt" key={d.label}>
                <input type="radio" name="brk" checked={at === i} onChange={() => setTab(i)} />
                {d.label}
              </label>
            ))}
          </div>
        )}
      </div>
      {toPlay && !awaitingFlights && (
        <div role="tablist" aria-label="The knockout" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {viewTabs.map((v, i) => {
            const selected = v.draw === onDraw;
            return (
              <button
                key={v.key}
                id={`bracket-view-${v.key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="bracket-view-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => showView(v.draw)}
                onKeyDown={(e) => onViewKey(e, i)}
                style={{
                  minHeight: 44,
                  padding: "6px 16px",
                  borderRadius: 8,
                  border: selected ? "2px solid var(--color-accent-400)" : "1px solid var(--color-divider)",
                  background: selected ? "var(--color-surface-2)" : "transparent",
                  color: "var(--color-text)",
                  fontWeight: selected ? 700 : 500,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      )}
      {!awaitingFlights && (
        <div
          id="bracket-view-panel"
          role={toPlay ? "tabpanel" : undefined}
          aria-labelledby={toPlay ? `bracket-view-${onDraw ? "draw" : "to-play"}` : undefined}
        >
          {!onDraw && toPlay}
          {onDraw && (
            <BracketDrawing
              key={shown.view.kind}
              view={shown.view}
              results={results}
              readOnly={readOnly}
              seeds={seeds}
              seeded={seeded[at] ?? false}
              param={at === 0 ? "section" : `section-${shown.view.kind}`}
              name={list.length > 1 ? shown.label : ""}
              playBy={playBy?.[shown.view.kind]}
              printTitle={printTitle}
              locale={locale}
            />
          )}
        </div>
      )}
    </>
  );
}
