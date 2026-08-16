"use client";
import { useState, useTransition } from "react";
import { addAnnouncement, toggleAnnouncementPin, removeAnnouncement } from "@/app/actions/tournament";
import { DraftAssistant } from "@/components/DraftAssistant";

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  when: string;
}

export function AnnouncementsClient({
  items,
  aiAvailable = true,
}: {
  items: AnnouncementRow[];
  /** False when this club's plan doesn't include drafting. */
  aiAvailable?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!title.trim()) return;
    startTransition(async () => {
      await addAnnouncement(title, body, pinned);
      setTitle("");
      setBody("");
      setPinned(false);
    });
  };

  return (
    <>
      <div className="card elev-sm" style={{ marginBottom: 16, gap: 12 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Post an announcement</span>
        <div className="field">
          <label>Title</label>
          <input
            className="input"
            placeholder="e.g. Round 2 tee times posted"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Message (optional)</label>
          <textarea
            className="input"
            rows={3}
            placeholder="Details players should know…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin to the top of players&rsquo; dashboards
          </label>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
            <i className="ph ph-megaphone" /> Post
          </button>
        </div>
      </div>

      {/* Below the composer, not above it. Writing the announcement yourself
          stays the obvious path; drafting is the shortcut you reach for when
          you don't fancy writing it. */}
      <DraftAssistant
        available={aiAvailable}
        onUse={(text, suggested) => {
          setBody(text);
          // Only fills an empty title. An organizer who already typed one has
          // said what this post is about, and overwriting it would be the tool
          // deciding it knows better.
          if (!title.trim()) setTitle(suggested);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((a) => (
          <div key={a.id} className="card elev-sm" style={{ gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {a.pinned && <span className="tag tag-accent"><i className="ph ph-push-pin" /> Pinned</span>}
              <span style={{ fontWeight: 600, fontSize: 15 }}>{a.title}</span>
              <span className="text-muted" style={{ fontSize: 12 }}>· {a.when}</span>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-icon"
                title={a.pinned ? "Unpin" : "Pin"}
                disabled={pending}
                onClick={() => startTransition(() => toggleAnnouncementPin(a.id, !a.pinned))}
              >
                <i className={a.pinned ? "ph-fill ph-push-pin" : "ph ph-push-pin"} />
              </button>
              <button
                type="button"
                className="btn btn-icon"
                title="Delete"
                disabled={pending}
                onClick={() => startTransition(() => removeAnnouncement(a.id))}
              >
                <i className="ph ph-trash" />
              </button>
            </div>
            {a.body && <p className="text-muted" style={{ fontSize: 13, margin: 0, whiteSpace: "pre-wrap" }}>{a.body}</p>}
          </div>
        ))}
        {items.length === 0 && (
          <div className="card elev-sm">
            <span className="text-muted" style={{ fontSize: 13 }}>
              No announcements yet. Posts appear on every player&rsquo;s dashboard.
            </span>
          </div>
        )}
      </div>
    </>
  );
}
