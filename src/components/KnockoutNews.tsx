import type { PlayBy } from "@/lib/domain/knockout-play-by";

/**
 * WHAT THE CLUB'S PUBLIC BOARD OPENS ON FOR A KNOCKOUT (the panel, 2026-10-23):
 * the latest results, then who is still in and what is still to play — each
 * round with its play-by date, "Overdue" written out — then the drawing.
 */
export function KnockoutNews({
  news,
}: {
  news: {
    latest: Array<{ key: string; line: string }>;
    stillIn: number;
    toPlay: Array<{ round: string; playBy: PlayBy | null; ties: Array<{ key: string; pair: string }> }>;
    waiting: number;
    champions: Array<{ draw: string; name: string }>;
  };
}) {
  const ties = news.toPlay.reduce((n, g) => n + g.ties.length, 0);
  const h2 = { fontFamily: "var(--font-heading)", fontSize: 18, margin: 0 } as const;
  const list = { listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 4, fontSize: 14.5, lineHeight: 1.45 } as const;
  return (
    <div style={{ display: "grid", gap: 20, marginTop: 8 }}>
      {news.champions.length > 0 && (
        <section aria-labelledby="ko-champion">
          <h2 id="ko-champion" style={h2}>
            {news.champions.length === 1 ? "Champion" : "Champions"}
          </h2>
          <ul style={list}>
            {news.champions.map((c) => (
              <li key={c.draw || c.name}>
                {c.draw ? `${c.draw}: ` : ""}
                <strong>{c.name}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="ko-latest">
        <h2 id="ko-latest" style={h2}>
          Latest results
        </h2>
        {news.latest.length === 0 ? (
          <p style={{ margin: "6px 0 0", fontSize: 14.5, color: "var(--color-neutral-400)" }}>No tie has been played yet.</p>
        ) : (
          <ul style={list}>
            {news.latest.map((r) => (
              <li key={r.key}>{r.line}</li>
            ))}
          </ul>
        )}
      </section>
      {news.champions.length === 0 && (
        <section aria-labelledby="ko-still">
          <h2 id="ko-still" style={h2}>
            Still to play
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 14.5, color: "var(--color-neutral-400)" }}>
            {news.stillIn} {news.stillIn === 1 ? "player is" : "players are"} still in.{" "}
            {ties > 0 ? `${ties} ${ties === 1 ? "tie is" : "ties are"} ready to play` : "Nothing is ready to play"}
            {news.waiting > 0 ? `, and ${news.waiting} more ${news.waiting === 1 ? "waits" : "wait"} on a result before ${news.waiting === 1 ? "it" : "them"}.` : "."}
          </p>
          {news.toPlay.map((g) => (
            <div key={g.round} style={{ marginTop: 10 }}>
              <h3 style={{ fontSize: 14.5, margin: 0 }}>
                {g.round}
                {g.playBy && (
                  <span style={{ fontWeight: 400 }}>
                    {" "}
                    · Play by {g.playBy.words}
                    {g.playBy.overdue && <strong style={{ color: "var(--color-danger)" }}> · Overdue</strong>}
                  </span>
                )}
              </h3>
              <ul style={list}>
                {g.ties.map((t) => (
                  <li key={t.key}>{t.pair}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
