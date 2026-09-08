"use client";
import { useRef, useState, useTransition } from "react";
import { addAnnouncement, toggleAnnouncementPin, removeAnnouncement } from "@/app/actions/tournament";
import { DraftAssistant } from "@/components/DraftAssistant";
import { postRefusal } from "@/lib/domain/announcement-post";
import { SaveState, useSaveStatus } from "./SaveState";
import { Icon } from "./Icon";

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
  const [refusal, setRefusal] = useState<string | null>(null);
  // Which post is one tap from being destroyed. Null when none is.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saveStatus = useSaveStatus(pending);
  const titleRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    // The reason, not silence. The button stays ENABLED so that pressing it
    // produces the explanation — a disabled button on a phone gives no
    // feedback at all, which is the fault this replaces rather than a fix
    // for it.
    const why = postRefusal(title, body);
    if (why) {
      setRefusal(why);
      titleRef.current?.focus();
      return;
    }
    setRefusal(null);
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
            ref={titleRef}
            className="input"
            placeholder="e.g. Round 2 tee times posted"
            value={title}
            aria-invalid={refusal ? true : undefined}
            aria-describedby={refusal ? "announcement-refusal" : undefined}
            onChange={(e) => {
              setTitle(e.target.value);
              // Clears as soon as they act on it, rather than sitting there
              // still accusing a field that now has a title in it.
              if (refusal) setRefusal(null);
            }}
          />
          {refusal && (
            <span
              id="announcement-refusal"
              role="alert"
              style={{ fontSize: 12.5, color: "var(--color-danger)", marginTop: 4 }}
            >
              {refusal}
            </span>
          )}
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SaveState status={saveStatus} label="Posted" />
            <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
              <Icon name="megaphone" /> Post
            </button>
          </div>
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
              {a.pinned && <span className="tag tag-accent"><Icon name="push-pin" /> Pinned</span>}
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
                <Icon name={a.pinned ? "ph-fill ph-push-pin" : "ph ph-push-pin"} />
              </button>
              {/* Two taps, not one.
                  Pin and Delete were two unlabelled 34px icons eight pixels
                  apart on a phone — one of them harmless, the other a hard
                  `deleteMany` with no undo and nothing to reconstruct the post
                  from. Missing Pin by a thumb's width destroyed the notice.
                  Same shape as the money ledger's Remove, and for the same
                  reason. */}
              {confirmDelete === a.id ? (
                <>
                  <button
                    type="button"
                    className="btn touch-target"
                    style={{ fontSize: 12, color: "var(--color-danger)" }}
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await removeAnnouncement(a.id);
                        setConfirmDelete(null);
                      })
                    }
                  >
                    <Icon name="trash" /> Delete it
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary touch-target"
                    style={{ fontSize: 12 }}
                    onClick={() => setConfirmDelete(null)}
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-icon"
                  title="Delete"
                  disabled={pending}
                  onClick={() => setConfirmDelete(a.id)}
                >
                  <Icon name="trash" />
                </button>
              )}
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
