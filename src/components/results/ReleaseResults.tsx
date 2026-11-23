import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { ReleaseView } from "@/lib/domain/release-results";

/**
 * THE ONE VERB FOR RELEASING, on the redesigned Results (R12). It draws what `releaseView` decided and writes nothing: the
 * press is the machine's own `complete` move (and its Reopen), reached by a link to where it asks (`nextAction.href`).
 * A server file: it imports only components and a type.
 */
export function ReleaseResults({ view }: { view: ReleaseView }) {
  return (
    <section data-release-results={view.kind} aria-label="Releasing the results" className="card elev-sm" style={{ gap: 8, minWidth: 0, margin: "12px 0 0" }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, maxWidth: "62ch" }}>{view.says}</p>
      {view.kind === "ready" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Link href={view.href} className="btn btn-primary" style={{ minHeight: 44, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="check-circle" /> {view.verb}
          </Link>
          {view.asks && (
            <span className="text-muted" style={{ fontSize: 13 }}>
              It asks first: {view.asks}
            </span>
          )}
        </div>
      )}
      {view.kind === "released" && view.reopen && (
        <div>
          <Link href={view.reopen.href} className="btn btn-secondary" style={{ minHeight: 44, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="lock-key-open" /> {view.reopen.label}
          </Link>
        </div>
      )}
    </section>
  );
}
