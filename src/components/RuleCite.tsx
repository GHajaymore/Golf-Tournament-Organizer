import { ruleFor, RULE_SOURCE_LABEL } from "@/lib/rules";

/**
 * A quiet reference to the rule a piece of this app implements.
 *
 * Sized and coloured to sit under a control without competing with it. An
 * organizer who already knows the rule should be able to ignore this entirely;
 * one who is being told "you cannot change the tiebreaker now" should be able
 * to find out, in one tap, that it is not our opinion.
 *
 * Opens the publisher's own site in a new tab. The rule text is not reproduced
 * here — see the note in lib/rules.ts.
 */
export function RuleCite({ rule, showWhy = false }: { rule: string; showWhy?: boolean }) {
  const r = ruleFor(rule);
  if (!r) return null;

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "baseline", gap: 5, fontSize: 11.5 }}>
      <a
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--color-neutral-400)", textDecoration: "none", borderBottom: "1px dotted currentColor" }}
        title={`${RULE_SOURCE_LABEL[r.source]} ${r.number} — ${r.title}`}
      >
        <i className="ph ph-book-open" aria-hidden style={{ marginRight: 3 }} />
        {RULE_SOURCE_LABEL[r.source]} {r.number}
      </a>
      {showWhy && <span style={{ color: "var(--color-neutral-400)" }}>{r.why}</span>}
    </span>
  );
}
