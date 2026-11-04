"use client";
import { useId, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createEventFromAnswers } from "@/app/actions/tournament";
import {
  BASIS_CHOICES,
  KEEPER_CHOICES,
  RUNNING_CHOICES,
  basisAsked,
  choiceLabel,
  countQuestion,
  defaultAnswers,
  draftAllowances,
  draftFromAnswers,
  reconcile,
  scoringChoices,
  sidesChoices,
  suggestedName,
  type Choice,
  type SetupAnswers,
} from "@/lib/domain/setup-questions";
import type { GolfRegister } from "@/lib/domain/golf-terms";
import { formatDay } from "@/lib/domain/locale";
import { ORG_KINDS, isOrgKind, orgProfile } from "@/lib/domain/org-profile";
import { isKnockoutRound } from "@/lib/stage-types";
import { readWhole } from "@/lib/domain/decimal-text";
import { Icon } from "./Icon";

export interface SetupOrg {
  id: string;
  name: string;
  /** The club's today, in its own time zone (`clubToday`). */
  today: string;
  locale: string;
  register: GolfRegister;
}

export interface SetupTee {
  id: string;
  name: string;
  gender: string;
  courseRating: number;
  slopeRating: number;
  par: number;
  rated: boolean;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
}

export interface SetupCourse {
  id: string;
  organizationId: string;
  name: string;
  checked: boolean;
  tees: SetupTee[];
}

type QuestionKey = "running" | "sides" | "scoring" | "basis" | "when" | "keeper";
type Phase = "questions" | "review" | "card" | "confirm";

const CSS = `
.sq-choice { text-align: left; padding: 12px 14px; border-radius: 10px; cursor: pointer; color: var(--color-text);
  background: var(--color-bg); border: 1px solid var(--color-divider); width: 100%; }
.sq-choice[aria-pressed="true"] { background: color-mix(in srgb, var(--color-accent) 14%, transparent); border-color: var(--color-accent); }
.sq-steps { display: grid; gap: 14px; }
.sq-nav-phone { display: none; }
@media (max-width: 760px) {
  .sq-step[data-current="false"] { display: none; }
  .sq-nav-phone { display: flex; }
  .sq-nav-desk { display: none; }
}
.sq-card-wrap { overflow-x: auto; min-width: 0; }
.sq-card { border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.sq-card th, .sq-card td { padding: 4px 7px; text-align: center; border-bottom: 1px solid var(--color-divider); white-space: nowrap; }
.sq-card th:first-child, .sq-card td:first-child { text-align: left; position: sticky; left: 0; background: var(--color-surface); }
.sq-line { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--color-divider); }
.sq-line > div { min-width: 0; }
`;

/**
 * THE SETUP QUESTIONNAIRE'S SCREENS — questions, then the last 10% Ajay named
 * on 2 Nov: change anything (review), check the scorecard, confirm.
 *
 * One question per screen on a phone and one compact form on a desktop, from
 * the same markup (`.sq-step[data-current]`). Every answer is pre-chosen, kept
 * when going back, and reconciled when an earlier answer changes what a later
 * question offers (`reconcile`). Nothing is created until "Create the draft".
 */
export function SetupQuestions({
  orgs,
  courses,
  organizationNamed,
  clubSteps,
  orgKind,
  orgCountry,
  orgNoun,
}: {
  orgs: SetupOrg[];
  courses: SetupCourse[];
  organizationNamed: boolean;
  clubSteps: Array<{ key: string; title: string; href: string }>;
  orgKind: string;
  orgCountry: string;
  orgNoun: string;
}) {
  const fid = useId();
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const org = orgs.find((o) => o.id === orgId) ?? orgs[0];
  const register = org.register;
  const [answers, setAnswers] = useState<SetupAnswers>(() => defaultAnswers(register, org.today));
  const [nameTouched, setNameTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("questions");
  const [step, setStep] = useState(0);
  const [refusal, setRefusal] = useState("");
  const [sameName, setSameName] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [kindChoice, setKindChoice] = useState(isOrgKind(orgKind) ? orgKind : "personal");
  const [pending, startTransition] = useTransition();
  const outfit = orgProfile(orgKind, orgCountry, orgNoun);
  const clubNameRequired = clubSteps.some((s) => s.key === "profile");
  const elsewhere = clubSteps.filter((s) => s.key !== "profile");

  const set = (patch: Partial<SetupAnswers>) => {
    setRefusal("");
    setSameName(false);
    setAnswers((a) => {
      const next = reconcile({ ...a, ...patch }, register);
      // The suggested name follows the answers until the organizer types one.
      return nameTouched ? next : { ...next, name: suggestedName(next) };
    });
  };
  const current: SetupAnswers = nameTouched ? answers : { ...answers, name: answers.name || suggestedName(answers) };

  // Which questions apply — asked again on every answer, since an answer can add or remove one.
  const questions: QuestionKey[] = ["running"];
  if (current.running !== "casual") {
    if (sidesChoices(current.running).length > 1) questions.push("sides");
    if (scoringChoices(current.running, current.sides, register).length > 1) questions.push("scoring");
    if (basisAsked(current)) questions.push("basis");
    questions.push("when", "keeper");
  }
  const at = Math.min(step, questions.length - 1);

  const draft = current.running === "casual" ? null : draftFromAnswers(current);
  const dayWords = (iso: string) => (iso ? formatDay(iso, org.locale) : "no fixed day");
  const orgCourses = courses.filter((c) => !orgId || c.organizationId === orgId);
  const course = orgCourses.find((c) => c.id === current.courseId) ?? null;
  const tee = course?.tees.find((t) => t.id === current.teeId) ?? null;

  const change = (q: QuestionKey) => {
    setPhase("questions");
    setStep(Math.max(0, questions.indexOf(q)));
  };

  const submit = (confirmed: boolean) => {
    setRefusal("");
    startTransition(async () => {
      const res = await createEventFromAnswers({
        answers: current,
        orgName,
        orgKind: orgName.trim() ? kindChoice : undefined,
        organizationId: orgId || undefined,
        confirmedClubName: confirmed,
      });
      if (res?.ok) {
        // Fixing the card: the course library's own card screen, opened on this course.
        router.push(
          current.fixCard ? (current.courseId ? `/event?course=${encodeURIComponent(current.courseId)}#courses` : "/event#courses") : "/dashboard",
        );
        return;
      }
      setRefusal(res?.error ?? "That could not be created.");
      if (res?.clubExists) setSameName(true);
    });
  };

  const choices = <T extends string>(
    label: string,
    list: Choice<T>[],
    value: T,
    onPick: (v: T) => void,
  ) => (
    <div className="field">
      <label id={`${fid}-${label}`} style={{ fontSize: 15, fontWeight: 600 }}>{label}</label>
      <div role="group" aria-labelledby={`${fid}-${label}`} style={{ display: "grid", gap: 8, marginTop: 6 }}>
        {list.map((c, i) => (
          <button key={c.value} type="button" className="sq-choice" aria-pressed={c.value === value} onClick={() => onPick(c.value)}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {c.label}
              {i === 0 && <span className="text-muted" style={{ fontWeight: 400 }}> · usual choice</span>}
            </div>
            <div className="text-muted" style={{ fontSize: 13, marginTop: 2, lineHeight: 1.4 }}>{c.why}</div>
          </button>
        ))}
      </div>
    </div>
  );

  const countQ = countQuestion(current.running);
  const renderQuestion = (q: QuestionKey) => {
    switch (q) {
      case "running":
        return (
          <>
            {choices("What are you running?", RUNNING_CHOICES, current.running, (v) => set({ running: v }))}
            {current.running === "casual" && (
              <p style={{ fontSize: 14, margin: "10px 0 0" }}>
                A casual round has its own one-screen setup.{" "}
                <Link href="/match/new" className="btn btn-primary" style={{ marginLeft: 6 }}>
                  Set up a casual round <Icon name="arrow-right" />
                </Link>
              </p>
            )}
          </>
        );
      case "sides":
        return choices("How do players play?", sidesChoices(current.running), current.sides, (v) => set({ sides: v }));
      case "scoring":
        return choices("How is it scored?", scoringChoices(current.running, current.sides, register), current.scoring, (v) => set({ scoring: v }));
      case "basis":
        return choices("Off handicap or scratch?", BASIS_CHOICES, current.basis, (v) => set({ basis: v }));
      case "keeper":
        return choices("Who keeps the scores?", KEEPER_CHOICES, current.keeper, (v) => set({ keeper: v }));
      case "when":
        return (
          <div className="field">
            <label htmlFor={`${fid}-first`} style={{ fontSize: 15, fontWeight: 600 }}>
              {current.running === "knockout" ? "When does it start?" : current.running === "league" ? "When is week one?" : "When is the first day?"}
            </label>
            <input
              id={`${fid}-first`}
              className="input"
              type="date"
              min={org.today}
              value={current.firstDay}
              onChange={(e) => set({ firstDay: e.target.value })}
              style={{ maxWidth: 220 }}
            />
            <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
              The next Saturday is chosen for you — most events are played on one. Every date stays editable.
            </p>
            {countQ && (
              <div style={{ marginTop: 12 }}>
                <label htmlFor={`${fid}-count`} style={{ fontSize: 14, fontWeight: 600 }}>{countQ.label}</label>
                <input
                  id={`${fid}-count`}
                  className="input"
                  type="number"
                  min={countQ.min}
                  max={countQ.max}
                  value={current.count}
                  onChange={(e) => {
                    // A blank or a typo keeps the usual number; `reconcile` holds it inside the bounds.
                    const typed = readWhole(e.target.value);
                    set({ count: typed.kind === "number" ? typed.value : countQ.fallback });
                  }}
                  style={{ maxWidth: 120 }}
                />
                <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                  {current.running === "league" ? "One round a week, on the same day." : "On consecutive days, starting the first day."}
                </p>
              </div>
            )}
          </div>
        );
    }
  };

  const nav = (back: (() => void) | null, next: (() => void) | null, nextLabel = "Next") => (
    <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 4 }}>
      {back ? (
        <button type="button" className="btn btn-secondary" onClick={back}>
          <Icon name="arrow-left" /> Back
        </button>
      ) : <span />}
      {next && (
        <button type="button" className="btn btn-primary" onClick={next}>
          {nextLabel} <Icon name="arrow-right" />
        </button>
      )}
    </div>
  );

  // ── Questions ─────────────────────────────────────────────────────────────
  if (phase === "questions") {
    const last = at === questions.length - 1;
    const casual = current.running === "casual";
    return (
      <section className="card elev-sm" style={{ gap: 14 }} aria-label="Set up with a few questions">
        <style>{CSS}</style>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Set up with a few questions</h1>
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            Each one is already answered with the usual choice. You see the whole tournament before anything is made.
          </p>
          <p className="text-muted sq-nav-phone" style={{ fontSize: 13, margin: "6px 0 0" }}>
            Question {at + 1} of {questions.length}
          </p>
        </div>
        <div className="sq-steps">
          {questions.map((q, i) => (
            <div key={q} className="sq-step" data-current={i === at ? "true" : "false"}>
              {renderQuestion(q)}
            </div>
          ))}
        </div>
        {!casual && (
          <>
            <div className="sq-nav-phone" style={{ flexDirection: "column" }}>
              {nav(
                at > 0 ? () => setStep(at - 1) : null,
                last ? () => setPhase("review") : () => setStep(at + 1),
                last ? "See your tournament" : "Next",
              )}
            </div>
            <div className="sq-nav-desk">{nav(null, () => setPhase("review"), "See your tournament")}</div>
          </>
        )}
      </section>
    );
  }

  if (!draft) return null;
  const allowances = draftAllowances(draft);

  // ── Review: change anything ───────────────────────────────────────────────
  if (phase === "review") {
    const line = (label: string, value: ReactNode, q?: QuestionKey) => (
      <div className="sq-line">
        <div>
          <div className="text-muted" style={{ fontSize: 13 }}>{label}</div>
          <div style={{ fontSize: 14, marginTop: 2 }}>{value}</div>
        </div>
        {q && (
          <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: "3px 10px", flex: "none" }} onClick={() => change(q)}>
            Change
          </button>
        )}
      </div>
    );
    const how =
      current.running === "cup"
        ? "Two teams, three sessions: four-balls, foursomes, singles"
        : current.running === "knockout"
          ? `${current.sides === "pairs" ? "Four-ball" : "Singles"} match play, one bracket`
          : `${choiceLabel("sides", current.sides)} · ${choiceLabel("scoring", current.scoring)}`;
    return (
      <section className="card elev-sm" style={{ gap: 6 }} aria-label="Your tournament">
        <style>{CSS}</style>
        <h1 style={{ fontSize: 20, margin: 0 }}>Here is your tournament — change anything</h1>
        <p className="text-muted" style={{ fontSize: 13, margin: "2px 0 8px" }}>
          Nothing is made yet. Next you check the scorecard, then create it as a draft.
        </p>
        <div className="field" style={{ marginBottom: 4 }}>
          <label htmlFor={`${fid}-name`}>Tournament name</label>
          <input
            id={`${fid}-name`}
            className="input"
            value={current.name}
            maxLength={80}
            onChange={(e) => {
              setNameTouched(true);
              setAnswers((a) => ({ ...a, name: e.target.value }));
            }}
          />
        </div>
        {line("What", choiceLabel("running", current.running), "running")}
        {line("How it is played", how, sidesChoices(current.running).length > 1 ? "sides" : scoringChoices(current.running, current.sides, register).length > 1 ? "scoring" : undefined)}
        {line(
          draft.rounds.length === 1 ? "Round" : `Rounds (${draft.rounds.length})`,
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {draft.rounds.map((r, i) => (
              <li key={i}>
                {r.description ? `${r.description} — ` : ""}
                {r.format}, {r.holes} holes{isKnockoutRound(r.type) ? ", knockout bracket" : ""} · {dayWords(r.playedOn)}
              </li>
            ))}
          </ul>,
          "when",
        )}
        {line(
          "Handicaps",
          draft.rounds.every((r) => r.scoringBasis === "gross")
            ? "Scratch — no strokes given"
            : allowances.map((x) => `${x.percent}% for ${x.format}`).join(" · ") +
              " — the Rules of Handicapping's figure for that format. A committee can change it per round.",
          basisAsked(current) ? "basis" : undefined,
        )}
        {line("Scores", choiceLabel("keeper", current.keeper), "keeper")}
        {line("Flights", current.running === "cup" ? "Your two teams, picked on the Team cup screen" : "One field — divided on Flights once entries are in")}
        {line("Tee sheet", "Drawn on Tee sheet once entries are in (first tee 08:00 unless you change it)")}
        {line("Contests, side games and money", "Off — add them later on Contests and Side games if you want them")}
        {line("Status", "A draft. Nothing is published and nobody is invited.")}
        {nav(() => change(questions[questions.length - 1]), current.name.trim() ? () => setPhase("card") : null, "Check the scorecard")}
        {!current.name.trim() && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Give it a name first.</p>}
      </section>
    );
  }

  // ── The scorecard ─────────────────────────────────────────────────────────
  if (phase === "card") {
    const noTees = course !== null && course.tees.length === 0;
    const ready = !course || (tee !== null && current.cardChecked);
    const rows = tee
      ? [
          { label: "Hole", cells: tee.pars.map((_, i) => String(i + 1)), total: "Total" },
          { label: "Par", cells: tee.pars.map(String), total: String(tee.pars.reduce((s, n) => s + n, 0)) },
          { label: "Stroke index", cells: tee.strokeIndex.map(String), total: "" },
          { label: "Yards", cells: tee.yards.map(String), total: tee.yards.length ? String(tee.yards.reduce((s, n) => s + n, 0)) : "" },
        ]
      : [];
    return (
      <section className="card elev-sm" style={{ gap: 12 }} aria-label="Check the scorecard">
        <style>{CSS}</style>
        <h1 style={{ fontSize: 20, margin: 0 }}>Check the scorecard</h1>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Every net score is worked from this card — par, stroke index and the tees&rsquo; rating and slope. Hold it beside the
          club&rsquo;s own card.
        </p>
        {orgs.length > 1 && (
          <div className="field">
            <label htmlFor={`${fid}-org`}>Who is this for?</label>
            <select
              id={`${fid}-org`}
              className="input"
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                set({ courseId: "", teeId: "", cardChecked: false, fixCard: false });
              }}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${fid}-course`}>Course</label>
          <select
            id={`${fid}-course`}
            className="input"
            value={current.courseId}
            onChange={(e) => {
              const c = orgCourses.find((x) => x.id === e.target.value);
              set({ courseId: c?.id ?? "", teeId: "", cardChecked: false, fixCard: false });
            }}
          >
            <option value="">I&rsquo;ll pick the course later</option>
            {orgCourses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {!course && (
            <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
              {orgCourses.length === 0
                ? "No courses saved yet. Add yours on Tournament details after the draft is made — net scores wait on its card."
                : "Fine for now — net scores wait on the course and its tees, which the setup checklist will remind you of."}
            </p>
          )}
        </div>
        {noTees && (
          <p className="form-error" role="alert" style={{ margin: 0 }}>
            {course?.name} has no tees yet, so nobody&rsquo;s handicap could be worked out on it. Add them with Fix the card below, or
            pick the course later.
          </p>
        )}
        {course && course.tees.length > 0 && (
          <div className="field">
            <label htmlFor={`${fid}-tee`}>Tees the field plays from</label>
            <select
              id={`${fid}-tee`}
              className="input"
              value={current.teeId}
              onChange={(e) => set({ teeId: e.target.value, cardChecked: false, fixCard: false })}
            >
              {/* Nothing pre-chosen: which set the field plays is the organizer's decision. */}
              <option value="">Choose the tees</option>
              {course.tees.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.gender !== "any" ? ` (${t.gender})` : ""}</option>
              ))}
            </select>
          </div>
        )}
        {tee && (
          <>
            <p style={{ fontSize: 14, margin: 0 }}>
              <b>{tee.name}</b>: par {tee.par}
              {tee.rated ? ` · course rating ${tee.courseRating} · slope ${tee.slopeRating}` : ""}
            </p>
            {!tee.rated && (
              <p className="form-error" role="alert" style={{ margin: 0 }}>
                These tees have no slope rating yet, so net scores would use raw handicap indexes. Add the rating and slope on
                Tournament details, or choose rated tees.
              </p>
            )}
            {rows[0].cells.length > 0 ? (
              <div className="sq-card-wrap">
                <table className="sq-card">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        {r.cells.map((c, i) => (r.label === "Hole" ? <th key={i} scope="col">{c}</th> : <td key={i}>{c}</td>))}
                        {r.label === "Hole" ? <th scope="col">{r.total}</th> : <td><b>{r.total}</b></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="form-error" role="alert" style={{ margin: 0 }}>This card has no holes saved. Add them on Tournament details.</p>
            )}
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={current.cardChecked} onChange={(e) => set({ cardChecked: e.target.checked, fixCard: false })} />
              This matches the club&rsquo;s card
            </label>
          </>
        )}
        {/* UPDATE, LOAD OR PHOTOGRAPH THE CARD (Ajay, 3 Nov) — through the course
            library itself, never a second card editor: every hole's par, index and
            yards, each tee's rating and slope, adding tees, pasting the card, looking
            it up in the catalogue, or reading a photo of the club's card. Those act on
            a tournament's club, so the draft is made first and Tournament details opens
            on this course's card; its "Mark as checked" is then the tick. */}
        <div className="card" style={{ gap: 6, padding: "10px 12px" }}>
          <p style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>
            {course ? "Card wrong or missing something?" : "Course not saved yet?"}
          </p>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            {course
              ? "Edit any hole’s par, stroke index or yards and each tee’s rating and slope, add tees, paste the card, look it up, or read a photo of the club’s card — on the course’s own card screen, which opens as soon as the draft is made. Mark it as checked there."
              : "Look it up, paste its card or read a photo of the club’s card on the courses screen, which opens as soon as the draft is made."}
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ alignSelf: "flex-start" }}
            onClick={() => {
              set({ fixCard: true, cardChecked: false });
              setPhase("confirm");
            }}
          >
            <Icon name="pencil-simple" /> {course ? "Fix the card" : "Add the course"}
          </button>
        </div>
        {nav(() => setPhase("review"), ready && !noTees ? () => setPhase("confirm") : null, "Confirm")}
      </section>
    );
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  const blocked = elsewhere.length > 0 || (clubNameRequired && !orgName.trim());
  return (
    <section className="card elev-sm" style={{ gap: 12 }} aria-label="Confirm">
      <style>{CSS}</style>
      <h1 style={{ fontSize: 20, margin: 0 }}>Ready to make the draft</h1>
      <p style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
        <b>{current.name}</b> — {choiceLabel("running", current.running).toLowerCase()},{" "}
        {draft.rounds.length === 1 ? "one round" : `${draft.rounds.length} rounds`}
        {draft.startOn ? `, from ${dayWords(draft.startOn)}` : ""}
        {course && tee ? `, at ${course.name} off the ${tee.name} tees` : course ? `, at ${course.name}` : ", course to be picked"}. Saved
        as a draft: nothing is published and nobody is invited until you say so.
        {current.fixCard && (course ? ` Then ${course.name}’s card opens for you to fix and mark as checked.` : " Then the courses screen opens for you to add yours.")}
      </p>
      {!organizationNamed && (clubNameRequired || orgs[0]?.id === "") && (
        <div className="field">
          <label htmlFor={`${fid}-org-name`}>
            Who&rsquo;s running this?{" "}
            <span className="text-muted" style={{ fontWeight: 400 }}>
              {clubNameRequired ? "— set once for every tournament" : "— club, group or company (optional)"}
            </span>
          </label>
          <input id={`${fid}-org-name`} className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          {orgName.trim() && (
            <div className="seg" role="radiogroup" aria-label="What kind of outfit runs it" style={{ marginTop: 8 }}>
              {ORG_KINDS.map((k) => (
                <label key={k} className="seg-opt">
                  <input type="radio" name={`${fid}-org-kind`} checked={kindChoice === k} onChange={() => setKindChoice(k)} />
                  {orgProfile(k, orgCountry, orgNoun).label}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {elsewhere.length > 0 && (
        <div style={{ fontSize: 13, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <span className="text-muted">Set up your {outfit.noun} first — it is answered once, for every tournament:</span>
          {elsewhere.map((s) => (
            <a key={s.key} className="btn btn-secondary" style={{ fontSize: 13, padding: "3px 10px" }} href={s.href}>
              {s.title}
            </a>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" onClick={() => setPhase("card")} disabled={pending}>
          <Icon name="arrow-left" /> Back
        </button>
        <button type="button" className="btn btn-primary" disabled={pending || blocked} onClick={() => submit(sameName)}>
          {pending ? "Creating…" : sameName ? `Create a separate ${outfit.noun} anyway` : current.fixCard ? "Create the draft and open the card" : "Create the draft"} <Icon name="arrow-right" />
        </button>
      </div>
      {refusal && (
        <p className="form-error" role={sameName ? "status" : "alert"} style={{ margin: 0 }}>
          {refusal}
        </p>
      )}
    </section>
  );
}
