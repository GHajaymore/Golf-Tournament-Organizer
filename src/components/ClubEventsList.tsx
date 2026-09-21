"use client";

import React, { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { EnterButton } from "@/components/EnterButton";
import type { ClubEventRow } from "@/lib/services/club-events";
import { byBand, type EventBand } from "@/lib/domain/club-event-card";
import {
  bySeason,
  currentSeason,
  seasonWindow,
  type SeasonGroup,
  type SeasonWindow,
} from "@/lib/domain/club-season";
import { todayIso } from "@/lib/deadline";
import { playLabel } from "@/lib/domain/play-kind";

/**
 * EVERY TOURNAMENT A MEMBER'S CLUB RUNS — found, understood and entered from
 * one screen.
 *
 * The filters answer the questions a member actually arrives with: what can I
 * enter, what am I in, what's on now, what happened. Status is the headline of
 * each card (the band), the entry window is the second line of it, and the
 * two actions are the only buttons — enter, or look.
 *
 * NO FROM/TO DATE FILTER, on purpose. A tournament's play dates are free text
 * ("Sat 3 Oct", "May 2026"), so a date range would silently drop the ones it
 * could not read — a filter that hides tournaments without saying so. "When"
 * is worked out from each tournament's own status instead, which is always
 * known.
 *
 * Filtering is local: the whole list is already on the page, a club has tens
 * of tournaments rather than thousands, and a phone on a clubhouse car park
 * should not wait on a round trip to narrow a list it is holding.
 */

/** How many tournaments a club lists before a search and a filter earn their space. */
export const FILTER_FROM = 5;

type StatusFilter ="all" | "open" | "entered" | "soon" | "now" | "finished";

/**
 * The band's look. Background and text are each the token built for the job:
 * a tint of the colour behind the text step of the same colour, or the filled
 * accent with the label colour solved to read on it.
 */
const BAND_STYLE: Record<EventBand, { background: string; color: string }> = {
  entered: { background: "var(--color-accent)", color: "var(--color-on-accent)" },
  /**
   * The member's own standing, like `entered`, but not yet a place — so it is
   * drawn as a tint of the accent rather than the filled accent. Loud enough to
   * read as "this one is about you", quieter than a confirmed entry, and
   * nothing like the grey `closed` it used to be shown as.
   */
  waiting: {
    background: "color-mix(in srgb, var(--color-accent) 22%, transparent)",
    color: "var(--color-accent-300)",
  },
  open: { background: "color-mix(in srgb, var(--color-accent) 14%, transparent)", color: "var(--color-accent-300)" },
  soon: { background: "color-mix(in srgb, var(--color-warning) 14%, transparent)", color: "var(--color-warning)" },
  live: { background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)", color: "var(--color-accent-2-300)" },
  finished: { background: "var(--color-surface-2)", color: "var(--color-text-muted)" },
  closed: { background: "var(--color-surface-2)", color: "var(--color-text-muted)" },
};

const FIELD: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px", minWidth: 0 };
const LABEL: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--color-text-muted)" };

export function ClubEventsList({
  events,
  openAction,
  season = seasonWindow("", ""),
}: {
  events: ClubEventRow[];
  /** Moves the active tournament so the play shell shows this one. */
  openAction: (formData: FormData) => Promise<void>;
  /**
   * The club's season, which decides how this list is grouped. Defaults to the
   * calendar year so a caller that does not know one renders as it always did.
   */
  season?: SeasonWindow;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [course, setCourse] = useState("");

  const courses = useMemo(
    () => [...new Set(events.map((e) => e.venue).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [events],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return byBand(events).filter((e) => {
      if (q && !`${e.name} ${e.seriesName} ${e.venue}`.toLowerCase().includes(q)) return false;
      if (course && e.venue !== course) return false;
      switch (status) {
        case "open":
          return e.band === "open";
        case "entered":
          return e.entered;
        case "soon":
          return e.band === "soon";
        case "now":
          return e.when === "now";
        case "finished":
          return e.when === "finished";
        default:
          return true;
      }
    });
  }, [events, query, status, course]);

  const filtered = query !== "" || status !== "all" || course !== "";
  const clear = () => {
    setQuery("");
    setStatus("all");
    setCourse("");
  };

  return (
    <>
      {/* Filters only once there is something to filter. A club running one
          or two tournaments showed a search box, a status menu and a count
          ("1 tournament") above the one card they were about. */}
      {events.length >= FILTER_FROM && (
      <section
        aria-label="Filter tournaments"
        className="card elev-sm"
        style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}
      >
        <label style={{ ...FIELD, flex: "none" }}>
          <span style={LABEL}>Search</span>
          <input
            className="input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tournament, series or course"
          />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <label style={FIELD}>
            <span style={LABEL}>Show</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="all">All tournaments</option>
              <option value="open">Open for entries</option>
              <option value="entered">My entries</option>
              <option value="soon">Opening soon</option>
              <option value="now">On now</option>
              <option value="finished">Finished</option>
            </select>
          </label>
          {courses.length > 1 && (
            <label style={FIELD}>
              <span style={LABEL}>Course</span>
              <select className="input" value={course} onChange={(e) => setCourse(e.target.value)}>
                <option value="">Any course</option>
                {courses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span className="text-muted" style={{ fontSize: 13 }} aria-live="polite">
            {shown.length === 1 ? "1 tournament" : `${shown.length} tournaments`}
          </span>
          {filtered && (
            <button type="button" className="btn btn-ghost" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
      </section>
      )}

      {shown.length === 0 ? (
        <div className="card elev-sm" style={{ marginTop: 12 }}>
          <span className="card-title">Nothing matches</span>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            No tournament fits those filters.
          </p>
        </div>
      ) : (
        <SeasonSections
          groups={bySeason(shown, season)}
          currentKey={currentSeason(todayIso(), season)?.key ?? null}
          render={(e) => (
            <article
              key={e.eventId}
              className="card elev-sm"
              style={{ padding: 0, overflow: "hidden", gap: 0 }}
            >
              <div
                style={{
                  ...BAND_STYLE[e.band],
                  minHeight: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase",
                }}
              >
                {e.bandLabel}
              </div>

              <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  {e.seriesName && (
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {e.seriesName}
                    </span>
                  )}
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 18, lineHeight: 1.25 }}>
                    {e.name}
                    {/* WHAT KIND OF DAY IT IS, where the club has said. A
                        charity scramble and a club championship read very
                        differently to a member deciding what to enter, and
                        the name alone does not always say which. Omitted for
                        a plain tournament, which is the default and would be
                        a chip on every card saying nothing. */}
                    {e.playKind && e.playKind !== "tournament" && (
                      <span
                        className="text-muted"
                        style={{ fontSize: 11.5, fontWeight: 600, marginLeft: 8, whiteSpace: "nowrap" }}
                      >
                        {playLabel(e.playKind)}
                      </span>
                    )}
                  </span>
                  <span className="text-muted" style={{ fontSize: 13 }}>
                    {[e.dates, e.venue].filter(Boolean).join(" · ") || "Dates to be confirmed"}
                    {/* SAID, NOT IMPLIED. A member plans around this line, and
                        a date the committee has not fixed read exactly like
                        one it had. In words rather than by styling alone. */}
                    {e.dates && e.datesTentative && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "1px 7px",
                          borderRadius: 999,
                          border: "1px solid var(--color-divider)",
                          color: "var(--color-text)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Tentative
                      </span>
                    )}
                  </span>
                </div>

                {/* WHERE THIS MEMBER STANDS, on every band. It used to ride
                    inside the entry-window block below, which renders only for
                    "open" and "soon" — so somebody on the WAITING LIST, which
                    happens when a tournament is full and therefore closed, was
                    told nothing about themselves. */}
                {e.yourStatus && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: BAND_STYLE[e.band].color }}>
                    {e.yourStatus}
                  </span>
                )}

                {/* The entry window — dates, how far through it today is, and
                    what that means — for the two bands it is about. */}
                {(e.band === "open" || e.band === "soon") && (e.entryDates || e.placesNote) && (
                  <div
                    style={{
                      borderRadius: 12,
                      padding: "10px 12px",
                      background: "var(--color-surface-2)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {e.entryDates && <span style={{ fontSize: 13 }}>{e.entryDates}</span>}
                    {e.progress !== null && (
                      <div
                        aria-hidden="true"
                        style={{
                          height: 6,
                          borderRadius: 3,
                          overflow: "hidden",
                          background: "color-mix(in srgb, var(--color-text) 10%, transparent)",
                        }}
                      >
                        <div
                          style={{
                            height: 6,
                            width: `${Math.round(e.progress * 100)}%`,
                            background: e.band === "soon" ? "var(--color-warning)" : "var(--color-accent)",
                          }}
                        />
                      </div>
                    )}
                    {(e.windowNote || e.placesNote) && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: BAND_STYLE[e.band].color }}>
                        {[e.windowNote, e.placesNote].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                )}

                {/* Why it is shut, in the console's own sentence — only where
                    the band has not already said everything. */}
                {e.band === "closed" && e.statusDetail && (
                  <span className="text-muted" style={{ fontSize: 12.5 }}>
                    {e.statusDetail}
                  </span>
                )}

                {(e.canEnter || e.canView || e.entered) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {e.canEnter && (
                      <EnterButton eventId={e.eventId} href={e.registrationHref} style={{ flex: "1 1 140px" }} />
                    )}
                    {(e.canView || e.entered) && (
                      <form action={openAction} style={{ flex: "1 1 140px", display: "flex" }}>
                        <input type="hidden" name="eventId" value={e.eventId} />
                        {/* Entered, with nothing on the board yet: open Today,
                            where the player's tee time and card are. It had no
                            button at all, while the switcher offered it. */}
                        {!e.canView && <input type="hidden" name="to" value="today" />}
                        <button className="btn btn-secondary" type="submit" style={{ flex: 1 }}>
                          {e.canView ? e.viewLabel : "Open"} <Icon name="arrow-right" />
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </article>
          )}
        />
      )}
    </>
  );
}

/**
 * THE CLUB'S TOURNAMENTS, A SEASON AT A TIME.
 *
 * A club that has run for three years hands a member everything it has ever
 * run, newest first — and the thing they came for, the season they are in, is
 * somewhere down the list. So this season is open and the ones before it are
 * a line each until asked for.
 *
 * ONE SEASON RENDERS FLAT, with no heading at all: a club in its first year
 * would otherwise get a header that divides nothing, which is a label for the
 * app's benefit rather than the member's.
 *
 * Undated tournaments are their own group and say so. They are last because
 * "we have not said when" is the least useful answer to "what is on", and
 * named because silently dropping them would hide a tournament a member could
 * enter.
 */
function SeasonSections({
  groups,
  currentKey,
  render,
}: {
  groups: SeasonGroup<ClubEventRow>[];
  currentKey: number | null;
  render: (e: ClubEventRow) => React.ReactNode;
}) {
  const list = (items: ClubEventRow[]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
      {items.map((e) => (
        <React.Fragment key={e.eventId}>{render(e)}</React.Fragment>
      ))}
    </div>
  );

  if (groups.length <= 1) return list(groups[0]?.items ?? []);

  return (
    <>
      {groups.map((g) => {
        const label = g.season ? g.season.label : "No dates yet";
        const open = g.season ? g.season.key === currentKey : false;
        const count = `${g.items.length} tournament${g.items.length === 1 ? "" : "s"}`;
        return open ? (
          <section key={label} style={{ marginTop: 16 }}>
            <h2
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
                margin: 0,
              }}
            >
              {label} · this season
            </h2>
            {list(g.items)}
          </section>
        ) : (
          <details key={label} style={{ marginTop: 12 }}>
            <summary
              style={{
                cursor: "pointer",
                minHeight: 44,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              {label}
              <span className="text-muted" style={{ fontWeight: 400 }}>
                · {count}
              </span>
            </summary>
            {list(g.items)}
          </details>
        );
      })}
    </>
  );
}
