"use client";
import { useState, useTransition } from "react";
import { postCommentary, deleteCommentary, suggestCommentary } from "@/app/actions/commentary";

export interface CommentaryItem {
  id: string;
  author: string;
  text: string;
  source: string;
  when: string;
}

export function CommentaryPanel({ items, canPost }: { items: CommentaryItem[]; canPost: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const draftAi = async () => {
    setBusy(true);
    const res = await suggestCommentary();
    setBusy(false);
    if (res.text) setText(res.text);
  };

  return (
    <div className="card elev-sm">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="card-title" style={{ fontSize: 15 }}>
          <i className="ph ph-megaphone" style={{ marginRight: 6, color: "var(--color-accent)" }} />
          Commentary
        </span>
      </div>

      {canPost && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <textarea
            className="input"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Post an update, milestone or highlight…"
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={draftAi}>
              <i className="ph ph-sparkle" /> {busy ? "Drafting…" : "AI draft"}
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || !text.trim()}
              onClick={() => {
                startTransition(() => postCommentary(text));
                setText("");
              }}
            >
              <i className="ph ph-paper-plane-tilt" /> Post
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
        {items.length === 0 && (
          <span className="text-muted" style={{ fontSize: 13 }}>No commentary yet.</span>
        )}
        {items.map((c) => (
          <div key={c.id} style={{ display: "flex", gap: 10, fontSize: 13, padding: "8px 0", borderBottom: "1px solid var(--color-divider)" }}>
            <div style={{ flex: 1 }}>
              <div>{c.text}</div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                {c.source === "ai" && <span className="tag tag-accent" style={{ fontSize: 9, padding: "1px 6px" }}>AI</span>}
                {c.author} · {c.when}
              </div>
            </div>
            {canPost && (
              <button type="button" className="btn btn-icon" disabled={pending} onClick={() => startTransition(() => deleteCommentary(c.id))} style={{ width: 26, height: 26 }}>
                <i className="ph ph-x" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
