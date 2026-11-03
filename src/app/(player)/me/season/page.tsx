import { Icon } from "@/components/Icon";
import { MoreInfo } from "@/components/MoreInfo";
import { WayForward } from "@/components/WayForward";
import { requireSession } from "@/lib/page-helpers";
import { screenMetadata } from "@/lib/screen-metadata";
import { countWord } from "@/lib/domain/my-season";
import { mySeasonFor, type SeasonEvent, type SeasonResult } from "@/lib/services/my-season";

export const metadata = screenMetadata("/me/season");

/**
 * MY SEASON — one member's own season at their club (Ajay, 2026-10-24).
 *
 * A number and a word, and nothing else: how many tournaments, how many rounds,
 * the best figures, what was won, and each tournament's result as its own
 * board gives it. Not a feed — no likes, no following, no badges, no chart.
 * Read-only: nothing on this screen writes.
 *
 * Every figure is the board's (`services/my-season.ts` says how), so it can
 * never disagree with the board a member opens next. NOT A TAB — see
 * PLAYER_SEASON in player-nav.ts; reached from a link on Events.
 */
export default async function MySeasonPage() {
  const session = await requireSession();
  const season = await mySeasonFor(session.email, session.eventId);
  const label = season.season ? `${season.season.label} season` : "This season";

  return (
    <>
      <div className="page-kicker">{season.clubName || "TourneyHQ"}</div>
      <h1 className="page-title">My season</h1>
      <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 14 }} data-season-label>
        {label}
      </p>

      {season.events.length === 0 ? (
        <div className="card elev-sm" style={{ marginTop: 16 }} data-season-empty>
          <span className="card-title">Nothing yet this season</span>
          <MoreInfo short="Your tournaments appear here once you enter." style={{ marginTop: 6 }}>
            Every tournament you enter at your club this season is listed here, with your place and
            your best scores once you have played.
          </MoreInfo>
          <WayForward links={[{ href: "/me/events", label: "What my club has on", icon: "calendar-dots" }]} />
        </div>
      ) : (
        <>
          {/* `keep-grid`: three numbers side by side is the point, and the
              phone rule in globals.css otherwise stacks every inline grid. */}
          <ul
            aria-label="Your season in numbers"
            className="keep-grid"
            style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}
          >
            <Tile figure={season.tournaments} word={countWord(season.tournaments, "tournament", "tournaments")} name="tournaments" />
            <Tile figure={season.rounds} word={countWord(season.rounds, "round", "rounds")} name="rounds" />
            <Tile figure={season.wins} word={countWord(season.wins, "prize", "prizes")} name="prizes" />
          </ul>

          {season.bests.length > 0 && (
            <section aria-labelledby="season-bests" style={{ marginTop: 18 }}>
              <h2 id="season-bests" className="card-title" style={{ fontSize: 15, margin: "0 0 8px" }}>
                Best scores <span className="text-muted" style={{ fontWeight: 400 }}>· {season.bestHoles} holes</span>
              </h2>
              <ul
                className="keep-grid"
                style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 10 }}
              >
                {season.bests.map((b) => (
                  <Tile key={b.label} figure={b.value} word={b.label} name={b.label.toLowerCase().replace(" ", "-")} />
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="season-events" style={{ marginTop: 22 }}>
            <h2 id="season-events" className="card-title" style={{ fontSize: 15, margin: "0 0 8px" }}>
              Your tournaments
            </h2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {season.events.map((e) => (
                <EventLine key={e.eventId} event={e} />
              ))}
            </ul>
          </section>

          <WayForward
            links={[
              { href: "/me/events", label: "What my club has on", icon: "calendar-dots" },
              { href: "/me/board", label: "Board", icon: "ranking" },
            ]}
          />
        </>
      )}
    </>
  );
}

/** A number, and the word for what it counts. */
function Tile({ figure, word, name }: { figure: number; word: string; name: string }) {
  return (
    <li className="card elev-sm" style={{ alignItems: "center", textAlign: "center", padding: "12px 8px", gap: 2 }} data-tile={name}>
      <span style={{ fontFamily: "var(--font-heading)", fontSize: 26, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }} data-figure>
        {figure}
      </span>
      <span className="text-muted" style={{ fontSize: 13 }}>
        {word}
      </span>
    </li>
  );
}

/** One tournament: its name and dates, the member's place as the board gives it, and anything won. */
function EventLine({ event }: { event: SeasonEvent }) {
  const r = event.result;
  const placed = r.kind === "place" || r.kind === "side";
  return (
    <li className="card elev-sm" style={{ gap: 6 }} data-season-event={event.eventId}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{event.name}</div>
          {event.dates && (
            <div className="text-muted" style={{ fontSize: 13 }}>
              {event.dates}
            </div>
          )}
        </div>
        {placed && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }} data-place>
              {r.place}
            </div>
            <div className="text-muted" style={{ fontSize: 13 }} data-state>
              {r.state}
            </div>
          </div>
        )}
      </div>
      <ResultLine result={r} rounds={event.rounds} />
      {event.honour && (
        <div style={{ fontSize: 14, fontWeight: 600 }} data-honour>
          <Icon name="trophy" style={{ color: "var(--color-accent-200)" }} /> {event.honour}
        </div>
      )}
      {event.prizes.map((p, i) => (
        <div key={`${p.what}-${i}`} style={{ fontSize: 14, display: "flex", gap: 6, alignItems: "baseline" }} data-prize>
          <Icon name="trophy" style={{ color: "var(--color-accent-200)" }} />
          <span style={{ minWidth: 0 }}>
            {p.what}
            {p.amount && <span style={{ fontVariantNumeric: "tabular-nums" }}> · {p.amount}</span>}
          </span>
        </div>
      ))}
    </li>
  );
}

/** The line under the name: the figures beside a place, or why there is no place. */
function ResultLine({ result, rounds }: { result: SeasonResult; rounds: number }) {
  const roundsWords = rounds > 0 ? `${rounds} ${countWord(rounds, "round", "rounds")}` : "";
  const muted = (text: string, attr: Record<string, string> = {}) => (
    <div className="text-muted" style={{ fontSize: 14 }} {...attr}>
      {text}
    </div>
  );
  switch (result.kind) {
    case "place":
      return (
        <div style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }} data-figures>
          {[...result.figures.map((f) => `${f.label} ${f.value}`), roundsWords].filter(Boolean).join(" · ")}
        </div>
      );
    case "side":
      return (
        <div style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }} data-figures>
          <span data-side>Your side: {result.side}</span>
          <span className="text-muted"> · {result.figures.map((f) => `${f.label} ${f.value}`).join(" · ")}</span>
        </div>
      );
    case "held":
      return muted(["Results not published yet", roundsWords].filter(Boolean).join(" · "), { "data-note": "held" });
    case "manual":
      return muted(["Scored by hand · no place", roundsWords].filter(Boolean).join(" · "), { "data-note": "manual" });
    case "unplaced":
    case "board":
    case "entry":
      return muted([result.note, roundsWords].filter(Boolean).join(" · "), { "data-note": result.kind });
  }
}
