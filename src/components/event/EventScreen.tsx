"use client";
import { useState, useTransition, type ReactNode } from "react";
import { saveEvent, setTournamentDates } from "@/app/actions/tournament";
import { setEventDefaultTee } from "@/app/actions/courses";
import { saveTournamentSettings } from "@/app/actions/settings";
import { eventSavePlan, runSavePlan, type StepResult } from "./event-save-plan";
import { formatDayRange, DEFAULT_LOCALE } from "@/lib/domain/locale";
import { overallResultLabel } from "@/lib/domain/overall-result";
import { playKindsFor } from "@/lib/domain/play-kind";
import type { Mark } from "@/lib/domain/setup-field";
import type { CorrectionFacts, ScopeLock } from "@/lib/domain/tournament-status";
import { type TournamentSettings } from "@/lib/tournament-settings";
import { bringIntoView } from "@/lib/bring-into-view";
import { useGolfRegister } from "@/components/GolfTermsProvider";
import { Icon } from "@/components/Icon";
import { StickySave } from "@/components/StickySave";
import { useCaughtUp } from "@/components/useAction";
import { LockedOnce } from "@/components/setup/LockedOnce";
import { SectionFold } from "@/components/setup/SectionFold";
import { MARK_WORDS, SetupField } from "@/components/setup/SetupField";
import { EventTees, type TeeOption } from "./EventTees";
import { EventVenues } from "./EventVenues";
import { EventWhat } from "./EventWhat";
import { EventWhen } from "./EventWhen";
import { EventWhere, type CourseOption } from "./EventWhere";

/** The event as the form holds it. The entry terms and the field size are not this screen's: they are kept as stored. */
export interface EventScreenForm {
  name: string;
  playKind: string;
  startOn: string;
  endOn: string;
  dates: string;
  datesTentative: boolean;
  format: string;
  course: string;
  courseId: string;
  courseMode: string;
  city: string;
  address: string;
  /** Sent back as it is stored: `saveEvent` takes it, and this screen no longer asks it. */
  playerCountMode: string;
}

export interface EventScreenProps {
  initial: EventScreenForm;
  locale?: string;
  /** The details are locked: the values read as text and only the dates are kept, by the one Save. */
  locked: boolean;
  canEdit: boolean;
  courses: CourseOption[];
  /** The courses the event is played on now (`EventCourse`), by id. */
  venueIds: readonly string[];
  /** `whereOf`'s answer for what is stored, read by the page. */
  where: "one" | "several" | "open" | "unset";
  tees: TeeOption[];
  defaultTeeId: string | null;
  teesDoor: string | null;
  teePolicy: TournamentSettings["teePolicy"];
  /** The playing rounds' formats: the overall result is asked only once there is a round. */
  roundFormats: readonly string[];
  /** The machine's marks (`markOf`), read by the page. */
  marks: { name: Mark | null; dates: Mark | null; where: Mark | null };
  lock: { locks: ScopeLock[]; correction: CorrectionFacts | null; isAdmin: boolean; open: readonly string[] | null };
  /** Where the club adds a course, or null while Courses is not shown. */
  addCourseHref: string | null;
  /** This screen is where `/event#courses` lands (the library is not drawn below it), so Where carries that anchor. */
  coursesAnchor: boolean;
  /** Dates and money for this event, under More (its own control, its own press). */
  formatting: ReactNode;
}

const MarkChip = ({ mark }: { mark: Mark | null }) =>
  mark === null ? null : (
    <span
      data-mark={mark}
      style={{ marginLeft: 8, padding: "1px 8px", borderRadius: 999, border: "1px solid var(--color-warning)", color: "var(--color-warning)", fontSize: "0.8125rem", whiteSpace: "nowrap", fontWeight: 400 }}
    >
      {MARK_WORDS[mark]}
    </span>
  );

/**
 * EVENT, AS REDESIGNED (R3): what, when, where, and ONE Save. Drawn only while the Event screen is shown (`shown.has("event")`).
 *
 * The one Save keeps everything on this screen in one press. While the details are open it calls `saveEvent` (the name,
 * the kind, the days, the course and the overall result), then the tees if they changed. While the details are locked it
 * calls `setTournamentDates` ALONE, because the days outlive the lock; the other values read as text under one banner
 * (`LockedOnce`). It never calls both on one press: a half-saved event is worse than two buttons. A refusal is said beside
 * the button, and if the details were kept but the tees were refused it says exactly that.
 *
 * "More than one course" is ticked in `EventVenues`, which keeps each tick as it is made (the venue action's own press).
 * "Players arrange their own" sits under More. The entry terms and the field size are not here: they are on Entries.
 */
export function EventScreen(p: EventScreenProps) {
  const locale = p.locale ?? DEFAULT_LOCALE;
  const register = useGolfRegister();
  const caughtUp = useCaughtUp();
  const [f, setF] = useState<EventScreenForm>(p.initial);
  const [snapshot, setSnapshot] = useState<EventScreenForm>(p.initial);
  const [teeId, setTeeId] = useState<string | null>(p.defaultTeeId);
  const [keptTee, setKeptTee] = useState<string | null>(p.defaultTeeId);
  const [teePolicy, setTeePolicy] = useState(p.teePolicy);
  const [keptPolicy, setKeptPolicy] = useState(p.teePolicy);
  const [several, setSeveral] = useState(p.where === "several");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [courseAdding, setCourseAdding] = useState(false);

  const byName = new Map(p.courses.map((c) => [c.name, c.id]));
  const [courseSelect, setCourseSelect] = useState(
    p.initial.courseMode === "open"
      ? ""
      : p.initial.courseId
        ? p.initial.courseId
        : p.initial.course === ""
          ? ""
          : (byName.get(p.initial.course) ?? "__other"),
  );
  const arrange = f.courseMode === "open";

  const detailsDirty = JSON.stringify(f) !== JSON.stringify(snapshot);
  const datesDirty =
    f.startOn !== snapshot.startOn || f.endOn !== snapshot.endOn || f.datesTentative !== snapshot.datesTentative || f.dates !== snapshot.dates;
  const teeDirty = teeId !== keptTee;
  const policyDirty = teePolicy !== keptPolicy;
  // The tees belong to the SAVED course: while the course is changed and not yet kept, the picker is shut.
  const courseDirty = f.courseId !== snapshot.courseId || f.course !== snapshot.course || f.courseMode !== snapshot.courseMode;
  const dirty = (p.locked ? datesDirty : detailsDirty) || teeDirty || policyDirty;
  /** A change of course drops any tee picked for the old one. */
  const courseChanged = () => setTeeId(keptTee);

  const set = <K extends keyof EventScreenForm>(k: K, v: EventScreenForm[K]) => setF((prev) => ({ ...prev, [k]: v }));

  /** The days, and the sentence derived from them in the club's own order: never typed. */
  const setDays = (start: string, end: string) =>
    setF((prev) => ({ ...prev, startOn: start, endOn: end, dates: start ? formatDayRange(start, end || start, locale) : prev.dates }));
  const onStart = (v: string) => setDays(v, f.endOn || v);
  const onEnd = (v: string) => setDays(f.startOn || v, v);

  const onSelectCourse = (val: string, taken?: { name: string; city: string }) => {
    setCourseSelect(val);
    courseChanged();
    if (val === "") setF((prev) => ({ ...prev, course: "", city: "", address: "", courseId: "", courseMode: "fixed" }));
    else if (val === "__other") setF((prev) => ({ ...prev, course: "", courseId: "", courseMode: "fixed" }));
    else {
      const c = p.courses.find((x) => x.id === val) ?? (taken ? { id: val, ...taken, address: "" } : null);
      if (c) setF((prev) => ({ ...prev, course: c.name, city: c.city, address: c.address, courseId: c.id, courseMode: "fixed" }));
    }
  };

  const onArrange = (on: boolean) => {
    courseChanged();
    if (on) {
      // An open event has no course until a card is entered, and a stale name would score every match against a venue nobody played.
      setCourseSelect("");
      setF((prev) => ({ ...prev, course: "", city: "", address: "", courseId: "", courseMode: "open" }));
    } else {
      setF((prev) => ({ ...prev, courseMode: "fixed" }));
    }
  };

  const save = () => {
    setError("");
    // ONE plan, run in order, stopping at the first failure: only what is left is sent, so a retry finishes the rest.
    const plan = eventSavePlan({ locked: p.locked, details: detailsDirty, dates: datesDirty, tee: teeDirty && !courseDirty, policy: policyDirty });
    const name = f.name.trim();
    if (plan.includes("saveEvent") && !name) {
      setError("Name the tournament before saving.");
      return;
    }
    const sent = f;
    const sentTee = teeId;
    const sentPolicy = teePolicy;
    startTransition(async () => {
      // A refusal or a throw both come back as words beside Save (`runSavePlan`); neither reaches the error page.
      const { error: said } = await runSavePlan(
        plan,
        async (step): Promise<StepResult> => {
          if (step === "saveEvent") {
            const r = caughtUp(
              await saveEvent({
                name,
                playKind: sent.playKind,
                dates: sent.dates,
                datesTentative: sent.datesTentative,
                startOn: sent.startOn,
                endOn: sent.endOn,
                format: sent.format,
                course: sent.course,
                courseId: sent.courseId,
                city: sent.city,
                address: sent.address,
                playerCountMode: sent.playerCountMode,
                courseMode: sent.courseMode,
              }),
            );
            if (r.ok) setSnapshot(sent);
            return r;
          }
          if (step === "setTournamentDates") {
            await setTournamentDates(sent.startOn, sent.endOn, sent.datesTentative, sent.dates);
            setSnapshot((prev) => ({ ...prev, startOn: sent.startOn, endOn: sent.endOn, dates: sent.dates, datesTentative: sent.datesTentative }));
            return { ok: true };
          }
          if (step === "tee") {
            const r = await setEventDefaultTee(sentTee);
            if (r.ok) setKeptTee(sentTee);
            return r;
          }
          const r = await saveTournamentSettings({ teePolicy: sentPolicy });
          if (r.ok) setKeptPolicy(sentPolicy);
          return r;
        },
        p.locked,
      );
      if (said) setError(said);
    });
  };

  // The locked text reads what is STORED (`p.initial`), never what was typed and refused.
  const storedArrange = p.initial.courseMode === "open";
  const whereText = storedArrange
    ? "The players arrange their own"
    : p.where === "several"
      ? p.courses.filter((c) => p.venueIds.includes(c.id)).map((c) => c.name).join(", ") || p.initial.course || "—"
      : p.initial.course || "—";

  return (
    <div data-event-screen style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, maxWidth: 760 }}>
      <LockedOnce locks={p.lock.locks} isAdmin={p.lock.isAdmin} correction={p.lock.correction} open={p.lock.open}>
        {(locked) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div className="card elev-sm" data-section="event-what" style={{ gap: 12 }}>
              <span className="card-kicker">
                What
                <MarkChip mark={p.marks.name} />
              </span>
              {locked ? (
                <>
                  <SetupField label="Tournament name" mark={null} dflt={null} isDefault={false} onChange={null} onUseDefault={null}>
                    {p.initial.name}
                  </SetupField>
                  <SetupField label="What kind is this?" mark={null} dflt={null} isDefault={false} onChange={null} onUseDefault={null}>
                    {playKindsFor(register, p.initial.playKind).find((k) => k.key === p.initial.playKind)?.label ?? p.initial.playKind}
                  </SetupField>
                </>
              ) : (
                <EventWhat name={f.name} playKind={f.playKind} onName={(v) => set("name", v)} onPlayKind={(v) => set("playKind", v)} />
              )}
            </div>

            <div className="card elev-sm" data-section="event-when" style={{ gap: 12 }}>
              <span className="card-kicker">
                When
                <MarkChip mark={p.marks.dates} />
              </span>
              <EventWhen
                playKind={f.playKind}
                label={f.dates}
                startOn={f.startOn}
                endOn={f.endOn}
                tentative={f.datesTentative}
                dirty={false}
                saving={pending}
                onStart={onStart}
                onEnd={onEnd}
                onTentative={(v) => set("datesTentative", v)}
                onSaveDates={null}
              />
              {locked && (
                <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                  The days and the tees can still change after launch. Save keeps them.
                </p>
              )}
            </div>

            <div className="card elev-sm" data-section="event-where" id={p.coursesAnchor ? "courses" : undefined} style={{ gap: 12, scrollMarginTop: 80 }}>
              <span className="card-kicker">
                Where
                <MarkChip mark={p.marks.where} />
              </span>
              {locked ? (
                <>
                  <SetupField label="Where it is played" mark={null} dflt={null} isDefault={false} onChange={null} onUseDefault={null}>
                    {whereText}
                    {!storedArrange && p.initial.city ? <span className="text-muted"> · {p.initial.city}</span> : null}
                  </SetupField>
                  {/* The tees are not in the details lock: they stay a control, shut only by the rounds rule (teesDoor). */}
                  {!storedArrange && p.tees.length > 0 && (
                    <EventTees
                      tees={p.tees}
                      teeId={teeId}
                      teesDoor={p.teesDoor}
                      teePolicy={teePolicy}
                      canEdit={p.canEdit}
                      pending={pending}
                      onTee={setTeeId}
                      onTeePolicy={setTeePolicy}
                    />
                  )}
                </>
              ) : arrange ? (
                <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                  The players arrange their own course, so none is set here. Whoever enters a card names the course they played. Change this
                  under More.
                </p>
              ) : (
                <>
                  <div className="field">
                    <span className="field-caption" id="event-where-count">How many courses?</span>
                    <div className="seg" role="radiogroup" aria-labelledby="event-where-count">
                      <label className="seg-opt">
                        <input type="radio" name="event-where" checked={!several} disabled={p.venueIds.length > 1} onChange={() => setSeveral(false)} />
                        One course
                      </label>
                      <label className="seg-opt">
                        <input type="radio" name="event-where" checked={several} onChange={() => setSeveral(true)} />
                        More than one course
                      </label>
                    </div>
                    {p.venueIds.length > 1 && (
                      <p className="text-muted" data-one-course-shut style={{ fontSize: 13, margin: "4px 0 0" }}>
                        Played on {p.venueIds.length} courses. Untick all but one to play on one course.
                      </p>
                    )}
                  </div>
                  <EventWhere
                    offerOpen={false}
                    courses={p.courses}
                    courseSelect={courseSelect}
                    course={f.course}
                    city={f.city}
                    address={f.address}
                    onSelectCourse={onSelectCourse}
                    onBusyChange={setCourseAdding}
                    onEnterNew={(name) => {
                      setCourseSelect("__other");
                      setF((prev) => ({ ...prev, course: name, courseId: "", courseMode: "fixed" }));
                    }}
                    onCourseName={(v) => set("course", v)}
                    onCity={(v) => set("city", v)}
                    onAddress={(v) => set("address", v)}
                    onPlaceFound={(city, addressIfEmpty) =>
                      setF((prev) => ({ ...prev, city, address: prev.address.trim() ? prev.address : addressIfEmpty }))
                    }
                  />
                  {several && (
                    <EventVenues
                      ownCourseId={snapshot.courseId}
                      courses={p.courses.map((c) => ({ id: c.id, name: c.name, city: c.city }))}
                      venueIds={p.venueIds}
                      disabled={!p.canEdit}
                      addHref={p.addCourseHref}
                    />
                  )}
                  {p.tees.length > 0 && courseDirty && (
                    <p className="text-muted" data-course-first style={{ fontSize: 13, margin: 0 }}>
                      Save the course first, then choose its tees.
                    </p>
                  )}
                  {p.tees.length > 0 ? (
                    <EventTees
                      tees={p.tees}
                      teeId={teeId}
                      teesDoor={p.teesDoor}
                      teePolicy={teePolicy}
                      canEdit={p.canEdit}
                      pending={pending || courseDirty}
                      onTee={setTeeId}
                      onTeePolicy={setTeePolicy}
                    />
                  ) : (
                    <p className="text-muted" data-no-tees style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                      {snapshot.course.trim() || snapshot.courseId
                        ? "No tees are set up for this course. Add the tees with their Course Rating and Slope on the course, or players get strokes off their raw Handicap Index."
                        : "Pick a course and save, and its tees can be chosen here."}
                    </p>
                  )}
                </>
              )}
            </div>

            <SectionFold id="event-more" title="More" state={"Overall result, dates, money"} needsYou={false} openOnPhone={false}>
              <div className="card elev-sm" style={{ gap: 12 }}>
                {locked ? (
                  <SetupField label="Overall result" mark={null} dflt={null} isDefault={false} onChange={null} onUseDefault={null}>
                    {overallResultLabel(p.initial.format, [...p.roundFormats])}
                  </SetupField>
                ) : (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
                      <input type="checkbox" checked={arrange} onChange={(e) => onArrange(e.target.checked)} />
                      No fixed course: the players arrange their own
                    </label>
                    <div className="field">
                      <span className="field-caption" id="event-overall">Overall result</span>
                      {p.roundFormats.length === 0 ? (
                        <p className="muted" style={{ margin: 0 }}>
                          Decided by your first round. Add rounds on Rounds &amp; formats; you can change it here afterwards.
                        </p>
                      ) : (
                        <div className="seg" role="radiogroup" aria-labelledby="event-overall">
                          <label className="seg-opt">
                            <input type="radio" name="event-fmt" checked={f.format === "match"} onChange={() => set("format", "match")} />
                            Match play
                          </label>
                          <label className="seg-opt">
                            <input type="radio" name="event-fmt" checked={f.format === "stroke"} onChange={() => set("format", "stroke")} />
                            Stroke play
                          </label>
                        </div>
                      )}
                    </div>
                  </>
                )}
                <span className="card-kicker">Dates and money</span>
                {p.formatting}
              </div>
            </SectionFold>

            <StickySave
              dirty={dirty}
              note={locked ? "Unsaved days or tees. The rest of the event is locked" : "Unsaved changes to the event"}
            >
              <button type="button" className="btn btn-primary" disabled={pending || !dirty || courseAdding || !p.canEdit} onClick={save}>
                <Icon name="check" /> {courseAdding ? "Adding the course…" : pending ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
              {error && (
                <p className="form-error" role="alert" style={{ margin: 0 }} ref={bringIntoView}>
                  {error}
                </p>
              )}
            </StickySave>
          </div>
        )}
      </LockedOnce>
    </div>
  );
}
