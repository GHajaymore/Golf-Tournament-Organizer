"use client";
import { useState, useTransition } from "react";
import { draftMessage } from "@/app/actions/draft-message";
import { DRAFT_KIND_LABELS, DRAFT_KIND_TITLES, type DraftKind } from "@/lib/domain/draft-check";
import FieldInfo from "@/components/FieldInfo";
import { LockedFeature } from "@/components/LockedFeature";

/**
 * Draft an announcement from the event's own results.
 *
 * The shape of this panel is the safety argument, the same as the setup
 * assistant. A draft lands in the composer above, where the organizer edits it
 * and presses Post themselves. There is no button here that sends anything,
 * and the action behind it has no path to an email.
 *
 * Two things are shown that a slicker version would hide:
 *
 *  - the facts the draft was built from, so the text can be checked against
 *    them rather than trusted;
 *  - any name in the draft belonging to nobody in the field, prominently,
 *    because that is what a model invents when it wants a better story.
 *
 * Both make the feature look less magical. That is the intent — a club sending
 * this to two hundred members should be reading it, not admiring it.
 */
export function DraftAssistant({
  onUse,
  available = true,
}: {
  onUse: (text: string, title: string) => void;
  /** False when this club's plan doesn't include drafting. */
  available?: boolean;
}) {
  const [kind, setKind] = useState<DraftKind>("results");
  const [extra, setExtra] = useState("");
  const [draft, setDraft] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);
  const [facts, setFacts] = useState("");
  const [showFacts, setShowFacts] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      setError("");
      setDraft("");
      setUnknown([]);
      const res = await draftMessage(kind, extra);
      if (!res.ok || !res.draft) {
        setError(res.error ?? "Couldn't draft that.");
        return;
      }
      setDraft(res.draft);
      setUnknown(res.unknownNames ?? []);
      setFacts(res.facts ?? "");
    });

  if (!available) {
    return (
      <div className="card elev-sm" style={{ gap: 10, marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Draft it from the results</span>
        <LockedFeature feature="aiAssist" insteadOf="Write it yourself below and send as usual." />
      </div>
    );
  }

  return (
    <div className="card elev-sm" style={{ gap: 10, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Draft it from the results</span>
        <FieldInfo label="drafting a message">
          <p>
            Writes a first draft from this event&rsquo;s own standings — the same numbers on the
            leaderboard, nothing else.
          </p>
          <p>
            <b>It never sends anything.</b> The draft goes into the box above for you to edit, and
            you post it yourself.
          </p>
        </FieldInfo>
      </div>

      <div className="field">
        <label>What would you like drafted?</label>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>
          {(Object.keys(DRAFT_KIND_LABELS) as DraftKind[]).map((k) => (
            <option key={k} value={k}>{DRAFT_KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Anything to mention? (optional)</label>
        <input
          className="input"
          placeholder="e.g. round two moved to Sunday after the frost delay"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          maxLength={300}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={run}>
          {pending ? "Writing…" : "Write a draft"}
        </button>
        <span className="text-muted" style={{ fontSize: 11.5 }}>
          Drafts only — you edit it and post it yourself.
        </span>
      </div>

      {draft && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* The warning comes BEFORE the draft on purpose. Underneath it, an
              organizer has already read and half-approved the text. */}
          {unknown.length > 0 && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                <i className="ph ph-warning" /> Check these names before you post
              </span>
              <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.6 }}>
                {unknown.join(", ")} — {unknown.length === 1 ? "this doesn't match" : "these don't match"}{" "}
                anyone in this event. Either fix it, or delete that sentence.
              </p>
            </div>
          )}

          <textarea
            className="input"
            rows={9}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ resize: "vertical", fontSize: 13, lineHeight: 1.65 }}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn btn-primary" onClick={() => onUse(draft, DRAFT_KIND_TITLES[kind])}>
              <i className="ph ph-arrow-up" /> Put in the message box
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setDraft(""); setUnknown([]); }}>
              Discard
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowFacts((s) => !s)}
              aria-expanded={showFacts}
            >
              {showFacts ? "Hide" : "Show"} what it was given
            </button>
          </div>

          {showFacts && (
            <pre
              style={{
                margin: 0,
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--color-surface-2, rgba(127,127,127,0.08))",
                fontSize: 11.5,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                overflowX: "auto",
              }}
            >
              {facts}
            </pre>
          )}
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
