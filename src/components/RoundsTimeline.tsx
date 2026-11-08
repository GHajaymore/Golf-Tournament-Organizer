"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { RefusedAction } from "./RefusedAction";
import type { RoundFacts } from "@/lib/rounds-timeline";
import type { CourseDay, GuideAction, RoundStepView } from "@/lib/domain/timeline-step";
import type { TournamentStep } from "@/lib/domain/tournament-step";

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
  /** "3 rounds", "31 Oct – 14 Nov", "Braid Hollow" — said once, in one line (the entry count is the subtitle's). */
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
 * WHERE THE TOURNAMENT IS — the machine's chip, in its tone, with the line under "Play over" —
 * the same words the context bar and the dashboard's status card say (`stepOf`), never a reading
 * of the stored status here (state machine PR 5c, J16).
 */
export function TimelineStep({ step }: { step: TournamentStep }) {
  return (
    <p className="rt-hero-step" data-step={step.step}>
      <span className={`tag ${step.tag}`}>{step.chip}</span>
      {step.chipDetail && <span className="text-muted rt-hero-step-detail">{step.chipDetail}</span>}
    </p>
  );
}

/**
 * WHAT NEEDS YOU — the next step, always visible (the brief's rule 3), and the consequence in
 * words, not only a chip (Ajay kept that from Concept 1).
 *
 * THE MACHINE'S ANSWER, DRAWN (state machine PR 5c, J16). The first line is `nextAction`: its
 * button is the screen's one filled button, or — refused — the shared `RefusedAction` with the
 * machine's own sentence and its way out, as the dashboard draws it. The rest is the machine's
 * list (`courseDayOf`): the steps that hold launch in setup order, each round's own needs, then
 * the launch dialog's warnings. Nothing here decides what is missing.
 */
export function NeedsYou({ guide, onOpen }: { guide: CourseDay; onOpen: (roundId: string) => void }) {
  const { lead, items } = guide;
  if (!lead && items.length === 0) return null;
  const press = (a: GuideAction, primary: boolean, round = "") =>
    a.kind === "link" ? (
      <Link href={a.href} className={primary ? "btn btn-primary rt-need-btn" : "rt-need-link"}>
        {a.says}
        {round && <span className="sr-only"> for {round}</span>}
      </Link>
    ) : (
      <button type="button" className={primary ? "btn btn-primary rt-need-btn" : "rt-need-link"} onClick={() => onOpen(a.roundId)}>
        {a.says}
      </button>
    );
  // A refused lead whose way out opens a round HERE: that button is the one to press, so it is the
  // filled one and the refused button is drawn quiet (a screen has one filled button, rule 2).
  const wayOutHere = lead && !lead.enabled && lead.wayOut?.kind === "round" ? lead.wayOut : null;
  return (
    <section className="rt-needs" aria-labelledby="rt-needs-title">
      <h2 id="rt-needs-title" className="rt-needs-title">
        Needs you <span className="rt-needs-count">{items.length + (lead ? 1 : 0)}</span>
      </h2>
      {lead && (
        <div className="rt-need rt-need-next" data-lead={lead.enabled ? "enabled" : "refused"}>
          {lead.enabled && lead.action ? (
            press(lead.action, true)
          ) : (
            <>
              <RefusedAction
                label={lead.label}
                reason={lead.disabledBecause ?? ""}
                wayOut={lead.wayOut?.kind === "link" ? { says: lead.wayOut.says, href: lead.wayOut.href } : null}
                primary={!wayOutHere}
              />
              {wayOutHere && press(wayOutHere, true)}
            </>
          )}
        </div>
      )}
      {items.length > 0 && (
        <ul className="rt-need-rest">
          {items.map((n) => (
            <li key={n.key} className="rt-need" data-holds={n.holds ? "" : undefined}>
              <p className="rt-need-words">
                {n.said && <b>{n.said}</b>}
                {n.said && n.rest ? " — " : ""}
                {n.rest}
              </p>
              {n.action && press(n.action, false, n.round)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A ROUND'S STATE CHIP on its stop on the spine — the machine's per-round step (results only,
 * D8) and its first need, worked out by `courseDayOf`. "No date" names the same gap the strip
 * lists for this round, because both are the round's `needs`.
 */
export function RoundChip({ step }: { step: RoundStepView | null }) {
  if (!step) return null;
  return <span className={`tag tag-${step.tone}`}>{step.chip}</span>;
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
