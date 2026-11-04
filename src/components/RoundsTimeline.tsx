"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { NeedItem, RoundFacts } from "@/lib/rounds-timeline";

/**
 * ROUNDS & FORMATS, STEP 2 — "COURSE DAY" (behind `?view=timeline`; Ajay, 2 Nov: "Yes, go").
 *
 * The pieces the redesign adds around the round cards. Every one of them READS: no control in
 * this file changes anything, so the round's own controls (in `StagesClient`) stay the only way
 * a round is changed, each mounted once inside `#round-<id>`.
 *
 * Richness is golf facts, not decoration (the brief's rule 6): the course's par on a printed
 * scorecard's strip, the tee times as ticks, the recipe as tiles.
 */

/** The header: the words on the left, the course beside them under the club's own veil. */
export function TimelineHero({
  club,
  event,
  title,
  line,
  facts,
  photo,
}: {
  club: string;
  event: string;
  title: ReactNode;
  line?: ReactNode;
  /** "3 rounds", "48 entered", "31 Oct – 14 Nov", "Braid Hollow" — said once, in one line. */
  facts: string[];
  /** The club's own picture when it has one; otherwise the illustrative course. */
  photo: { src: string; srcSet?: string; alt: string };
}) {
  return (
    <header className="rt-hero">
      <div className="rt-hero-words">
        <p className="rt-hero-where">
          {[club, event].filter(Boolean).join(" · ")}
        </p>
        {title}
        {line}
        {facts.length > 0 && (
          <ul className="rt-hero-facts" aria-label="This tournament at a glance">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
      {/* BESIDE THE WORDS, NEVER UNDER A FIGURE (the brief): the picture has a column of its own.
          Under a veil of the club's own colours so it reads as the club's, not as stock. */}
      <div className="rt-hero-photo" aria-hidden={photo.alt ? undefined : true}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed, pre-sized webp; next/image would add a loader for one picture */}
        <img src={photo.src} srcSet={photo.srcSet} sizes="(max-width: 720px) 100vw, 40vw" alt={photo.alt} loading="eager" decoding="async" />
      </div>
    </header>
  );
}

/**
 * WHAT NEEDS YOU — the next step, always visible (the brief's rule 3), and the consequence in
 * words, not only a chip (Ajay kept that from Concept 1). The first item is the one next thing,
 * and its button is the screen's one filled button; the rest are quiet links.
 */
export function NeedsYou({ items, onOpen }: { items: NeedItem[]; onOpen: (roundId: string) => void }) {
  if (items.length === 0) return null;
  const [next, ...rest] = items;
  const action = (n: NeedItem, primary: boolean) =>
    n.fix === "tee-sheet" ? (
      <Link href={`/foursomes?round=${n.roundId}`} className={primary ? "btn btn-primary rt-need-btn" : "rt-need-link"}>
        Tee sheet <span className="sr-only">for {n.round}</span>
      </Link>
    ) : (
      <button type="button" className={primary ? "btn btn-primary rt-need-btn" : "rt-need-link"} onClick={() => onOpen(n.roundId)}>
        Open {n.round}
      </button>
    );
  return (
    <section className="rt-needs" aria-labelledby="rt-needs-title">
      <h2 id="rt-needs-title" className="rt-needs-title">
        Needs you <span className="rt-needs-count">{items.length}</span>
      </h2>
      <div className="rt-need rt-need-next">
        <p className="rt-need-words">
          <b>{next.round} {next.missing}</b> — {next.consequence}.
        </p>
        {action(next, true)}
      </div>
      {rest.length > 0 && (
        <ul className="rt-need-rest">
          {rest.map((n) => (
            <li key={`${n.roundId}-${n.missing}`} className="rt-need">
              <p className="rt-need-words">
                <b>{n.round} {n.missing}</b> — {n.consequence}.
              </p>
              {action(n, false)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A round's recipe as three small tiles: holes, the format (highlighted), how it is scored. */
export function RecipeTiles({ holes, format, basis }: { holes: number; format: string; basis: string }) {
  return (
    <span className="rt-tiles">
      <span className="rt-tile">{holes} holes</span>
      <span className="rt-tile rt-tile-format">{format}</span>
      {basis && <span className="rt-tile">{basis}</span>}
    </span>
  );
}

/**
 * THE FIELD AS TEE TIMES: one tick per group on the SAVED sheet. Before a sheet is saved the
 * track is empty and dashed — nothing is drawn that has not been decided.
 */
export function TeeTicks({ facts }: { facts: RoundFacts }) {
  if (!facts.hasSheet) return <span className="rt-ticks rt-ticks-none" aria-hidden="true" />;
  return (
    <span className="rt-ticks" aria-hidden="true">
      {Array.from({ length: Math.min(facts.groups, 40) }, (_, i) => (
        <span key={i} className="rt-tick" />
      ))}
    </span>
  );
}

/** The muted facts under a round: course · players · groups · first tee. */
export function factsLine(f: RoundFacts): string {
  return [
    f.courseName,
    f.players ? `${f.players} ${f.players === 1 ? "player" : "players"}` : "",
    f.hasSheet ? `${f.groups} ${f.groups === 1 ? "group" : "groups"}` : "",
    f.hasSheet && f.firstTee ? (f.startType === "shotgun" ? `shotgun ${f.firstTee}` : f.lastTee ? `${f.firstTee}–${f.lastTee}` : `from ${f.firstTee}`) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The course as a printed scorecard shows it: its name, par strip (3s and 5s tinted), and tees. */
export function CourseCard({ facts, holes }: { facts: RoundFacts; holes: number }) {
  if (!facts.courseName) return null;
  const par = facts.pars.reduce((a, b) => a + b, 0);
  return (
    <div className="rt-course">
      <div className="rt-course-head">
        <span className="rt-course-name">{facts.courseName}</span>
        {par > 0 && (
          <span className="text-muted rt-course-par">
            {holes} holes · par {par}
          </span>
        )}
      </div>
      {facts.pars.length > 0 ? (
        <ol className="rt-holes" aria-label={`Par for each hole: ${facts.pars.join(", ")}`}>
          {facts.pars.map((p, i) => (
            <li key={i} className="rt-hole" data-par={p === 3 ? "3" : p >= 5 ? "5" : undefined} aria-hidden="true">
              {p}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted rt-course-none">
          <Icon name="warning" /> No card for this course yet — its scores cannot be worked out until there is one.
        </p>
      )}
      {facts.tees.length > 0 && (
        <ul className="rt-tees">
          {facts.tees.map((t) => (
            <li key={t.name}>
              <span>{t.name}</span>
              <span className="text-muted">
                Par {t.par}
                {t.rating > 0 && t.slope > 0 ? ` · ${t.rating.toFixed(1)} / ${t.slope}` : " · not rated"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One of the panel's four numbered golf sections, with the line saying what it decides. */
export function PanelSection({ n, title, decides, aside, children }: { n: number; title: string; decides: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="rt-sect">
      <div className="rt-sect-head">
        <span className="rt-sect-n" aria-hidden="true">{n}</span>
        <h3 className="rt-sect-title">{title}</h3>
        {aside && <span className="rt-sect-aside">{aside}</span>}
      </div>
      <p className="rt-sect-decides">{decides}</p>
      {children}
    </div>
  );
}
