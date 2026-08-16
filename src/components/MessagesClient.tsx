"use client";
import { useState, useEffect, useRef, useTransition } from "react";
import {
  readThread,
  sendMessage,
  broadcastToScope,
  markThreadRead,
  startDirectThread,
} from "@/app/actions/messaging";
import type { ThreadListItem, ThreadView } from "@/lib/services/messaging";

/**
 * The messages screen.
 *
 * Two panes on a desktop, one at a time on a phone — the phone is where this
 * is actually read, standing on a tee, so the thread list collapses out of the
 * way the moment a conversation is open rather than shrinking beside it.
 *
 * Every colour comes from the theme tokens the club configured. Nothing here
 * hard-codes a hex; the themes test would fail if it did.
 */

function when(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const KIND_ICON: Record<string, string> = {
  club: "ph ph-buildings",
  event: "ph ph-trophy",
  staff: "ph ph-lock-simple",
  flight: "ph ph-squares-four",
  round: "ph ph-flag",
  team: "ph ph-users-three",
  foursome: "ph ph-users-four",
  match: "ph ph-sword",
  direct: "ph ph-chat-circle",
};

export function MessagesClient({
  threads,
  composable,
  people,
  isStaff,
}: {
  threads: ThreadListItem[];
  composable: { key: string; label: string; kind: string }[];
  /** Everyone in the field, for starting a direct conversation. */
  people: { name: string; email: string }[];
  isStaff: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<ThreadView | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  // Load a thread when it is opened, and mark it read — opening IS reading,
  // so the badge should clear without a second action.
  useEffect(() => {
    if (!openId) {
      setView(null);
      return;
    }
    let live = true;
    readThread(openId).then((v) => {
      if (!live) return;
      setView(v);
      if (v) void markThreadRead(openId);
    });
    return () => {
      live = false;
    };
  }, [openId]);

  // A conversation is read from the bottom, like every other one.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [view]);

  const post = (scope: string) => {
    const body = draft;
    if (!body.trim()) return;
    setError("");
    start(async () => {
      // An organizer writing to a flight they are not in needs the broadcast
      // path; everyone else, and staff writing somewhere they ARE in, uses the
      // ordinary one. Trying the ordinary one first keeps the common case on
      // the narrower endpoint.
      let res = await sendMessage(scope, body);
      if (!res.ok && isStaff) res = await broadcastToScope(scope, body);
      if (!res.ok) {
        setError(res.error ?? "Couldn't send that.");
        return;
      }
      setDraft("");
      if (res.threadId) {
        setOpenId(res.threadId);
        const fresh = await readThread(res.threadId);
        setView(fresh);
      }
    });
  };

  if (openId && view) {
    return (
      <div className="card elev-sm" style={{ gap: 0, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderBottom: "1px solid var(--color-divider)",
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "4px 10px" }}
            onClick={() => setOpenId(null)}
          >
            <i className="ph ph-arrow-left" /> Back
          </button>
          <i className={KIND_ICON[view.kind] ?? "ph ph-chat-circle"} style={{ color: "var(--color-accent)" }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>{view.title}</div>
            <div className="text-muted" style={{ fontSize: 11.5 }}>{view.label}</div>
          </div>
        </div>

        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, maxHeight: 520, overflowY: "auto" }}>
          {view.messages.length === 0 && (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Nothing here yet. Say something.
            </p>
          )}
          {view.messages.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.mine ? "flex-end" : "flex-start",
                maxWidth: "78%",
                background: m.mine ? "var(--color-accent)" : "var(--color-surface-2)",
                color: m.mine ? "var(--color-on-accent)" : "var(--color-text)",
                borderRadius: 12,
                padding: "8px 11px",
              }}
            >
              {!m.mine && (
                <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75, marginBottom: 2 }}>
                  {m.authorName || m.authorEmail}
                </div>
              )}
              <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.body}</div>
              <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 3, textAlign: "right" }}>
                {when(m.createdAt)}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {view.canPost ? (
          <div style={{ borderTop: "1px solid var(--color-divider)", padding: 10, display: "flex", gap: 8 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter is a new line — what every other
                // messaging app on the phone in their pocket does.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  post(view.scopeKey);
                }
              }}
              rows={1}
              placeholder="Message…"
              style={{
                flex: 1,
                resize: "none",
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-divider)",
                borderRadius: 9,
                color: "var(--color-text)",
                padding: "8px 10px",
                fontSize: 13.5,
                fontFamily: "inherit",
              }}
            />
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => post(view.scopeKey)}>
              {pending ? "…" : "Send"}
            </button>
          </div>
        ) : (
          <div style={{ borderTop: "1px solid var(--color-divider)", padding: "10px 14px" }}>
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              This one is announcements only — your organizer posts here.
            </p>
          </div>
        )}
        {error && (
          <p style={{ color: "var(--color-danger)", fontSize: 12, margin: 0, padding: "0 14px 10px" }}>{error}</p>
        )}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={() => setComposing((v) => !v)}>
          <i className="ph ph-plus" /> New message
        </button>
      </div>

      {composing && (
        <ComposePanel
          composable={composable}
          people={people}
          onOpen={(id) => {
            setComposing(false);
            setOpenId(id);
          }}
        />
      )}

      <div className="card elev-sm" style={{ gap: 0, padding: 0, overflow: "hidden" }}>
        {threads.length === 0 && (
          <p className="text-muted" style={{ fontSize: 13, margin: 0, padding: 16 }}>
            No conversations yet. Start one with your group, your flight, or anyone in the field.
          </p>
        )}
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpenId(t.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              textAlign: "left",
              padding: "12px 14px",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--color-divider)",
              cursor: "pointer",
              color: "var(--color-text)",
            }}
          >
            <i
              className={KIND_ICON[t.kind] ?? "ph ph-chat-circle"}
              style={{ fontSize: 20, color: "var(--color-accent)", width: 22, flex: "none" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: t.unread > 0 ? 700 : 500 }}>{t.title}</span>
                <span className="text-muted" style={{ fontSize: 11 }}>{t.label}</span>
              </div>
              <div className="text-muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.preview || "No messages yet"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
              <span className="text-muted" style={{ fontSize: 11 }}>{when(t.lastMessageAt)}</span>
              {t.unread > 0 && (
                <span
                  style={{
                    background: "var(--color-accent)",
                    color: "var(--color-on-accent)",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "1px 7px",
                  }}
                >
                  {t.unread}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/** Pick who to write to: a level, or a person. */
function ComposePanel({
  composable,
  people,
  onOpen,
}: {
  composable: { key: string; label: string; kind: string }[];
  people: { name: string; email: string }[];
  onOpen: (threadId: string) => void;
}) {
  const [body, setBody] = useState("");
  const [target, setTarget] = useState(composable[0]?.key ?? "");
  const [person, setPerson] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const send = () => {
    if (!body.trim()) {
      setError("Type a message first.");
      return;
    }
    setError("");
    start(async () => {
      // A named person means a direct conversation; otherwise it is a level.
      // Opening a direct thread carries the first message with it, because the
      // membership that makes the thread visible does not exist until it has
      // been created.
      const res = person
        ? await startDirectThread([person], body)
        : await (async () => {
            const r = await sendMessage(target, body);
            return r.ok ? r : broadcastToScope(target, body);
          })();
      if (!res.ok) {
        setError(res.error ?? "Couldn't send that.");
        return;
      }
      setBody("");
      if (res.threadId) onOpen(res.threadId);
    });
  };

  return (
    <div className="card elev-sm" style={{ gap: 10, marginBottom: 12 }}>
      <span className="card-kicker">Who is this for?</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select
          value={person ? "" : target}
          onChange={(e) => {
            setTarget(e.target.value);
            setPerson("");
          }}
          style={{
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-divider)",
            borderRadius: 8,
            color: "var(--color-text)",
            padding: "7px 9px",
            fontSize: 13,
          }}
        >
          {composable.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          style={{
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-divider)",
            borderRadius: 8,
            color: "var(--color-text)",
            padding: "7px 9px",
            fontSize: 13,
          }}
        >
          <option value="">…or one person</option>
          {people.map((p) => (
            <option key={p.email} value={p.email}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Message…"
        style={{
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-divider)",
          borderRadius: 9,
          color: "var(--color-text)",
          padding: "9px 10px",
          fontSize: 13.5,
          fontFamily: "inherit",
          resize: "vertical",
        }}
      />
      {error && <p style={{ color: "var(--color-danger)", fontSize: 12, margin: 0 }}>{error}</p>}
      <div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={send}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
