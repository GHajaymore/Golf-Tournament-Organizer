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

export function CommentaryPanel({
  items,
  canPost,
  aiAvailable = true,
}: {
  items: CommentaryItem[];
  canPost: boolean;
  /** False when this club's plan doesn't include drafting. */
  aiAvailable?: boolean;
}) {
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
            {/* Left in place and disabled rather than removed: a greyed
                button with a reason is how somebody learns the feature is
                there.

                The reason used to be in a `title`, and the comment here
                defended that — "hovering answers 'why can't I click this'
                without a second surface". Hovering does not happen on a phone,
                and the sentence was never announced. There was a second
                surface anyway, reading "On the paid plan"; it just said less
                than the tooltip did. One surface now, carrying the whole
                sentence including what to do meanwhile. */}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !aiAvailable}
              onClick={draftAi}
            >
              <i className={aiAvailable ? "ph ph-sparkle" : "ph ph-lock-simple"} />{" "}
              {busy ? "Drafting…" : "AjAi draft"}
            </button>
            {!aiAvailable && (
              <span className="text-muted" style={{ fontSize: 12, alignSelf: "center" }}>
                Drafting comes with the paid plan — write your own line for now.
              </span>
            )}
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
                {/* 10.5px, not 9. `.tag` is designed at 11 and this shrank it
                    to nine — small enough to be unreadable outdoors, on the one
                    label that tells a reader a machine wrote the line. */}
                {/* The stored value stays "ai" — this is the label a reader sees, not
                    the data. Renaming the column would be a migration for a word. */}
                {c.source === "ai" && <span className="tag tag-accent" style={{ fontSize: 10.5, padding: "1px 6px" }}>AjAi</span>}
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
