"use client";
import { useState, useEffect, useRef, useTransition } from "react";
import {
  readThread,
  sendMessage,
  broadcastToScope,
  markThreadRead,
  startDirectThread,
  setMyMessagesOptOut,
  setMySmsOptIn,
  previewSmsBroadcast,
  broadcastWithText,
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
  players: "ph ph-users-three",
  staff: "ph ph-lock-simple",
  flight: "ph ph-squares-four",
  round: "ph ph-flag",
  team: "ph ph-users-three",
  foursome: "ph ph-users-four",
  match: "ph ph-sword",
  direct: "ph ph-chat-circle",
};

/**
 * The one-time notice before somebody's first message.
 *
 * The standard disclosure, worded for what this actually is. Messages here go
 * over the internet, not the SMS network, so there is no per-message carrier
 * charge to warn about and claiming one would be false — what a player on a
 * course away from wifi is actually spending is mobile data. The sentence
 * about message rates is there because it becomes true the moment a club
 * switches on SMS or email delivery, and a disclosure people have already
 * dismissed cannot be shown to them again.
 *
 * Acknowledged in localStorage rather than on the server: it is a courtesy
 * notice about the reader's own phone bill, not consent that needs an audit
 * trail, and a new device showing it once more is the right failure.
 */
const RATES_ACK = "thq.messaging.rates.ack.v1";

function FirstUseNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="card elev-sm"
      style={{ gap: 8, marginBottom: 12, borderLeft: "3px solid var(--color-accent)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <i className="ph ph-info" style={{ color: "var(--color-accent)", fontSize: 18 }} />
        <span className="card-title" style={{ fontSize: 14.5 }}>Before you start</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65 }}>
        Messages are sent inside the app over your internet connection — there is no per-text charge
        from your phone company. If you are on mobile data rather than wifi, your{" "}
        <b>standard data charges apply</b>, the same as any other app.
      </p>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65 }}>
        If your club turns on text or email alerts for these messages, your carrier&rsquo;s message
        and data rates may apply to those.
      </p>
      <div>
        <button type="button" className="btn btn-primary" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}

export function MessagesClient({
  threads,
  composable,
  people,
  isStaff,
  optedOut = false,
  smsOptIn = false,
}: {
  threads: ThreadListItem[];
  composable: { key: string; label: string; kind: string }[];
  /** Everyone in the field, minus anyone who has turned direct messages off. */
  people: { name: string; email: string }[];
  isStaff: boolean;
  /** This reader has turned off direct messages from other players. */
  optedOut?: boolean;
  /** This reader has agreed to receive texts. */
  smsOptIn?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<ThreadView | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  // Null until we have looked, so the notice never flashes on for somebody who
  // dismissed it months ago — localStorage is not readable during the server
  // render, and a banner that appears and vanishes reads as a bug.
  const [seenRates, setSeenRates] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setSeenRates(window.localStorage.getItem(RATES_ACK) === "1");
    } catch {
      // Private mode or storage disabled. Treat as seen rather than showing an
      // undismissable banner on every visit.
      setSeenRates(true);
    }
  }, []);

  const [showPrefs, setShowPrefs] = useState(false);
  const [off, setOff] = useState(optedOut);
  const [sms, setSms] = useState(smsOptIn);

  const ackRates = () => {
    try {
      window.localStorage.setItem(RATES_ACK, "1");
    } catch {
      // Nothing to do — the acknowledgement just will not persist.
    }
    setSeenRates(true);
  };

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
            {/* The second line says what kind of audience this is — "Flight A"
                over "Your flight". For the broadcast scopes the thread has no
                name of its own and the two are the same string, which printed
                "Players only" twice. */}
            {view.label !== view.title && (
              <div className="text-muted" style={{ fontSize: 11.5 }}>{view.label}</div>
            )}
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
      {seenRates === false && <FirstUseNotice onDismiss={ackRates} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn btn-primary" onClick={() => setComposing((v) => !v)}>
          <i className="ph ph-plus" /> New message
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowPrefs((v) => !v)}
          aria-expanded={showPrefs}
        >
          <i className="ph ph-sliders-horizontal" /> Message settings
        </button>
      </div>

      {showPrefs && (
        <OptOutPanel optedOut={off} onChange={setOff} smsOptIn={sms} onSmsChange={setSms} />
      )}

      {composing && (
        <ComposePanel
          composable={composable}
          people={people}
          isStaff={isStaff}
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
                {/* Same as the open thread's header: the broadcast scopes have
                    no name of their own, so title and label are one string. */}
                {t.label !== t.title && (
                  <span className="text-muted" style={{ fontSize: 11 }}>{t.label}</span>
                )}
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

/**
 * Turning direct messages off.
 *
 * The scope of the switch is spelled out rather than left to be discovered,
 * because the thing people are actually worried about — missing their tee
 * time — is exactly what this does NOT do. An opt-out that silences the
 * organizer would be one nobody could safely use, so it stops other players
 * and leaves the tournament's own announcements alone.
 */
function OptOutPanel({
  optedOut,
  onChange,
  smsOptIn,
  onSmsChange,
}: {
  optedOut: boolean;
  onChange: (v: boolean) => void;
  smsOptIn: boolean;
  onSmsChange: (v: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const toggle = (next: boolean) => {
    setError("");
    start(async () => {
      const res = await setMyMessagesOptOut(next);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        return;
      }
      onChange(next);
    });
  };

  const toggleSms = (next: boolean) => {
    setError("");
    start(async () => {
      const res = await setMySmsOptIn(next);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        return;
      }
      onSmsChange(next);
    });
  };

  return (
    <div className="card elev-sm" style={{ gap: 10, marginBottom: 12 }}>
      <span className="card-kicker">Message settings</span>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={optedOut}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
        />
        <span>
          <span style={{ fontSize: 14, fontWeight: 500, display: "block" }}>
            Don&rsquo;t let other players message me directly
          </span>
          <span className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            You&rsquo;ll be taken out of the list people pick from, and nobody can start a private
            conversation with you.
          </span>
        </span>
      </label>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>
        <i className="ph ph-info" style={{ marginRight: 5 }} />
        Your organizer can still reach you. Tee times, delays and changes of venue go to the whole
        tournament or your flight, and this setting deliberately doesn&rsquo;t touch those — turning
        it on should never cost you your tee time.
      </p>

      {/* Separate switch, and off until it is ticked. Handing over a phone
          number so an organizer can ring you is not agreeing to bulk texts,
          and treating those as the same thing is what gets an SMS programme
          shut down. */}
      <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={smsOptIn}
            disabled={pending}
            onChange={(e) => toggleSms(e.target.checked)}
            style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
          />
          <span>
            <span style={{ fontSize: 14, fontWeight: 500, display: "block" }}>
              Also text me tournament announcements
            </span>
            <span className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              Only what your organizer sends to the whole tournament, your flight or your round —
              never chat from your group, and never a direct message. Standard message and data
              rates from your carrier apply. Reply STOP to any text to turn this off.
            </span>
          </span>
        </label>
      </div>
      {error && <p style={{ color: "var(--color-danger)", fontSize: 12, margin: 0 }}>{error}</p>}
    </div>
  );
}

/** Pick who to write to: a level, or a person. */
/** Scopes a text can go to at all — mirrors SMS_BROADCAST_SCOPES on the
 *  server, which is the authority. A chat scope never texts. */
const SMS_KINDS = ["club", "event", "players", "flight", "round", "team"];

function ComposePanel({
  composable,
  people,
  onOpen,
  isStaff,
}: {
  composable: { key: string; label: string; kind: string }[];
  people: { name: string; email: string }[];
  onOpen: (threadId: string) => void;
  isStaff: boolean;
}) {
  const [body, setBody] = useState("");
  const [target, setTarget] = useState(composable[0]?.key ?? "");
  const [person, setPerson] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const [alsoText, setAlsoText] = useState(false);
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof previewSmsBroadcast>>>(null);
  const kind = composable.find((c) => c.key === target)?.kind ?? "";
  const canText = isStaff && !person && SMS_KINDS.includes(kind);

  // The estimate, refreshed as they type. Debounced because it counts the
  // audience server-side, and an organizer typing a paragraph should not run
  // that on every keystroke.
  useEffect(() => {
    if (!alsoText || !canText || !body.trim()) {
      setPlan(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      previewSmsBroadcast(target, body).then((p) => {
        if (live) setPlan(p);
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [alsoText, canText, target, body]);

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
        : alsoText && canText
          ? await broadcastWithText(target, body)
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
      {canText && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={alsoText}
              onChange={(e) => setAlsoText(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
            />
            <span>
              <span style={{ fontSize: 13.5, fontWeight: 500, display: "block" }}>
                Also send this as a text
              </span>
              <span className="text-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                Goes only to people who have agreed to texts. Everyone gets it in the app either
                way.
              </span>
            </span>
          </label>

          {/* The estimate before the send, not the invoice after it. Segments
              rather than messages, because that is what is actually billed —
              one curly apostrophe can double it. */}
          {alsoText && plan && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--color-surface-2)",
                fontSize: 12.5,
                lineHeight: 1.7,
              }}
            >
              {!plan.configured ? (
                <span style={{ color: "var(--color-danger)" }}>{plan.problem}</span>
              ) : plan.recipients === 0 ? (
                <span>
                  Nobody has agreed to texts yet, so this will only go out in the app. Players turn
                  texts on under Message settings.
                </span>
              ) : (
                <>
                  <b>
                    {plan.recipients} {plan.recipients === 1 ? "person" : "people"} · {plan.segmentsEach}{" "}
                    {plan.segmentsEach === 1 ? "segment" : "segments"} each · {plan.totalSegments} billed
                    {plan.costLabel ? ` · ${plan.costLabel}` : ""}
                  </b>
                  {plan.truncated && (
                    <div style={{ color: "var(--color-danger)" }}>
                      Too long for a text — it will be shortened. The full message still appears in
                      the app.
                    </div>
                  )}
                  {plan.skipped.length > 0 && (
                    <div className="text-muted">
                      {plan.skipped.length} not texted (
                      {[...new Set(plan.skipped.map((s) => s.reason))].join(", ")}).
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: "var(--color-danger)", fontSize: 12, margin: 0 }}>{error}</p>}
      <div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={send}>
          {pending ? "Sending…" : alsoText && canText ? "Send + text" : "Send"}
        </button>
      </div>
    </div>
  );
}
