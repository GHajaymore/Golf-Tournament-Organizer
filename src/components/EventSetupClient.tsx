"use client";
import { useId, useState, useTransition } from "react";
import { overCapacity } from "@/lib/registration";
import { saveEvent, applyManualCount, setTournamentDates } from "@/app/actions/tournament";
import { PLAY_KINDS, playNoun, resultHeading } from "@/lib/domain/play-kind";
import { parseDeadlineIso, formatDeadline } from "@/lib/deadline";
import { formatDayRange, DEFAULT_LOCALE } from "@/lib/domain/locale";
import { CoursePicker } from "@/components/CoursePicker";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";
import { StickySave } from "./StickySave";
import { TournamentJourney } from "./TournamentJourney";

interface EventForm {
  name: string;
  /** Outing, charity day, league… — copy only. See domain/play-kind.ts. */
  playKind: string;
  /** The first and last day played, `yyyy-mm-dd`. The stored truth. */
  startOn: string;
  endOn: string;
  /** Those dates as a sentence, derived from them — never typed. */
  dates: string;
  /** Whether the club has fixed those dates, or is still proposing them. */
  datesTentative: boolean;
  format: string;
  course: string;
  /** The club course this points at, or "" — see the note on Event.courseId. */
  courseId: string;
  courseMode: string;
  city: string;
  address: string;
  regDeadline: string;
  /** First day entries are taken (ISO), or "". */
  regOpens: string;
  capacity: number;
  playerCountMode: string;
  manualPlayerCount: number;
}

interface CourseOption {
  id: string;
  name: string;
  city: string;
  address: string;
}

/**
 * THE DATES THIS SCREEN WRITES, IN THE CLUB'S OWN CONVENTIONS.
 *
 * These were four hardcoded `"en-US"` calls and a hand-assembled range, so a
 * club in Surrey typing 14 and 16 May got "May 14–16, 2026" written into
 * `Event.dates` — and because that column is free text, the American shape was
 * then the stored data rather than a rendering of it, on every screen and on
 * the public board.
 *
 * The hand-built range is gone with them. `Intl.formatRange` is the only thing
 * that knows where each locale puts the dash and which parts it will drop:
 * English collapses the repeated month, German does not, Japanese leads with
 * the year. A range assembled by hand is correct in the language it was
 * written in and nowhere else, which is precisely how this one was American
 * without anybody deciding it should be.
 */

export function EventSetupClient({
  initial,
  playersCount,
  courses,
  isMatch = false,
  hasBracket = true,
  setup = null,
  status = "draft",
  scored = false,
  locale = DEFAULT_LOCALE,
}: {
  initial: EventForm;
  playersCount: number;
  courses: CourseOption[];
  /**
   * How this club writes a date, resolved by the page from the club and this
   * tournament's own override. See domain/locale.ts.
   *
   * Defaults to US English rather than to the browser's, because the dates
   * this screen writes go into `Event.dates` — a free-text column read by
   * every other screen and by the public board. A default that varied by
   * whoever was typing would make the stored value depend on the laptop.
   */
  locale?: string;
  /**
   * Two people playing each other, rather than a tournament.
   *
   * Only the "Recommended flow" card reads it, and only to not render: that
   * card is a route through setting a TOURNAMENT up, ending in "Launch →
   * setup locks". A match is created live and never locks — the event action
   * says so in as many words — so every line of it is about somebody else's
   * problem, on the screen a casual round is most likely to be opened from.
   */
  isMatch?: boolean;
  /**
   * Whether this tournament has a knockout in it at all.
   *
   * Only the "Recommended flow" card reads it, and only to drop one line —
   * see that line for the two screens this same rule had to be taught before.
   *
   * Defaults to true, the way `ReportsClient.hasBracket` does and for the same
   * reason: a caller that has not been taught offers exactly what it offered
   * before, so this cannot quietly remove the step from a real knockout.
   */
  hasBracket?: boolean;
  /** Progress through setting up, for the journey card. Null for a match. */
  setup?: {
    doneCount: number;
    total: number;
    complete: boolean;
    doneHrefs: readonly string[];
    /** The step to do next — see the note on `TournamentJourney`'s own prop. */
    currentHref?: string;
  } | null;
  /**
   * The tournament's status, passed through to the journey card.
   *
   * This was `launched` and `finished`, two booleans this component never
   * read — it forwarded both and nothing else. Passing the status instead
   * means the rule about what launched MEANS lives with the list that defines
   * it rather than in the page above.
   *
   * Defaults to "draft", the quietest answer: a caller that forgets it gets a
   * journey card at the start of the journey, which understates. The value it
   * replaced derived "finished" from a card count and OVERSTATED — it told an
   * organizer to settle the money mid-round.
   */
  status?: string;
  scored?: boolean;
}) {
  const [f, setF] = useState<EventForm>(initial);
  // Captions below are real <label>s for their controls (a screen reader said
  // an unnamed "edit text" for the name, dates, course and deadline).
  const fid = useId();
  const [manualTarget, setManualTarget] = useState(initial.manualPlayerCount);
  /** Scored matches a resize would destroy, once the action refuses. */
  const [resizeScored, setResizeScored] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  // The button reflects real dirty state against the last-saved snapshot,
  // not a timed flash — it only reads "Save event" when something has
  // actually changed since the last save (or since load).
  const [savedSnapshot, setSavedSnapshot] = useState<EventForm>(initial);
  const isDirty = JSON.stringify(f) !== JSON.stringify(savedSnapshot);

  // Course selector: a preset name, "__other" (manual entry), "__open" (no
  // fixed course), or "" (none yet). The open mode is checked first because
  // it is the one case with no course name to recognise — reading the name
  // alone would show it as "no course selected yet" and quietly lose it.
  /**
   * Which row the picker starts on — an id now, not a name.
   *
   * Open mode is read first because it is the one case with no course to
   * recognise; reading the name alone showed it as "nothing selected yet"
   * and quietly lost it. Then the stored id. A tournament saved before this
   * column existed has no id, so its NAME is matched once to find the row —
   * that is the migration path for anything the backfill could not resolve,
   * and it costs nothing to keep.
   */
  const byName = new Map(courses.map((c) => [c.name, c.id]));
  const initialSelect =
    initial.courseMode === "open"
      ? "__open"
      : initial.courseId
        ? initial.courseId
        : initial.course === ""
          ? ""
          : (byName.get(initial.course) ?? "__other");
  const [courseSelect, setCourseSelect] = useState(initialSelect);
  /**
   * The dates save on their own — see the button below the field for why.
   * Tracked separately so "unsaved dates" is not confused with "unsaved
   * everything else", which is what the sticky bar is about.
   */
  const [savedDates, setSavedDates] = useState({
    startOn: initial.startOn,
    endOn: initial.endOn,
    datesTentative: initial.datesTentative,
  });
  const [datesPending, startDatesTransition] = useTransition();
  const datesDirty =
    f.startOn !== savedDates.startOn ||
    f.endOn !== savedDates.endOn ||
    f.datesTentative !== savedDates.datesTentative;
  const [zip, setZip] = useState("");
  const [zipMsg, setZipMsg] = useState("Enter a US zip to fill in the city/state.");

  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => setF((prev) => ({ ...prev, [k]: v }));

  /**
   * THE DATES, AS DATES (2026-09-19). The picker used to write only a display
   * string into `f.dates` and keep the ISO values in local state that was
   * thrown away on reload — so the app held a sentence and nothing that could
   * be sorted, grouped or compared. `startOn`/`endOn` are now the stored
   * truth and this is filled from them; `f.dates` is derived for screens.
   *
   * A row saved before those columns existed opens with empty pickers and its
   * old sentence still showing, because "Spring meeting, first week" cannot be
   * reverse-parsed and is the only record of when that tournament was played.
   */
  const [startDate, setStartDate] = useState(initial.startOn);
  const [endDate, setEndDate] = useState(initial.endOn);
  // The deadline is the exception: it is stored as the ISO date it is, so the
  // picker can be filled from it and — the reason any of this matters —
  // deadlinePassed can read it. Legacy free text parses to "" and leaves the
  // picker empty, exactly as before.
  const [deadlineDate, setDeadlineDate] = useState(() => parseDeadlineIso(initial.regDeadline));

  const onStartDate = (v: string) => {
    setStartDate(v);
    const end = endDate || v;
    if (!endDate) setEndDate(v);
    setF((prev) => ({ ...prev, startOn: v, endOn: end, dates: v ? formatDayRange(v, end, locale) : prev.dates }));
  };
  const onEndDate = (v: string) => {
    setEndDate(v);
    const start = startDate || v;
    if (!startDate) setStartDate(v);
    setF((prev) => ({ ...prev, startOn: start, endOn: v, dates: v ? formatDayRange(start, v, locale) : prev.dates }));
  };
  const onDeadlineDate = (v: string) => {
    setDeadlineDate(v);
    // Stored as ISO, NOT as the display string. Running the picker's value
    // through fmtDate here is the whole of D1: `deadlinePassed` requires ISO
    // and returns false for anything else, so every deadline set on this
    // screen was decorative — the public form stayed open indefinitely while
    // printing the date it was ignoring. The screen formats for display below;
    // the column keeps the date.
    if (v) set("regDeadline", v);
  };

  /**
   * One choice writes both fields.
   *
   * The id is what was picked; the name is that course's name kept beside
   * it, because `resolveCourse` and a dozen screens still resolve a card by
   * name. Set together and never separately, so they cannot come to
   * disagree — the failure that makes two sources of truth worse than one.
   */
  const onSelectCourse = (val: string) => {
    setCourseSelect(val);
    if (val === "") {
      setF((prev) => ({ ...prev, course: "", city: "", address: "", courseId: "", courseMode: "fixed" }));
    } else if (val === "__open") {
      // Deliberately clears the venue: an open tournament has no course
      // until a card is entered, and a stale name here would score every
      // match against a venue nobody played.
      setF((prev) => ({ ...prev, course: "", city: "", address: "", courseId: "", courseMode: "open" }));
    } else if (val === "__other") {
      // Typed in by hand, so there is no club course to point at.
      setF((prev) => ({ ...prev, course: "", courseId: "", courseMode: "fixed" }));
    } else {
      const c = courses.find((x) => x.id === val);
      if (c) {
        setF((prev) => ({
          ...prev,
          course: c.name,
          city: c.city,
          address: c.address,
          courseId: c.id,
          courseMode: "fixed",
        }));
      }
    }
  };

  const lookupZip = async () => {
    const z = zip.trim();
    if (!/^\d{5}$/.test(z)) {
      if (z) setZipMsg("Enter a 5-digit US zip code.");
      return;
    }
    setZipMsg("Looking up…");
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${z}`);
      if (!res.ok) {
        setZipMsg("Zip not found — enter the city/address manually.");
        return;
      }
      const data = (await res.json()) as {
        places?: Array<{ "place name": string; "state abbreviation": string }>;
      };
      const place = data.places?.[0];
      if (place) {
        const city = place["place name"];
        const state = place["state abbreviation"];
        setF((prev) => ({
          ...prev,
          city,
          address: prev.address.trim() ? prev.address : `${city}, ${state} ${z}`,
        }));
        setZipMsg(`Found ${city}, ${state}. Add the street address if needed.`);
      }
    } catch {
      setZipMsg("Lookup unavailable — enter the city/address manually.");
    }
  };

  const [locating, setLocating] = useState(false);
  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setZipMsg("Location isn't available in this browser — enter a zip instead.");
      return;
    }
    setLocating(true);
    setZipMsg("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
          );
          const data = (await res.json()) as { city?: string; locality?: string; principalSubdivisionCode?: string; postcode?: string };
          const city = data.city || data.locality || "";
          const state = (data.principalSubdivisionCode || "").split("-").pop() || "";
          if (city) {
            setF((prev) => ({
              ...prev,
              city,
              address: prev.address.trim() ? prev.address : `${city}, ${state}`.trim(),
            }));
            setZipMsg(`Found ${city}${state ? `, ${state}` : ""}. Add the street address if needed.`);
            if (data.postcode) setZip(data.postcode);
          } else {
            setZipMsg("Couldn't determine your city — enter it manually.");
          }
        } catch {
          setZipMsg("Location lookup failed — enter the city/address manually.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setZipMsg("Location access denied — enter a zip instead.");
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  /**
   * MORE PEOPLE CONFIRMED THAN THE FIELD HOLDS, said on the screen that sets
   * the number.
   *
   * The summary printed "Capacity 32 players" and "Confirmed 33" one line
   * apart and drew no conclusion, so the fact sat in plain sight as two
   * unrelated numbers. `RegistrationClient` has said it out loud for a while —
   * "33 of 32 capacity · 1 over" — under a comment about the organizer
   * drawing a tee sheet for thirty-two and thirty-three people arriving.
   *
   * And that screen's own remedy is a link reading "change on Tournament
   * details", which sent somebody here: to the one screen holding both numbers
   * and the field that fixes it, and the only one that did not mention the
   * problem.
   *
   * Through `overCapacity` rather than `playersCount > f.capacity`, because a
   * cap of zero means UNLIMITED and a second copy of that rule is how one of
   * them ends up reporting a 40-player open event as eight over.
   */
  const over = overCapacity(f.capacity, playersCount);
  const summary = [
    /**
     * "Overall result", not "Format" — the name the control on this same
     * screen now uses.
     *
     * This row read "Format", which is the word that was taken OFF that
     * control precisely because every round also has one. So the card asked
     * the question under one name and then summarised the answer under the
     * old one, a few inches apart.
     */
    { k: "Overall result", v: f.format === "stroke" ? "Stroke play" : "Match play" },
    { k: "Course", v: f.courseMode === "open" ? "Players choose" : f.course || "—" },
    { k: "Capacity", v: f.capacity > 0 ? `${f.capacity} players` : "Open / unlimited" },
    {
      k: "Confirmed",
      v: `${playersCount}`,
      // Named on the row that carries the number it contradicts, not as a
      // banner somewhere else on the screen.
      note: over > 0 ? `${over} over the field` : "",
    },
    { k: "Player count", v: f.playerCountMode === "manual" ? "Manual target" : "From registrations" },
  ];

  return (
    <div className="page-split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <div className="card elev-sm" style={{ gap: 12 }}>
        <span className="card-kicker">Tournament identity</span>
        <div className="field">
          <label htmlFor={`${fid}-name`}>
            Tournament name{" "}
            {!f.name.trim() && <span style={{ color: "var(--color-accent-300)" }}>· required to launch</span>}
          </label>
          <input
            id={`${fid}-name`}
            className="input"
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Name your tournament"
            style={!f.name.trim() ? { borderColor: "var(--color-accent)" } : undefined}
          />
        </div>
        {/* WHAT THIS ONE IS CALLED. A club runs a championship in June, a
            charity scramble in July and a roll-up on Tuesdays — one word for
            all three is wrong however carefully it is chosen, so the
            tournament says which it is and the screens use that word.
            Copy only: nothing scores differently. */}
        <div className="field">
          <label htmlFor="play-kind">What kind is this?</label>
          <select
            id="play-kind"
            className="input"
            value={f.playKind}
            onChange={(e) => set("playKind", e.target.value)}
            style={{ minHeight: 46 }}
          >
            {PLAY_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          <p className="text-muted" style={{ fontSize: 12.5, margin: "6px 0 0", lineHeight: 1.5 }}>
            Members see this word: &ldquo;this {playNoun(f.playKind)}&rdquo;, and the results card
            reads &ldquo;{resultHeading(f.playKind)}&rdquo;. It changes nothing about how the golf is
            scored.
          </p>
        </div>
        <div className="pair-grid">
          <div className="field">
            <label htmlFor={`${fid}-start`}>
              Tournament dates{" "}
              {!f.dates.trim() && <span style={{ color: "var(--color-accent-300)" }}>· required to launch</span>}
            </label>
            {/* `minWidth: 0` on the inputs, not just `flex: 1`.
                A native date input's intrinsic minimum is its own chrome — the
                spinners and separators the browser draws — and a flex item
                will not shrink below that unless it is told it may. Two of
                them plus a dash could not fit a 320px screen, so the row ran
                off the edge even after the field above it learned to stack. */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input id={`${fid}-start`} aria-label="Tournament dates, first day" className="input" type="date" value={startDate} onChange={(e) => onStartDate(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <span className="text-muted">–</span>
              <input aria-label="Tournament dates, last day" className="input" type="date" value={endDate} min={startDate || undefined} onChange={(e) => onEndDate(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            </div>
            {f.dates && <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{f.dates}</p>}
            {/* TENTATIVE IS A REAL ANSWER (2026-09-19). A club fixes its
                calendar months before it fixes a tee time, and the app had one
                word for both — so a member booking a holiday around a date the
                committee had not agreed had no way to know. Launching now
                requires dates; this is how a club gives them honestly before
                they are settled. */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, minHeight: 44 }}>
              <input
                type="checkbox"
                checked={f.datesTentative}
                onChange={(e) => set("datesTentative", e.target.checked)}
              />
              These dates are tentative
            </label>
            {/* ITS OWN SAVE, because the dates outlive the setup lock.
                A tentative date becomes a fixed one weeks later, by which time
                the tournament is live and `saveEvent` refuses every field on
                this screen. Confirming a date would then have meant unlocking
                a tournament that is being played, which is how a flag nobody
                can clear gets shipped. `setTournamentDates` is not behind the
                lock, for the reason written beside it. */}
            {datesDirty && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={datesPending}
                  onClick={() =>
                    startDatesTransition(async () => {
                      await setTournamentDates(f.startOn, f.endOn, f.datesTentative, f.dates);
                      setSavedDates({ startOn: f.startOn, endOn: f.endOn, datesTentative: f.datesTentative });
                      setSavedSnapshot((prev) => ({
                        ...prev,
                        startOn: f.startOn,
                        endOn: f.endOn,
                        dates: f.dates,
                        datesTentative: f.datesTentative,
                      }));
                    })
                  }
                >
                  <Icon name="check" /> {datesPending ? "Saving…" : "Save dates"}
                </button>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  Dates save on their own, so they can be changed after launch.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Neither of the two questions below is IDENTITY, and both used to sit
            under that heading — "Scoring" beside the dates, and "How do people
            play?" straight after it. A name and a date say which tournament
            this is; match-versus-stroke and singles-versus-sides say what kind
            of golf it is. Somebody looking for either would not look under
            "Tournament identity", and the file already carries the scar of that
            confusion: the comment below records "Scoring" being renamed from
            "Format" for the same reason. */}
        {/* "THE KIND OF GOLF" is what this heading used to say, and it was the
            other half of the confusion Ajay reported: it names what the ROUNDS
            decide. The label under it said "Scoring", which is no better — a
            round has a scoring basis too.

            This is the third rename of the same control and the first that
            says what it DOES rather than what it is about. It went Format →
            Scoring because every round also has a format; it is now "How the
            overall result is decided", because every round also has scoring
            and the thing that is genuinely event-level is the TABLE ACROSS
            them: `standingsIncludeThisWeek` reads it to decide whether a
            league's season table is a stroke aggregate or a match-points
            chain, and no single round can answer that.

            A match league with one medal night is still a match league. That
            sentence is the whole justification for this control existing, so
            it is on the screen rather than only in this comment. */}
        <span className="card-kicker" style={{ marginTop: 8, borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>How the tournament is decided</span>
        <div>
          <div className="field">
            <label>
              Overall result
              <FieldInfo label="overall result">
                <p>
                  How the <b>standings across every round</b> are counted: <b>match play</b> totals
                  {" "}match points, <b>stroke play</b> totals strokes.
                </p>
                <p>
                  This is the only scoring question the tournament answers. What each round{" "}
                  <i>plays</i> — four-ball, foursomes, a scramble, Stableford — is set per round on
                  Rounds &amp; formats, and can differ from one round to the next.
                </p>
                <p>
                  A match-play league that runs one medal night is still a match-play league: the
                  medal night simply earns no match points. Set this to what decides the{" "}
                  <i>season</i>, not to what happens to be played next.
                </p>
              </FieldInfo>
            </label>
            <div className="seg">
              <label className="seg-opt"><input type="radio" name="fmt" checked={f.format === "match"} onChange={() => set("format", "match")} />Match play</label>
              <label className="seg-opt"><input type="radio" name="fmt" checked={f.format === "stroke"} onChange={() => set("format", "stroke")} />Stroke play</label>
            </div>
          </div>
        </div>

        {/* "How do people play?" — individually, in pairs, in teams — USED TO
            STAND HERE, and it is gone rather than moved.

            It was the second of the two questions that made this screen read
            as though it decided how the golf is played, which is the confusion
            this change is about: an organizer answered it, reasonably believed
            they had said what the tournament plays, and never went to Rounds &
            formats, where it actually lives.

            Its own help text conceded the point — "a starting point, not a
            rule", and "team golf lives on the round, not the tournament,
            because it genuinely changes: a member-guest plays four-ball on
            Saturday and foursomes on Sunday". A setting that describes itself
            that way is a default wearing a decision, and the two things it fed
            are both better read from the rounds:

              a new round's format     now repeats the PREVIOUS round's, which
                                       is what a club does. Both add-a-round
                                       screens require a format anyway, so this
                                       was already only a backstop.
              Teams & pairs in the nav now appears when a round HAS a team
                                       format — the fact it was standing in for.

            `Event.sideStyle` is left in the schema and no longer written.
            Dropping a column is a migration; this change is about what the
            screen asks. */}
        <span className="card-kicker" style={{ marginTop: 8, borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>Venue</span>
        <div className="field">
          <CoursePicker
            label="Golf course"
            /**
             * Keyed by NAME here, and only here.
             *
             * The Event stores its venue as a course name plus its own
             * hole-by-hole card, which predates the Course library and is what
             * `resolveCourse` matches on. Every other screen picks by id. That
             * split is a data-model question, not a control question, and
             * quietly changing what this writes would have re-pointed the venue
             * of every existing tournament. So the CONTROL is now the same one
             * used everywhere — it narrows, it shows the town — while what it
             * saves is untouched.
             */
            options={courses.map((c) => ({ id: c.id, name: c.name, city: c.city }))}
            value={courseSelect}
            onChange={onSelectCourse}
            noneLabel="— Select a course —"
            searchDirectory
            // A society playing somewhere new every month should not have to
            // go and add the course somewhere else first, then come back.
            onEnterNew={(name) => {
              setCourseSelect("__other");
              setF((prev) => ({ ...prev, course: name, courseId: "", courseMode: "fixed" }));
            }}
            extras={[
              { id: "__other", label: "Other (enter manually)" },
              { id: "__open", label: "No fixed course — players choose" },
            ]}
          />
          {courseSelect === "__open" && (
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.5 }}>
              For a league or society where each pairing arranges its own venue.
              Nothing is set here; whoever enters a card names the course they
              played, and it is saved to the club&rsquo;s list for next time.
            </p>
          )}
        </div>

        {courseSelect === "__other" && (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div className="field">
              <label htmlFor={`${fid}-course`}>Course name</label>
              <input id={`${fid}-course`} className="input" value={f.course} onChange={(e) => set("course", e.target.value)} placeholder="e.g. Maketewah Country Club" />
            </div>
            <div className="field">
              <label htmlFor={`${fid}-zip`}>Zip code</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  id={`${fid}-zip`}
                  className="input"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  onBlur={lookupZip}
                  placeholder="45202"
                  inputMode="numeric"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-icon"
                  disabled={locating}
                  onClick={useMyLocation}
                  title="Use my current location"
                >
                  <Icon name={locating ? "ph ph-spinner-gap" : "ph ph-navigation-arrow"} />
                </button>
              </div>
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: "-6px 0 0", gridColumn: "1 / -1" }}>{zipMsg}</p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <div className="field"><label htmlFor={`${fid}-city`}>City</label><input id={`${fid}-city`} className="input" value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="City" /></div>
          <div className="field"><label htmlFor={`${fid}-address`}>Address</label><input id={`${fid}-address`} className="input" value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, city, state zip" /></div>
        </div>

        {/* Was one heading, "Registration &amp; field", over three unrelated
            things — and it collided by name with the SCREEN called Registration
            & field at /registration, which the "Recommended flow" card on this
            very page then told organizers to go to. Two different things
            wearing one name is how somebody ends up on the wrong one.

            What actually sat under it: the deadline and the capacity, which
            together decide whether the public form takes an entry
            (`registrationState` reads exactly those two) — and then a control
            called "Player count" whose Apply button waitlists confirmed
            players, invents placeholder rows named "Player N", DELETES SCORED
            MATCHES and rebuilds the schedule. That is not a registration
            setting; it is a tool that rewrites the field. Filed under its own
            heading below. */}
        <span className="card-kicker" style={{ marginTop: 8, borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>Registration</span>
        <div className="pair-grid">
          {/* Members see both dates on their list of the club's tournaments,
              and entries are refused before this one — see
              `registrationStatus`. Empty means "as soon as self sign-up is on",
              which is how every tournament behaved before it existed. */}
          <div className="field">
            <label htmlFor="reg-opens">Entries open</label>
            <input
              id="reg-opens"
              className="input"
              type="date"
              value={parseDeadlineIso(f.regOpens)}
              max={parseDeadlineIso(f.regDeadline) || undefined}
              onChange={(e) => set("regOpens", e.target.value)}
            />
            <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
              {f.regOpens ? formatDeadline(f.regOpens, locale) : "Leave empty to open as soon as sign-up is on"}
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${fid}-deadline`}>Registration deadline</label>
            <input id={`${fid}-deadline`} className="input" type="date" value={deadlineDate} max={startDate || undefined} onChange={(e) => onDeadlineDate(e.target.value)} />
            {f.regDeadline && (
              <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                {formatDeadline(f.regDeadline, locale)}
              </p>
            )}
          </div>
          <div className="field">
            <label>Field capacity</label>
            <div style={{ display: "flex", gap: 8 }}>
              <div className="seg">
                <label className="seg-opt"><input type="radio" name="capmode" checked={f.capacity > 0} onChange={() => set("capacity", f.capacity > 0 ? f.capacity : 32)} />Fixed</label>
                <label className="seg-opt"><input type="radio" name="capmode" checked={f.capacity <= 0} onChange={() => set("capacity", 0)} />Open</label>
              </div>
              {f.capacity > 0 && (
                <input aria-label="Field capacity (players)" className="input" type="number" value={f.capacity} onChange={(e) => set("capacity", parseInt(e.target.value, 10) || 0)} style={{ width: 90 }} />
              )}
            </div>
          </div>
        </div>
        <span className="card-kicker" style={{ marginTop: 8, borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>Where the field size comes from</span>
        <div className="field">
          <label>Player count</label>
          <div className="seg">
            <label className="seg-opt"><input type="radio" name="pcmode" checked={f.playerCountMode === "registration"} onChange={() => set("playerCountMode", "registration")} />From registrations</label>
            <label className="seg-opt"><input type="radio" name="pcmode" checked={f.playerCountMode === "manual"} onChange={() => set("playerCountMode", "manual")} />Manual</label>
          </div>
        </div>
        {f.playerCountMode === "manual" ? (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor={`${fid}-target`}>Target player count</label>
                <input id={`${fid}-target`} className="input" type="number" value={manualTarget} onChange={(e) => setManualTarget(parseInt(e.target.value, 10) || 0)} />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await applyManualCount(manualTarget);
                    if (res.needsConfirm) setResizeScored(res.scoredMatches ?? 0);
                  })
                }
              >
                Apply
              </button>
            </div>
            {resizeScored !== null && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-danger)",
                  background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 13 }}>
                  <b>
                    <Icon name="warning" /> This will delete {resizeScored} scored match
                    {resizeScored === 1 ? "" : "es"}.
                  </b>
                  <div className="text-muted" style={{ marginTop: 4 }}>
                    Resizing the field rebuilds the round-robin schedule, discarding results already entered.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await applyManualCount(manualTarget, true);
                        setResizeScored(null);
                      })
                    }
                  >
                    Delete and resize
                  </button>
                  <button type="button" className="btn" disabled={pending} onClick={() => setResizeScored(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <p className="text-muted" style={{ fontSize: 12, margin: "-6px 0 0" }}>
              Pads with waitlist/placeholder entries or trims the roster to this exact count, then regroups.
            </p>
          </>
        ) : (
          <p className="text-muted" style={{ fontSize: 12, margin: "-6px 0 0" }}>
            Player count tracks confirmed registrations live — currently {playersCount}.
          </p>
        )}
        {/* The same treatment as the settings form below, from the same
            component. This card is 1,898px with 1,125px between the
            tournament's name — the first field — and the only button that
            keeps it. Fixing one of the two Saves on a screen that has two
            would have been a worse inconsistency than the distance. */}
        <StickySave dirty={isDirty} note="Unsaved changes to the tournament">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !isDirty}
            onClick={() => {
              startTransition(() =>
                saveEvent({
                  name: f.name, playKind: f.playKind, dates: f.dates, datesTentative: f.datesTentative,
                  format: f.format, course: f.course, courseId: f.courseId, city: f.city,
                  address: f.address, regDeadline: f.regDeadline, regOpens: f.regOpens, capacity: f.capacity, playerCountMode: f.playerCountMode,
                  courseMode: f.courseMode,
                }),
              );
              setSavedSnapshot(f);
            }}
          >
            <Icon name="check" /> {isDirty ? "Save event" : "Saved"}
          </button>
        </StickySave>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card elev-sm">
          <span className="card-kicker">Summary</span>
          {summary.map((s) => (
            <div key={s.k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--color-divider)" }}>
              <span className="text-muted">{s.k}</span>
              <span style={{ fontWeight: 500 }}>
                {s.v}
                {s.note && (
                  <span style={{ color: "var(--color-danger)", fontWeight: 500 }}> · {s.note}</span>
                )}
              </span>
            </div>
          ))}
        </div>
        {!isMatch && (
        <TournamentJourney
          setup={setup}
          status={status}
          scored={scored}
          hasBracket={hasBracket}
        />
        )}
      </div>
    </div>
  );
}
