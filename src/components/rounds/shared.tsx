"use client";
import React, { useState } from "react";
import dynamic from "next/dynamic";
import { PanelLoading, orNeedsSignal } from "@/components/LazyPanel";
import { countbackSegments } from "@/lib/domain/stroke-countback";



/**
 * WHAT THE BASIS CAN SAY, and `stableford` is deliberately not offered.
 *
 * The basis is an ALLOCATION — whether handicap strokes are applied — and the
 * FORMAT is the unit. That is Ajay's ruling of 2026-09-20, and `weekBasis`
 * implements it by reading the format first. A round wanting points sets its
 * format to Stableford or Modified Stableford, both of which are selectable, and
 * then says gross or net here.
 *
 * `legacy` keeps the LABEL without offering the option. Rounds written before the
 * ruling hold `scoringBasis: "stableford"` — a unit in the allocation field — and
 * they still read correctly: `weekBasis` resolves that value to points on
 * purpose, "kept, so nothing already stored changes meaning", and the summary
 * line a few hundred lines below looks a label up here. Dropping the entry
 * outright would print the raw string at an organizer instead.
 *
 * So this closes the thing `decisions-2026-09-20` asked for in its own words —
 * "the app should also stop being able to express the contradiction" — from the
 * writing side only. Nothing stored changes, and nothing stored stops working.
 */
export const BASIS_OPTIONS: Array<{ key: string; label: string; legacy?: true }> = [
  { key: "gross", label: "Gross" },
  { key: "net", label: "Net" },
  { key: "both", label: "Both" },
  { key: "stableford", label: "Stableford", legacy: true },
];


/** The ones an organizer may choose today. See `BASIS_OPTIONS`. */
export const BASIS_CHOICES = BASIS_OPTIONS.filter((o) => !o.legacy);


/**
 * SETUP IS LOCKED — provided once by `StagesClient`, read by each card.
 *
 * The actions behind most controls on this screen refuse a locked tournament.
 * They THREW until the scoped locks (state machine PR 5b), which took the page
 * down to "Application error" — the page computed the lock and only showed a
 * banner with it, so on a live tournament every one of them was offered and
 * every one crashed (swept 2026-09-27: 24 controls). They RETURN the rounds
 * lock's reason now (`refuseIfLocked(…, "rounds")`), and a press refused that
 * way catches the screen up (`useCaughtUp`). A context rather than a prop
 * threaded through three layers of cards.
 *
 * NOT everything here is behind the lock, and those stay open: a round's date,
 * its course and tees, "round finished", and the round's handicaps — and, since
 * Ajay's call of 2026-09-27 that RUNNING an event is not setting it up: adding
 * a round, drawing the next round (the server refuses a redraw of a round that
 * already has scores), the completion deadline and scoring window, and making
 * the single match or the play-off for third. Gate a new control on this only
 * when its action asks `refuseIfLocked`.
 */
export const SetupLocked = React.createContext(false);


/**
 * WHAT DAY IT IS, FROM THE SERVER — provided to every card the way the lock is.
 *
 * A round's scoring window is "open" or "closed" by the day, and this screen
 * is rendered on the server and again in the browser. Each asked its own
 * clock, so for the hours a club's evening is already tomorrow on the server
 * the two drew different words for one round — a hydration mismatch on this
 * screen (2026-10-11, `no-client-screen-draws-from-its-own-clock.test.ts`).
 */
export const ServerToday = React.createContext("");


/**
 * WHETHER THE TOURNAMENT HAS BEEN LAUNCHED — provided once, read by each card.
 *
 * The controls that are about PLAY (is this round over, the scoring window) and
 * the round's Played / Active chip were on every card from the moment it was
 * added. Walked as a new organizer on 2026-10-16: an unplayed draft offered
 * "This round is finished" with a paragraph about making the result official,
 * "Open — scores can be entered" three weeks before the round, and an undated
 * Round 1 chipped "Played". They appear once the tournament is live, or once
 * the round itself has a result or has been closed — scoring can happen before
 * launch where a result already exists, so the round's own facts count too.
 */
export const Launched = React.createContext(false);


/** Whether a stored deadline is something a date input can display. */
export function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}


export function TieRow({ question, rule, children }: { question: string; rule: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6, borderTop: "1px solid var(--color-divider)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minHeight: 44 }}>
        <span style={{ flex: "1 1 260px", minWidth: 0, fontSize: 14, lineHeight: 1.45 }}>
          <b>{question}</b> <span className="text-muted">→ {rule}</span>
        </span>
        {children && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: 44, fontSize: 13 }}
            aria-expanded={open}
            aria-label={`${open ? "Done with" : "Change"}: ${question}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Done" : "Change"}
          </button>
        )}
      </div>
      {children && open && <div style={{ paddingBottom: 6 }}>{children}</div>}
    </div>
  );
}


/**
 * How scores are recorded, in a secretary's words (2026-10-16, the review panel):
 * "Hole-by-hole result — what Match Play produces" and "Hole-by-hole scores —
 * counts for handicapping" read as one option twice.
 */
export const SCORE_WORDS: Record<string, string> = {
  "hole-results": "Who won each hole",
  "gross-cards": "Every stroke (counts for handicap)",
  "match-result": "Final result only",
};


/** Formats every golfer knows by name: no line under the picker explaining them. */
export const WELL_KNOWN_FORMATS = new Set(["Stroke Play", "Match Play", "Stableford"]);


export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="card-kicker" style={{ display: "block" }}>{children}</span>;
}


/**
 * A titled group of settings inside a round.
 *
 * The settings panel had grown into a flat column of eight sections carrying
 * equal weight — when the round is played, what it decides, how ties break —
 * so an organizer looking for one of them had to read all of them. These are
 * different KINDS of decision, made at different times by different people:
 * when scores are due is the day's admin, what the round decides is what the
 * round is FOR, and the tiebreakers are rules set once and rarely touched.
 *
 * Used at two levels now. "What this round decides" is a group at ROUND level,
 * because the per-type settings are the round's whole point and were two
 * clicks from invisible inside "Customize this round"; the rest are groups
 * inside that panel. Same component either way — the level is the claim about
 * how central the decision is, and it should be visible in one place.
 *
 * Renders nothing at all when it has no children, so a stage type that has
 * no decisions of its own does not show an empty heading — the gating stays
 * on the sections themselves rather than being duplicated here.
 */
export function SettingsGroup({
  title,
  blurb,
  children,
}: {
  /** ReactNode rather than string so a group can carry its own FieldInfo,
   *  which is where the "why does this work like that" explanation belongs
   *  once a group heading is the only heading above the controls. */
  title: React.ReactNode;
  blurb?: string;
  children: React.ReactNode;
}) {
  const kids = React.Children.toArray(children).filter(Boolean);
  if (kids.length === 0) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h4
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.01em",
            color: "var(--color-text)",
          }}
        >
          {title}
        </h4>
        {blurb && (
          <p className="text-muted" style={{ fontSize: 13, margin: "3px 0 0", lineHeight: 1.5 }}>
            {blurb}
          </p>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          paddingLeft: 12,
          borderLeft: "2px solid var(--color-divider)",
        }}
      >
        {kids}
      </div>
    </section>
  );
}


/** The round card's controls that can be refused, each with its own line. */
export type RefusedAt = "format" | "holes" | "venue" | "basis" | "input";

export type SaveAnswer = { ok: boolean; error?: string; needsConfirm?: boolean };


/** A refused save, said under the control that was pressed (`role="alert"`, so it is read out). */
export function Refused({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="form-error" role="alert" style={{ margin: "4px 0 0", fontSize: 13 }}>
      {text}
    </p>
  );
}



/** Rotating per-round accent so a page of several round cards reads as distinct at a glance. */
// Behind a press (a tie rule's own row) and writes to the server, so not part of
// the screen's first load. RoundHandicaps stays eager: it is mounted with the
// round and shows facts the organizer reads. See LazyPanel.tsx.
export const MatchTiebreakControl = dynamic(
  () => orNeedsSignal(() => import("../MatchTiebreakControl").then((m) => m.MatchTiebreakControl)),
  { ssr: false, loading: () => <PanelLoading /> },
);


// Folded under "Customize this round" (the per-player handicap list) and shown only
// when a round-robin cut is tied (the tie panel): neither is part of the screen's
// first load. See LazyPanel.tsx.
export const RoundHandicaps = dynamic(() => orNeedsSignal(() => import("../RoundHandicaps").then((m) => m.RoundHandicaps)), {
  ssr: false,
  loading: () => <PanelLoading />,
});

export const CutTiePanel = dynamic(() => orNeedsSignal(() => import("../CutReadyCard").then((m) => m.CutTiePanel)), {
  ssr: false,
  loading: () => <PanelLoading />,
});


/**
 * WHAT EVERY ROUND SHARES, SET ONCE (2026-10-16).
 *
 * Ajay, the same day: "the Rounds and format looks pretty long specially for
 * multi round tournament". A ten-week Stableford league was ten cards to open,
 * each to set the same format, holes and handicap — and ten two-line rows to
 * scroll past to see that they were the same. So, from three playing rounds:
 * one line saying what they share, and one place to change it for every round
 * nobody has played yet.
 *
 * It goes through the SAME actions a round's card uses, one round at a time, so
 * each refusal still applies: a format a round cannot be scored in is not
 * offered here either (`formatChoicesFor`, narrowed to what every round can
 * take), and a round holding a card is left as it is and named — re-scoring
 * a played round stays a decision made on that round's own card.
 */
/**
 * The countback ladder in words, read off the rule the boards apply
 * (`countbackSegments`) so the sentence cannot say one ladder while the
 * board climbs another.
 */
export function countbackInWords(holes: number): string {
  const steps = countbackSegments(holes).map((n) => (n === 1 ? "the last hole" : `the last ${["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? n}`));
  if (steps.length === 0) return "the card";
  if (steps.length === 1) return `the better ${steps[0].replace(/^the /, "")}`;
  return `the better ${steps[0].replace(/^the /, "")}, then ${steps.slice(1, -1).join(", ")}${steps.length > 2 ? " and " : ""}${steps.length > 2 ? steps[steps.length - 1] : steps[1]}`;
}

export const ROUND_PALETTE = ["var(--color-accent)", "var(--color-accent-2)", "var(--color-accent-400)", "var(--color-accent-2-400)"];
/** The round NUMBER in the same rotation, in the text steps, so it reads 7:1. */
export const ROUND_TEXT = ["var(--color-accent-200)", "var(--color-accent-2-200)", "var(--color-accent-100)", "var(--color-accent-2-100)"];
