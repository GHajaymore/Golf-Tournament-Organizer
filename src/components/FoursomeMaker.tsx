"use client";
import { useMemo, useState } from "react";
import { formGroups, type FormationRule, type Player } from "@/lib/domain";
import { listNames } from "@/lib/format";
import { drawReadiness } from "@/lib/domain/draw-readiness";
import { useTransition } from "react";
import { saveTeeSheet, setTeeSheetPublished } from "@/app/actions/tee-sheet";
import {
  DRAW_ORDERS,
  groupByStandings,
  orderGroups,
  positionLookup,
  startSlots,
  type DrawOrder,
  type Standing,
  type StartStyle,
} from "@/lib/domain/draw";

/** How the field is carved into groups. "standings" needs a round played. */
type Pairing = FormationRule | "standings";

const ALGORITHMS: Array<{ key: Pairing; label: string; icon: string; desc: string; needsStandings?: boolean }> = [
  { key: "random", label: "Random", icon: "ph ph-shuffle", desc: "Completely random groups — shuffle and deal." },
  { key: "handicap", label: "Balanced handicap", icon: "ph ph-chart-bar", desc: "Spread handicaps so each group has a comparable mix." },
  { key: "balanced", label: "Balanced skill", icon: "ph ph-scales", desc: "Combine handicap and ranking so group strengths are even." },
  { key: "seeding", label: "Seeded", icon: "ph ph-list-numbers", desc: "Pair by tournament seed/ranking." },
  {
    key: "standings",
    label: "By position",
    icon: "ph ph-trophy",
    desc: "Group by the leaderboard — you play with the players nearest you on the board. The standard re-pairing from round two on.",
    needsStandings: true,
  },
];

const avg = (nums: number[]) =>
  nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0;

/**
 * The tee sheet.
 *
 * Three separate decisions, and keeping them separate is the point: who plays
 * with whom, the order those groups go off, and whether it's one tee, two, or
 * a shotgun. They used to be one control, which meant a second round could be
 * grouped off the leaderboard but not *drawn* off it — the leaders came out
 * wherever the grouping happened to put them.
 */
export function FoursomeMaker({
  players,
  standings = [],
  holes = 18,
  stageId = "",
  savedAt = "",
  published = false,
  rounds = [],
  activeRoundId = "",
}: {
  players: Player[];
  /** Current leaderboard, best first. Empty before anyone has posted a score. */
  standings?: Standing[];
  holes?: 9 | 18;
  /** The round this sheet belongs to; empty disables saving. */
  stageId?: string;
  /** When a sheet was last saved for this round, ISO. Empty = never. */
  savedAt?: string;
  published?: boolean;
  /** Every round the field plays, so a sheet can be drawn ahead or reopened. */
  rounds?: Array<{ id: string; label: string }>;
  activeRoundId?: string;
}) {
  const hasStandings = standings.length > 0;
  const [algo, setAlgo] = useState<Pairing>("random");
  const [order, setOrder] = useState<DrawOrder>("as-formed");
  const [size, setSize] = useState(4);
  const [seed, setSeed] = useState(1);
  const [startType, setStartType] = useState<StartStyle>("tee");
  const [saveState, setSaveState] = useState<{ savedAt: string; published: boolean }>({ savedAt, published });
  const [saveError, setSaveError] = useState("");
  const [savePending, startSaveTransition] = useTransition();
  // Publishing shows the draw to every player, so it is a two-step, deliberate
  // act rather than one blue button next to Save. The confirm follows the app's
  // pattern (see ClearScores): a control that changes what it says has to be
  // read, where a dialog gets dismissed on reflex.
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [firstTee, setFirstTee] = useState("08:00");
  const [interval, setInterval] = useState(10);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const positionOf = useMemo(() => positionLookup(standings), [standings]);
  const rng = useMemo(() => {
    let s = seed || 1;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }, [seed]);

  const groups = useMemo(() => {
    const formed =
      algo === "standings"
        ? groupByStandings(players, positionOf, size, (i) => `fs-${i}`)
        : formGroups(players, algo, { mode: "perFlight", value: size }, (i) => `fs-${i}`, rng);
    return orderGroups(formed, order, positionOf, rng);
  }, [players, algo, order, size, rng, positionOf]);

  const slots = useMemo(
    () => startSlots(groups, startType, { firstTee, interval, holes }),
    [groups, startType, firstTee, interval, holes],
  );

  // Composition summary, e.g. "7 foursomes · 1 twosome".
  const sizes = groups.map((g) => g.playerIds.length);
  const counts = sizes.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  const sizeName: Record<number, string> = { 2: "twosome", 3: "threesome", 4: "foursome" };
  const summary = Object.entries(counts)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([s, n]) => `${n} ${sizeName[Number(s)] ?? `${s}-ball`}${n > 1 ? "s" : ""}`)
    .join(" · ");

  const persist = (publish: boolean) => {
    setSaveError("");
    startSaveTransition(async () => {
      const sheet = {
        savedAt: "",
        startType,
        groups: groups.map((g, i) => {
          const slot = slots[i];
          return {
            name: `Group ${i + 1}`,
            startHole: slot.startHole,
            half: slot.half,
            time: slot.time,
            playerIds: g.playerIds,
          };
        }),
      };
      const res = await saveTeeSheet(stageId, sheet, publish);
      if (!res.ok) {
        setSaveError(res.error ?? "Couldn't save the sheet.");
        return;
      }
      setSaveState({ savedAt: new Date().toISOString(), published: publish });
    });
  };

  // Pull a published sheet back without touching the draw — the survivors' cards
  // and times stay saved, players just stop seeing it on their dashboard.
  const unpublish = () => {
    setSaveError("");
    startSaveTransition(async () => {
      const res = await setTeeSheetPublished(stageId, false);
      if (!res.ok) {
        setSaveError(res.error ?? "Couldn't unpublish the sheet.");
        return;
      }
      setSaveState((s) => ({ savedAt: s.savedAt || new Date().toISOString(), published: false }));
    });
  };

  const active = ALGORITHMS.find((a) => a.key === algo) ?? ALGORITHMS[0];
  const activeOrder = DRAW_ORDERS.find((d) => d.key === order) ?? DRAW_ORDERS[2];
  // Which options are greyed out, named from the arrays that grey them, so the
  // sentence explaining it cannot come to list the wrong ones.
  const standingsBlocked = hasStandings ? [] : ALGORITHMS.filter((a) => a.needsStandings).map((a) => a.label);
  const orderBlocked = hasStandings ? [] : DRAW_ORDERS.filter((d) => d.needsStandings).map((d) => d.label);
  // Why the sheet cannot be saved, or null. The same rule the Flights screen
  // uses, because a tee sheet is drawn from the field exactly as flights are.
  // `locked` is false here: this screen has no lock of its own, and claiming
  // one would be a refusal the app cannot back up.
  const saveBlock = drawReadiness({ fieldSize: players.length, locked: false });

  return (
    <>
      {/* Which round's sheet this is — the one thing this screen never said.
          It read the active round and nothing else, so next week's sheet could
          not be drawn ahead, last week's could not be reopened, and the page
          quietly changed subject as the tournament advanced. */}
      {rounds.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            overflowX: "auto",
            paddingBottom: 6,
            marginBottom: 14,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {rounds.map((r) => (
            <a
              key={r.id}
              href={`/foursomes?round=${r.id}`}
              className={r.id === activeRoundId ? "btn btn-primary" : "btn btn-ghost"}
              style={{ whiteSpace: "nowrap", flexShrink: 0, fontSize: 12.5, textDecoration: "none" }}
              aria-current={r.id === activeRoundId ? "true" : undefined}
            >
              {r.label}
            </a>
          ))}
        </div>
      )}

      <div className="card elev-sm" style={{ marginBottom: 16, gap: 16 }}>
        {/* Nothing here works off a leaderboard until one exists, and an
            organizer setting up round one should be told that rather than
            wondering why half the options are greyed. */}
        {!hasStandings && (
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            <i className="ph ph-info" /> No scores posted yet, so the leaderboard options are off. They
            switch on once a round has been played — that&apos;s when re-pairing by position and drawing
            the leaders out last start to mean something.
          </p>
        )}

        <div>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Who plays together</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ALGORITHMS.map((a) => {
              const on = a.key === algo;
              const off = a.needsStandings && !hasStandings;
              return (
                <button
                  key={a.key}
                  type="button"
                  disabled={off}
                  onClick={() => setAlgo(a.key)}
                  className="btn"
                  style={{
                    border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`,
                    color: on ? "var(--color-accent)" : "var(--color-text)",
                    opacity: off ? 0.45 : 1,
                  }}
                >
                  <i className={a.icon} /> {a.label}
                </button>
              );
            })}
          </div>
          <p className="text-muted" style={{ fontSize: 12, margin: "10px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
            {active.desc}
          </p>
          {/* Why the greyed ones are greyed, on the page. Both groups here
              explained themselves with a `title` only — which never appears on
              a touch device, is not announced to a screen reader, and is the
              pattern this codebase has already rejected twice. The options are
              named from the array rather than described as "the greyed ones",
              so the sentence cannot drift from what is actually disabled. */}
          {standingsBlocked.length > 0 && (
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
              <i className="ph ph-info" /> {listNames(standingsBlocked)}{" "}
              {standingsBlocked.length === 1 ? "needs" : "need"} the leaderboard, so{" "}
              {standingsBlocked.length === 1 ? "it is" : "they are"} available only once a round has
              been played.
            </p>
          )}
        </div>

        <div>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Order off the tee</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DRAW_ORDERS.map((d) => {
              const on = d.key === order;
              const off = d.needsStandings && !hasStandings;
              return (
                <button
                  key={d.key}
                  type="button"
                  disabled={off}
                  onClick={() => setOrder(d.key)}
                  className="btn"
                  style={{
                    border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`,
                    color: on ? "var(--color-accent)" : "var(--color-text)",
                    opacity: off ? 0.45 : 1,
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <p className="text-muted" style={{ fontSize: 12, margin: "10px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
            {activeOrder.blurb}
          </p>
          {orderBlocked.length > 0 && (
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
              <i className="ph ph-info" /> {listNames(orderBlocked)}{" "}
              {orderBlocked.length === 1 ? "needs" : "need"} the leaderboard, so{" "}
              {orderBlocked.length === 1 ? "it is" : "they are"} available only once a round has been
              played.
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ width: 180 }}>
            <label>Group size</label>
            <div className="seg" style={{ width: "100%" }}>
              {[2, 3, 4].map((n) => (
                <label className="seg-opt" key={n} style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="fssize" checked={size === n} onChange={() => setSize(n)} />{n}
                </label>
              ))}
            </div>
          </div>
          <div className="field" style={{ width: 260 }}>
            <label>Start</label>
            <div className="seg" style={{ width: "100%" }}>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="fsstart" checked={startType === "tee"} onChange={() => setStartType("tee")} /> One tee
              </label>
              <label
                className="seg-opt"
                style={{ flex: 1, justifyContent: "center" }}
                title={holes === 9 ? "1st and 5th" : "1st and 10th"}
              >
                <input type="radio" name="fsstart" checked={startType === "split"} onChange={() => setStartType("split")} /> Split
              </label>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="fsstart" checked={startType === "shotgun"} onChange={() => setStartType("shotgun")} /> Shotgun
              </label>
            </div>
          </div>
          <div className="field" style={{ width: 120 }}>
            <label>First tee</label>
            <input className="input" type="time" value={firstTee} onChange={(e) => setFirstTee(e.target.value)} />
          </div>
          {startType !== "shotgun" && (
            <div className="field" style={{ width: 130 }}>
              <label>Interval (min)</label>
              <input
                className="input"
                type="number"
                min={1}
                max={30}
                value={interval}
                onChange={(e) => setInterval(Math.max(1, parseInt(e.target.value, 10) || 10))}
              />
            </div>
          )}
          <div style={{ flex: 1 }} />
          <span className="text-muted" style={{ fontSize: 12 }}>{groups.length} groups · {summary}</span>
          {(algo === "random" || order === "random") && (
            <button type="button" className="btn btn-primary" onClick={() => setSeed((s) => s + 1)}>
              <i className="ph ph-shuffle" /> Reshuffle
            </button>
          )}
          {/* Saving turns the draw on screen into the round's sheet of
              record; publishing is the separate, outward-facing act of telling
              the field. Saving a draft is the safe primary action — publishing
              is deliberate and confirmed, because a work-in-progress draw saved
              by reflex must not land on every player's dashboard. Until saved,
              this screen is a sketch that vanishes on refresh. */}
          {stageId && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savePending || groups.length === 0}
                onClick={() => { setConfirmPublish(false); persist(false); }}
              >
                <i className="ph ph-floppy-disk" /> {savePending ? "Saving…" : "Save sheet"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={savePending || groups.length === 0}
                onClick={() => setConfirmPublish(true)}
              >
                <i className="ph ph-megaphone" /> Save &amp; publish
              </button>
              {saveState.published && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={savePending}
                  onClick={() => { setConfirmPublish(false); unpublish(); }}
                >
                  <i className="ph ph-eye-slash" /> Unpublish
                </button>
              )}
            </>
          )}
        </div>

        {/* Why "Save sheet" is dead, when it is.
            Both save buttons carried `groups.length === 0` and said nothing, so
            on the ordinary first-day state — a round with no field yet — an
            organizer got two grey buttons and no way to tell whether the app
            was broken, they lacked permission, or something was missing.

            `drawReadiness` rather than a second rule: a tee sheet is drawn from
            the FIELD exactly as the flights are, so this is the same refusal
            GroupingControls already renders, with the same link to the same
            screen. A second copy would eventually disagree about what an empty
            field means. */}
        {stageId && saveBlock && (
          <p
            style={{
              fontSize: 12.5,
              margin: "10px 0 0",
              lineHeight: 1.5,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: "9px 11px",
              borderRadius: 9,
              background: "color-mix(in srgb, var(--color-text) 5%, transparent)",
            }}
          >
            <i className="ph ph-info" style={{ fontSize: 14, marginTop: 1, flex: "none" }} />
            <span>
              {saveBlock.problem}{" "}
              <a href={saveBlock.href} style={{ color: "var(--color-accent-300)" }}>
                {saveBlock.linkLabel}
              </a>
            </span>
          </p>
        )}

        {/* The confirmation lives here, below the toolbar, so the sentence and
            the button that acts on it are read together. */}
        {confirmPublish && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              fontSize: 13,
              padding: "10px 12px",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
            }}
          >
            <span style={{ flex: 1, minWidth: 220 }}>
              <i className="ph ph-megaphone" style={{ marginRight: 6 }} />
              This shows the draw to every player. Publish the tee sheet?
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={savePending || groups.length === 0}
              onClick={() => { setConfirmPublish(false); persist(true); }}
            >
              {savePending ? "Publishing…" : "Publish the tee sheet"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={savePending}
              onClick={() => setConfirmPublish(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {(saveState.savedAt || saveError) && (
        <p style={{ fontSize: 12, margin: "0 0 10px", color: saveError ? "var(--color-danger)" : "var(--color-neutral-500)" }}>
          {saveError ? (
            <><i className="ph ph-warning-circle" /> {saveError}</>
          ) : (
            <>
              <i className={saveState.published ? "ph ph-megaphone" : "ph ph-floppy-disk"} />{" "}
              {saveState.published ? "Published to players" : "Saved as a draft"} — regenerating here only changes
              the preview until you save again.
            </>
          )}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
        {groups.map((g, i) => {
          const gp = g.playerIds.map((id) => byId.get(id)!).filter(Boolean);
          const slot = slots[i];
          return (
            <div key={g.id} className="card elev-sm" style={{ gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Group {i + 1}</span>
                <span className="text-muted" style={{ fontSize: 11 }}>avg {avg(gp.map((p) => p.handicap))}</span>
              </div>
              <div className="tag tag-accent" style={{ alignSelf: "flex-start", fontSize: 11 }}>
                <i className="ph ph-clock" style={{ marginRight: 4 }} />
                {`Hole ${slot.startHole}${slot.half ?? ""} · ${slot.time}`}
              </div>
              {gp.map((p) => {
                const pos = positionOf(p.id);
                const ranked = hasStandings && pos !== Number.MAX_SAFE_INTEGER;
                return (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "3px 0", borderBottom: "1px solid var(--color-divider)" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ranked && (
                        <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums", marginRight: 6 }}>
                          {pos}
                        </span>
                      )}
                      {p.name}
                    </span>
                    <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{p.handicap}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
