"use client";
import { figureOr, readWhole } from "@/lib/domain/decimal-text";
import { useState, useTransition } from "react";
import { addFormatFor, formatChoicesFor } from "@/lib/domain/round-choices";
import { addStage } from "@/app/actions/tournament";
import { INTERVAL_OPTIONS, roundDates, shortDate } from "@/lib/domain/round-dates";
import { STAGE_TYPE_INFO, stageTypeInfo, addRoundConsequence, isStructuralStage, MAX_ROUNDS_AT_ONCE, type StageTypeKey } from "@/lib/stage-types";
import { Icon } from "@/components/Icon";
import { useFormatting } from "@/components/CurrencyProvider";
import { holesPlayed } from "@/lib/domain/handicap";
import { InfoOrFace } from "@/components/setup/InfoOrFace";

/**
 * THE ROUND BUILDER, "Add a round" (R4, the move): what kind of round, how many, the format, the holes and the first day,
 * lifted from `StagesClient` so the redesigned Rounds screen draws the same builder. It owns its own state; the screen
 * hears of a new round through `onAdded`.
 */
export function AddRoundPanel({ roundCount, onAdded, redesign }: { roundCount: number; onAdded: (stageId: string) => void; redesign: boolean }) {
  const { locale } = useFormatting();

  /**
   * Whether the round builder is open.
   *
   * It is the whole point of this screen while there are no rounds, and the
   * largest thing on it once there are. With four rounds built, an
   * always-open builder — two groups of type cards, five fields and a button —
   * was taller than the list of rounds it sat under, so the screen's answer to
   * "what is this tournament playing" was mostly a form for adding another
   * one.
   *
   * So: open when there is nothing yet, because the only useful act on an
   * empty screen is the one it contains; shut afterwards, behind a control
   * that says what it opens.
   *
   * IT STAYS OPEN AFTER AN ADD. Somebody who has just added a round is the
   * likeliest person in the world to add another, and closing a panel under
   * the hands of the person who deliberately opened it is the app taking
   * something away as a reward for using it.
   */
  const [addOpen, setAddOpen] = useState(roundCount === 0);

  /**
   * WHAT KIND OF ROUND — asked, not assumed.
   *
   * This opened on `STAGE_TYPES[0]`, which is Round Robin, so the Add button
   * read "Add round robin" before anybody had looked at the five cards, and
   * the sentence under it promised "a full set of pairings" for a tournament
   * that might be a club medal. On the commonest path — open the screen, press
   * the obvious button — the app chose the round type and the organizer never
   * knew there had been a choice.
   *
   * A round's type is not a label. It decides what is DRAWN: `stage-types.ts`
   * records a round robin set to stroke play as "a full set of pairings for a
   * round in which nobody plays anybody", which is what a defaulted type
   * produces the moment the format is not the one it assumed.
   *
   * Empty until picked, and Add stays disabled — the same rule the tournament
   * builder and the casual round now follow.
   */
  const [newType, setNewType] = useState<StageTypeKey | "">("");

  // Resets to 1 after each add: "add 10 weeks" is a deliberate act, and
  // leaving the box on 10 would make the next click a nasty surprise.
  const [howMany, setHowMany] = useState(1);

  // Settings that apply to EVERY round in the run. They live here rather than
  // being warned about afterwards, because the alternative to configuring ten
  // rounds up front is configuring ten cards one at a time.
  const [bulkFormat, setBulkFormat] = useState("");

  const [bulkHoles, setBulkHoles] = useState(18);

  const [startDate, setStartDate] = useState("");

  const [interval, setInterval] = useState(7);

  const [addRefused, setAddRefused] = useState("");

  const [pending, startTransition] = useTransition();

  /**
   * A TYPE BRINGS ITS FORMAT WITH IT — the one clubs play it in — and keeps
   * the organizer's own choice where that still fits (2026-10-16).
   *
   * The format used to wait at "Choose…" until picked, because a defaulted
   * format once produced a stroke round labelled Match Play. That default was
   * the EVENT's, not the type's; `naturalFormatFor` is the type's, and the list
   * below offers nothing the type cannot score, so the old failure cannot
   * recur. A choice that no longer fits — Match Play kept from a round robin,
   * then Stroke play round chosen — is replaced rather than carried into the
   * next Add, which is what the walk found.
   */
  // What the select shows and Add sends: asked of the kind each render, never read back from
  // `bulkFormat` alone, so a chosen kind cannot be left with a format that is not among its options.
  const addFormat = addFormatFor(newType, bulkFormat);

  const pickType = (t: StageTypeKey) => {
    setNewType(t);
    setBulkFormat((cur) => addFormatFor(t, cur));
  };
  return (
    <>
{/* Shut, this is one control rather than a card with a form inside it.
          A collapsed panel that still looks like a panel is not a saving —
          the point is that a screen showing four rounds shows four rounds and
          a way to add a fifth, not four rounds and a fifth being built. */}
      {!addOpen && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="card elev-sm"
          aria-expanded={false}
          style={{
            width: "100%",
            textAlign: "left",
            display: "flex",
            // `.card` sets column, so a bare `display: flex` here stacked the
            // plus, the label and the caret into three rows — the control read
            // as a centred heading with a chevron under it rather than as a
            // row you press.
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 44,
            cursor: "pointer",
            color: "var(--color-text)",
            border: "1px dashed var(--color-divider)",
          }}
        >
          <Icon name="plus" style={{ fontSize: 16, color: "var(--color-accent-200)", flex: "none" }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Add a round</span>
            {/* Names what is behind it. "Add a round" alone hides the fact
                that a cut and a bracket live in here too, and a control whose
                contents are a surprise is a control people do not open. */}
            <span className="text-muted" style={{ display: "block", fontSize: 13, marginTop: 2, lineHeight: 1.45 }}>
              Another round the field plays, or a cut or a bracket between them.
            </span>
          </span>
          <Icon name="caret-down" style={{ fontSize: 13, color: "var(--color-neutral-500)", marginLeft: "auto", flex: "none" }} />
        </button>
      )}
{/* Was a bare select of four raw enum strings — "Single Match Stage"
          told an organizer nothing about what it would do, and the medal
          round every club plays wasn't on the list at all. Each option now
          says what the app will actually generate, because that is the whole
          difference between the types. */}
      {addOpen && (
      <div className="card elev-sm" style={{ gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <span className="card-title" style={{ fontSize: 15 }}>Add a round</span>
            <InfoOrFace
              redesign={redesign}
              label="adding a round"
              face={(words) => (
                <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
                  {words}
                </p>
              )}
            >
              Sequence as many as you like. The <em>type</em> decides what gets drawn — pairings, a
              cut, or a bracket. How it&apos;s scored is the <em>format</em> on each round, chosen
              separately, so a Stableford or four-ball round is a round of one of these types.
            </InfoOrFace>
          </div>
          {/* No way to shut it while there is nothing to shut it over: on an
              empty tournament this panel IS the screen, and a close button
              would offer an organizer a blank page. */}
          {roundCount > 0 && (
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              aria-expanded
              aria-label="Close the round builder"
              className="btn btn-ghost"
              style={{ marginLeft: "auto", flex: "none", minHeight: 44, minWidth: 44 }}
            >
              <Icon name="caret-up" />
            </button>
          )}
        </div>

        {/* Two groups rather than five equal cards. Nearly every round an
            organizer adds is one the field plays; a single match and a bracket are
            structure, added once if at all. Showing them as peers made the
            common choice a five-way decision every time. */}
        <span className="card-kicker">Rounds the field plays</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 8 }}>
          {STAGE_TYPE_INFO.filter((t) => !isStructuralStage(t.key)).map((t) => {
            const selected = newType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => pickType(t.key)}
                aria-pressed={selected}
                disabled={pending}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  color: "var(--color-text)",
                  background: selected
                    ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                    : "color-mix(in srgb, var(--color-text) 3%, transparent)",
                  border: `1px solid ${selected ? "var(--color-accent)" : "color-mix(in srgb, var(--color-text) 12%, transparent)"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Icon name={t.icon} style={{ fontSize: 15, color: "var(--color-accent-200)" }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>
                  {t.blurb}
                </div>
              </button>
            );
          })}
        </div>

        <span className="card-kicker" style={{ marginTop: 4 }}>Structure</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 8 }}>
          {STAGE_TYPE_INFO.filter((t) => isStructuralStage(t.key)).map((t) => {
            const selected = newType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => pickType(t.key)}
                aria-pressed={selected}
                disabled={pending}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  color: "var(--color-text)",
                  background: selected
                    ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                    : "color-mix(in srgb, var(--color-text) 3%, transparent)",
                  border: `1px solid ${selected ? "var(--color-accent)" : "color-mix(in srgb, var(--color-text) 12%, transparent)"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Icon name={t.icon} style={{ fontSize: 15, color: "var(--color-accent-200)" }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>
                  {t.blurb}
                </div>
              </button>
            );
          })}
        </div>

        {/* Everything below applies to every round in the run. Set here rather
            than flagged as homework: the alternative to configuring ten rounds
            up front is configuring ten cards one at a time, which is the very
            thing "how many" exists to avoid. */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          {/* Stacked like every other field in this row. It was the one
              inline label among four stacked ones, at 13px among 12s, so with
              the row aligned to `flex-end` its input sat on a different
              baseline to its neighbours — the row read as two rows that had
              not quite met. Same fields, same order, same behaviour. */}
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
            <span className="text-muted">How many?</span>
            <input
              className="input"
              type="number"
              min={1}
              max={MAX_ROUNDS_AT_ONCE}
              value={howMany}
              disabled={pending}
              onChange={(e) => setHowMany(Math.max(1, Math.min(MAX_ROUNDS_AT_ONCE, figureOr(readWhole(e.target.value), 1) || 1)))}
              style={{ width: 72, textAlign: "center" }}
              aria-label="How many rounds to add"
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
            <span className="text-muted">Format</span>
            <select
              className="input"
              value={addFormat}
              disabled={pending}
              onChange={(e) => setBulkFormat(e.target.value)}
              style={{ minWidth: 150 }}
              aria-label="Format for every round added"
            >
              {/* "Default for this event" — preselected, so the commonest path
                  through this screen never chose a format at all. What it
                  resolved to was the event's scoring hint, which on a
                  from-scratch tournament is match: a stroke play round came
                  out labelled Match Play, and score entry opened it in match
                  mode with nothing to enter. Measured on 2026-09-09 by adding
                  one and reading the card.

                  The format is HALF of what a round is — the type decides what
                  is drawn, the format decides how a score becomes a result —
                  so it is asked, like the type above it. */}
              {!newType && <option value="">Choose…</option>}
              {/* What the chosen type can be scored in — `formatChoicesFor`, the
                  list `addStage` also holds to. Before a type is picked, the
                  formats a stroke round can take, which is most of them; the
                  pick then narrows it. */}
              {(["own", "side"] as const).map((g) => {
                const opts = formatChoicesFor(newType || "Stroke Play Round").filter((c) => c.group === g);
                return opts.length === 0 ? null : (
                  <optgroup key={g} label={g === "own" ? "Played on your own" : "Played as a side"}>
                    {opts.map((c) => (
                      <option key={c.name} value={c.name}>{c.label}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
            <span className="text-muted">Holes</span>
            <select
              className="input"
              value={bulkHoles}
              disabled={pending}
              onChange={(e) => setBulkHoles(holesPlayed(parseInt(e.target.value, 10)))}
              style={{ width: 82 }}
              aria-label="Holes for every round added"
            >
              <option value={18}>18</option>
              <option value={9}>9</option>
            </select>
          </label>

          {/* A fixed-day league plays ON a day; it does not "play by" one.
              Leaving this blank keeps the old behaviour of no fixed date. */}
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
            <span className="text-muted">First round played</span>
            <input
              className="input"
              type="date"
              value={startDate}
              disabled={pending}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: 160 }}
              aria-label="Date the first round is played"
            />
          </label>

          {howMany > 1 && startDate && (
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
              <span className="text-muted">Then</span>
              <select
                className="input"
                value={interval}
                disabled={pending}
                onChange={(e) => setInterval(parseInt(e.target.value, 10))}
                style={{ minWidth: 160 }}
                aria-label="How often the rounds repeat"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.days} value={o.days}>{o.label}</option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !newType || !addFormat}
            onClick={() =>
              newType &&
              addFormat &&
              startTransition(async () => {
                setAddRefused("");
                const res = await addStage(newType, {
                  count: howMany,
                  format: addFormat,
                  holes: bulkHoles,
                  startDate: startDate || undefined,
                  intervalDays: interval,
                });
                // The Par plan's seven-day window, said beside the button.
                if (res?.error) {
                  setAddRefused(res.error);
                  return;
                }
                setHowMany(1);
                setStartDate("");
                if (res?.id) {
                  onAdded(res.id);
                }
              })
            }
          >
            <Icon name="plus" />{" "}
            {/* Names the round it will add, and says so is unanswered until
                one is picked. "Add round robin" on an unanswered screen was
                the default announcing itself as a decision. */}
            {!newType
              ? "Add round"
              : howMany === 1
                ? `Add ${stageTypeInfo(newType).label.toLowerCase()}`
                : `Add ${howMany} ${stageTypeInfo(newType).label.toLowerCase()}s`}
          </button>
        </div>
        {addRefused && (
          <p role="alert" style={{ fontSize: 13, margin: "6px 0 0", color: "var(--color-danger)" }}>
            {addRefused} <a href="/organization#plan">See plans</a>
          </p>
        )}

        {/* The consequence, stated before the click rather than discovered
            after it. Pairings are the thing an organizer is most often
            surprised by, in both directions.

            OUT of the field row and under it. As a flex sibling of the button
            this sentence competed with the fields for the same line: on a wide
            screen it sat to the right of the button reading like a caption
            belonging to nothing, and as the row filled it wrapped to wherever
            there happened to be space. It describes what the button will do,
            so it belongs beneath the row it describes — the same place every
            other explanation on this screen sits. */}
        <p className="text-muted" style={{ fontSize: 13, margin: "10px 0 0", maxWidth: "62ch", lineHeight: 1.5 }}>
          {/* Nothing is promised about a round nobody has chosen. This read
              "Draws a full set of pairings" on an untouched screen, which
              described the defaulted Round Robin rather than anything the
              organizer had asked for. */}
          {!newType
            ? "Pick one above — the type decides what gets drawn."
            : !addFormat
              ? `${addRoundConsequence(newType)} Now choose the format it is scored by.`
              : addRoundConsequence(newType)}
        </p>

        {/* Said before the click, not discovered after it. Deliberately NOT a
            blocked button: "have you looked at everything" cannot be defined
            honestly, and the defaults above are real choices, so refusing to
            proceed would only teach people to click through a gate. What it
            does instead is name exactly what is shared and what is not. */}
        {howMany > 1 && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              All {howMany} rounds will be created the same
            </span>
            <p style={{ margin: "5px 0 0", fontSize: 13, lineHeight: 1.6 }}>
              They share the format, holes{startDate ? " and dates" : ""} set above. Everything
              else — the handicap allowance, the cut line, carry-forward, round codes — is set on
              each round, so changing one of those afterwards means editing {howMany} cards.
              {" "}Worth setting the format here rather than there.
            </p>
            {startDate && (
              <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55 }}>
                {interval === 0
                  ? `All ${howMany} on ${shortDate(startDate, locale)}.`
                  : `${shortDate(startDate, locale)}, then ${INTERVAL_OPTIONS.find((o) => o.days === interval)?.label.toLowerCase()} — last round ${shortDate(roundDates(startDate, howMany, interval)[howMany - 1], locale)}.`}
                {" "}Any one of them can be moved later if it rains off.
              </p>
            )}
          </div>
        )}
      </div>
      )}
    </>
  );
}
