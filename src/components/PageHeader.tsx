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
      }}
    >
      <div>
        <div className="page-kicker">{kicker}</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>{title}</h2>
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
        {icon && <i className={icon} style={{ color: "var(--color-accent)", fontSize: 16 }} />}
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
