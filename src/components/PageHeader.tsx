import { Icon } from "./Icon";
export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 20,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div className="page-kicker">{kicker}</div>
        <h1 className="page-title">{title}</h1>
        {subtitle && (
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: string;
}) {
  return (
    <div className="card elev-sm" style={{ gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="card-kicker">{label}</span>
        {icon && <Icon name={icon} style={{ color: "var(--color-accent)", fontSize: 16 }} />}
      </div>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 26, lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div className="text-muted" style={{ fontSize: 12 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * A card that states ONE FACT about the tournament: what it is, the number,
 * and the sentence under it.
 *
 * Distinct from `StatCard`, which is a tile in the grid across the top. This is
 * the taller card in the right-hand column — a name and a badge on one line, a
 * figure in the heading face, a muted line saying what the figure means.
 *
 * Extracted because the dashboard wrote it twice, for "Qualification cutoff"
 * and "Round cut", and the two had already drifted: one used `fontSize: 22`
 * and the other `20`. Two cards in one column, a pixel apart, for no reason
 * anybody chose. They are both 22 now.
 */
export function FactCard({
  title,
  badge,
  badgeTone = "accent",
  figure,
  note,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  badgeTone?: "accent" | "neutral";
  /**
   * The number, in the heading face. Omit for a card that is all prose.
   *
   * Checked against `undefined` rather than for truthiness, and the difference
   * is a real one: `figure={0}` is an answer — nobody advancing yet — and a
   * falsy test drops it out of the heading-face wrapper, leaving a bare "0" in
   * body text beside cards whose numbers are twice the size.
   */
  figure?: React.ReactNode;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="card elev-sm">
      <div className="card-head">
        <span className="card-title">{title}</span>
        {badge && <span className={`tag tag-${badgeTone}`}>{badge}</span>}
      </div>
      {figure !== undefined && (
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, marginTop: 2 }}>{figure}</div>
      )}
      {note && (
        <div className="text-muted" style={{ fontSize: 12 }}>
          {note}
        </div>
      )}
      {children}
    </div>
  );
}
