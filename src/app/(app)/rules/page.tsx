import { requireScreen } from "@/lib/page-helpers";
import { RULES, RULE_SOURCE_LABEL, type RuleSource } from "@/lib/rules";

/**
 * What this app enforces, and where each rule comes from.
 *
 * This is not a rules encyclopedia — the Rules of Golf app already exists and
 * is better at that, and the text is not ours to reproduce. It is the narrower,
 * more useful thing: a list of the places TourneyHQ makes a decision on a
 * committee's behalf, with the published rule behind each one and a link to
 * read it.
 *
 * The audience is the person who has to defend a result. A club professional
 * asked why the tie broke the way it did, or why a card cannot be edited after
 * approval, can answer from here in one tap instead of taking our word for it.
 */

const ORDER: RuleSource[] = ["rules-of-golf", "committee-procedures", "handicapping"];

const SOURCE_NOTE: Record<RuleSource, string> = {
  "rules-of-golf": "How the game is played.",
  "committee-procedures":
    "How a competition is run — the terms of the competition, and deciding ties. Published alongside the Rules, but a separate document.",
  handicapping:
    "Course handicap, playing handicap and format allowances. A separate publication again: these are not the Rules of Golf, and this app keeps them apart deliberately.",
};

export default async function RulesPage() {
  await requireScreen("rules");

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="page-kicker">Reference</div>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 28, margin: "6px 0 0", textWrap: "balance" }}>
        The rules behind the app
      </h1>
      <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
        Where TourneyHQ decides something on your behalf, this is the published rule it follows. Links go to the
        publisher — we cite the rules, we don&rsquo;t reproduce them, so what you read is always the current text.
      </p>

      {ORDER.map((source) => {
        const entries = Object.values(RULES).filter((r) => r.source === source);
        if (!entries.length) return null;
        return (
          <section key={source} style={{ marginTop: 30 }}>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 19, margin: 0 }}>
              {RULE_SOURCE_LABEL[source]}
            </h2>
            <p style={{ margin: "5px 0 14px", fontSize: 13, lineHeight: 1.55, color: "var(--color-neutral-400)" }}>
              {SOURCE_NOTE[source]}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {entries.map((r) => (
                <a
                  key={r.key}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card elev-sm"
                  style={{ display: "block", textDecoration: "none", color: "inherit", padding: "14px 16px" }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 600 }}>
                      <span style={{ color: "var(--color-accent-300)", marginRight: 7, fontVariantNumeric: "tabular-nums" }}>
                        {r.number}
                      </span>
                      {r.title}
                    </span>
                    <i className="ph ph-arrow-square-out" aria-hidden style={{ color: "var(--color-neutral-400)" }} />
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--color-neutral-400)" }}>
                    {r.why}
                  </p>
                </a>
              ))}
            </div>
          </section>
        );
      })}

      <p style={{ marginTop: 28, fontSize: 12, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
        The Rules of Golf and the Rules of Handicapping are published by the USGA and The R&amp;A and are their
        copyright. TourneyHQ links to them and does not reproduce them. Where a club has adopted a Local Rule or a
        condition of competition that differs, the club&rsquo;s own terms govern — not this page.
      </p>
    </div>
  );
}
