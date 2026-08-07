"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSeries, updateSeries, deleteSeries, setEventSeries } from "@/app/actions/series";
import { describeTable, type SeriesStanding } from "@/lib/domain/series";

export interface SeriesSummary {
  id: string;
  name: string;
  description: string;
  pointsTable: number[];
  bestOf: number;
  minEvents: number;
  status: string;
  eventCount: number;
}

export interface SeriesEventRow {
  id: string;
  name: string;
  dates: string;
  counted: boolean;
}

/**
 * A season, its settings, and the order of merit it produces.
 *
 * The table is the point of the screen and comes first. Everything that
 * configures it sits behind a disclosure — a club sets the points scheme once
 * and then looks at the standings every week.
 */
export function SeriesClient({
  seasons,
  activeId,
  events,
  standings,
  unlinked,
  currentEventId,
  currentEventSeriesId,
  canEdit,
}: {
  seasons: SeriesSummary[];
  activeId: string | null;
  events: SeriesEventRow[];
  standings: SeriesStanding[];
  /** Entries with no roster link, which cannot be tracked across a season. */
  unlinked: number;
  currentEventId: string;
  currentEventSeriesId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const active = seasons.find((s) => s.id === activeId) ?? null;
  const [draft, setDraft] = useState({
    pointsTable: active ? active.pointsTable.join(", ") : "",
    bestOf: active ? String(active.bestOf) : "0",
    minEvents: active ? String(active.minEvents) : "0",
  });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const counted = events.filter((e) => e.counted).length;

  if (seasons.length === 0) {
    return (
      <div className="card elev-sm" style={{ gap: 10 }}>
        <span className="card-title" style={{ fontSize: 15 }}>No seasons yet</span>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          A season totals results across several tournaments into one order of merit — a winter
          league, a summer series, a club championship run over a season. Each round keeps its own
          leaderboard; the season adds them up on finishing position, so rounds played in different
          formats still combine.
        </p>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>Season name</label>
              <input
                className="input"
                value={newName}
                placeholder="e.g. Winter League 2026"
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || !newName.trim()}
              onClick={() => {
                run(() => createSeries(newName));
                setNewName("");
              }}
            >
              <i className="ph ph-plus" /> Start a season
            </button>
          </div>
        )}
        {error && <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card elev-sm" style={{ gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {seasons.length > 1 ? (
            <select
              className="input"
              style={{ maxWidth: 280 }}
              value={activeId ?? ""}
              onChange={(e) => router.push(`/series?id=${e.target.value}`)}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status === "complete" ? " (finished)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="card-title" style={{ fontSize: 15 }}>{active?.name}</span>
          )}
          {active?.status === "complete" && <span className="tag tag-neutral">Finished</span>}
          <span className="text-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
            {counted} of {events.length} {events.length === 1 ? "round" : "rounds"} counted
          </span>
        </div>

        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          {describeTable(active?.pointsTable ?? [])}
          {active && active.bestOf > 0 && ` · best ${active.bestOf} rounds count`}
          {active && active.minEvents > 0 && ` · ${active.minEvents} rounds to qualify`}
        </p>

        {/* Only finished tournaments count. A round in progress has a
            leaderboard that moves with every card, and letting it shift the
            order of merit would show a season position that reverses itself. */}
        {events.some((e) => !e.counted) && (
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            {events.filter((e) => !e.counted).map((e) => e.name).join(", ")} —{" "}
            {events.filter((e) => !e.counted).length === 1 ? "not finished yet, so it doesn't" : "not finished yet, so they don't"}{" "}
            count. Mark a tournament completed to bring it into the season.
          </p>
        )}

        {unlinked > 0 && (
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            {unlinked} {unlinked === 1 ? "entry has" : "entries have"} no roster record, so{" "}
            {unlinked === 1 ? "it isn't" : "they aren't"} tracked across the season — there is
            nothing to match {unlinked === 1 ? "it" : "them"} to next round.
          </p>
        )}

        {canEdit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "2px 10px", fontSize: 12 }}
              onClick={() => setShowSettings((o) => !o)}
            >
              {showSettings ? "Done" : "Scoring & rules"}
            </button>
            {currentEventId && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "2px 10px", fontSize: 12 }}
                disabled={pending}
                onClick={() =>
                  run(() =>
                    setEventSeries(
                      currentEventId,
                      currentEventSeriesId === activeId ? null : activeId,
                    ),
                  )
                }
              >
                {currentEventSeriesId === activeId
                  ? "Remove this tournament from the season"
                  : "Add this tournament to the season"}
              </button>
            )}
          </div>
        )}

        {showSettings && canEdit && active && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 12,
              borderRadius: 10,
              border: "1px solid var(--color-divider)",
              background: "var(--color-bg)",
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: 1, minWidth: 220 }}>
                <label>Points for each position</label>
                <input
                  className="input"
                  value={draft.pointsTable}
                  placeholder="100, 80, 65, 55…"
                  onChange={(e) => setDraft({ ...draft, pointsTable: e.target.value })}
                />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label>Best of</label>
                <input
                  className="input"
                  inputMode="numeric"
                  value={draft.bestOf}
                  onChange={(e) => setDraft({ ...draft, bestOf: e.target.value })}
                />
              </div>
              <div className="field" style={{ width: 130 }}>
                <label>Rounds to qualify</label>
                <input
                  className="input"
                  inputMode="numeric"
                  value={draft.minEvents}
                  onChange={(e) => setDraft({ ...draft, minEvents: e.target.value })}
                />
              </div>
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Players tied for a position share what those places are worth between them.
              Best-of 0 counts every round. Qualify 0 ranks everyone — set it so somebody who
              played once and won doesn&apos;t top the table.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    updateSeries(active.id, {
                      pointsTable: draft.pointsTable,
                      bestOf: parseInt(draft.bestOf, 10) || 0,
                      minEvents: parseInt(draft.minEvents, 10) || 0,
                    }),
                  )
                }
              >
                Save rules
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    updateSeries(active.id, {
                      status: active.status === "complete" ? "active" : "complete",
                    }),
                  )
                }
              >
                {active.status === "complete" ? "Reopen season" : "Mark season finished"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                title="Rounds played in this season keep their results"
                onClick={() => run(() => deleteSeries(active.id))}
              >
                Delete season
              </button>
            </div>
          </div>
        )}

        {error && <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>{error}</p>}
      </div>

      <div className="card elev-sm">
        {standings.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            No finished rounds yet. The table fills in as tournaments in this season are completed.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Player</th>
                  <th style={{ textAlign: "right" }}>Played</th>
                  <th style={{ textAlign: "right" }}>Points</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => (
                  <>
                    <tr key={s.memberId}>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>
                        {s.position ?? <span className="text-muted" title="Hasn't played enough rounds to be ranked">—</span>}
                      </td>
                      <td style={{ fontWeight: 500 }}>{s.name}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.played}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {Number.isInteger(s.total) ? s.total : s.total.toFixed(1)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn btn-icon"
                          title="Show every round"
                          onClick={() => setExpanded(expanded === s.memberId ? null : s.memberId)}
                        >
                          <i className={`ph ph-caret-${expanded === s.memberId ? "up" : "down"}`} />
                        </button>
                      </td>
                    </tr>
                    {expanded === s.memberId && (
                      <tr key={`${s.memberId}-detail`}>
                        <td colSpan={5} style={{ paddingTop: 0 }}>
                          {/* Dropped rounds are shown rather than hidden: an
                              organizer fielding a query needs to see what was
                              left out and why. */}
                          <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
                            {s.entries.map((e) => (
                              <div
                                key={e.eventId}
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  opacity: e.counted ? 1 : 0.5,
                                }}
                              >
                                <span style={{ flex: 1 }}>{e.eventName}</span>
                                <span className="text-muted">{ordinalOf(e.rank)}</span>
                                <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 44, textAlign: "right" }}>
                                  {Number.isInteger(e.points) ? e.points : e.points.toFixed(1)}
                                </span>
                                <span className="text-muted" style={{ minWidth: 60 }}>
                                  {e.counted ? "" : "dropped"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ordinalOf(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
