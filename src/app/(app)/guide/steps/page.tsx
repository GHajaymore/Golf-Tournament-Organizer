import { Fragment } from "react";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { GUIDE_STEPS, type GuideBlock } from "@/lib/guide-steps";

/**
 * THE STEP-BY-STEP GUIDE, under Help (Ajay, 2026-10-02: "add the guide to the
 * Help section"). The content lives in `lib/guide-steps.ts`; this page only
 * draws it, in the club's own theme, and offers the same guide as a PDF.
 *
 * Static: it reads nothing from the database, so it renders the same for every
 * club at every stage of a tournament.
 */

export const metadata = screenMetadata("/guide/steps");

const PDF = "/guide/tourneyhq-organizer-guide.pdf";

/** [[label]] → an on-screen control; **text** → emphasis. Nothing else. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("[[") && part.endsWith("]]")) {
          return (
            <span
              key={i}
              style={{
                fontWeight: 600,
                whiteSpace: "nowrap",
                padding: "0 5px",
                borderRadius: 5,
                background: "color-mix(in srgb, var(--color-text) 7%, transparent)",
              }}
            >
              {part.slice(2, -2)}
            </span>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

const text = { margin: 0, maxWidth: 760, fontSize: 14.5, lineHeight: 1.65 } as const;

function Block({ b }: { b: GuideBlock }) {
  switch (b.kind) {
    case "p":
      return <p style={text}><Rich text={b.text} /></p>;
    case "h":
      return <h3 style={{ margin: "10px 0 0", fontSize: 16.5, fontWeight: 650 }}>{b.text}</h3>;
    case "where":
      return <div className="card-kicker" style={{ margin: 0 }}>{b.text}</div>;
    case "steps":
      return (
        <ol style={{ ...text, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 }}>
          {b.items.map((s) => <li key={s}><Rich text={s} /></li>)}
        </ol>
      );
    case "list":
      return (
        <ul style={{ ...text, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          {b.items.map((s) => <li key={s}><Rich text={s} /></li>)}
        </ul>
      );
    case "tip":
    case "warn":
      return (
        <div
          className="card elev-sm"
          style={{
            padding: "10px 14px",
            maxWidth: 760,
            borderLeft: `4px solid ${b.kind === "tip" ? "var(--color-accent-2-300)" : "var(--color-accent-300)"}`,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <Rich text={b.text} />
        </div>
      );
    case "table":
      return (
        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 520 }}>
            <thead><tr>{b.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{b.rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} style={i === 0 ? { fontWeight: 600 } : undefined}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    case "recipes":
      return (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}>
          {b.items.map((r) => (
            <div key={r.title} className="card elev-sm" style={{ padding: "14px 16px", gap: 6, minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 15 }}>{r.title}</div>
              <div className="text-muted" style={{ fontSize: 13 }}>{r.for}</div>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.55, display: "flex", flexDirection: "column", gap: 3 }}>
                {r.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </div>
          ))}
        </div>
      );
    case "faq":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
          {b.items.map((f) => (
            <details key={f.q} className="card elev-sm" style={{ padding: "10px 14px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>{f.q}</summary>
              <p className="text-muted" style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6 }}>{f.a}</p>
            </details>
          ))}
        </div>
      );
  }
}

export default async function GuideStepsPage() {
  await requireScreen("guide-steps");

  return (
    <div style={{ maxWidth: 980 }}>
      <PageHeader
        kicker="Help"
        title="Step-by-step guide"
        subtitle="Everything an organizer or assistant does here, in the order you do it — set up the club, build the tournament, take entries, draw the field, score the day, settle the money and close it out. Controls appear as they do on screen."
        actions={
          <a className="btn btn-primary" href={PDF} download>
            <Icon name="ph ph-file-pdf" /> Download PDF
          </a>
        }
      />

      <nav aria-label="Parts of the guide" className="card elev-sm" style={{ padding: "12px 14px", gap: 6 }}>
        <div className="card-kicker" style={{ margin: 0 }}>Contents</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 13.5 }}>
          {GUIDE_STEPS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>{s.part} · {s.title}</a>
          ))}
        </div>
      </nav>

      {GUIDE_STEPS.map((s) => (
        <section
          key={s.id}
          id={s.id}
          aria-labelledby={`${s.id}-h`}
          style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 30, scrollMarginTop: 16 }}
        >
          <div>
            <div className="page-kicker">{s.part}</div>
            <h2 id={`${s.id}-h`} style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: "4px 0 0", textWrap: "balance" }}>
              {s.title}
            </h2>
          </div>
          {s.blocks.map((b, i) => <Block key={i} b={b} />)}
        </section>
      ))}
    </div>
  );
}
