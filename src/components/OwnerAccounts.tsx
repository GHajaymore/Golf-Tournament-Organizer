"use client";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { sendEarlyListCodes, setAccountsOpen } from "@/app/actions/owner";
import { EARLY_LIST, LAUNCH_SURFACES, NOT_SWITCHED, OWNER_CARD, type LaunchState } from "@/lib/go-live";
import type { HoldRule } from "@/lib/sign-in-gate";

/** The early-list codes, as the card shows them — present only once live. */
export interface EarlyListView {
  owed: number;
  sent: number;
  limit: number;
  now: number;
  later: number;
  /** When the next press can send more, on the owner's clock, or "". */
  nextAt: string;
  /** The first person waiting, for the preview. */
  previewName: string;
}

/**
 * THE GO-LIVE SWITCH, on the owner console (Ajay, 2026-10-21: "make sure its an easy control which
 * we can flip back to allow signup / signin"; 2026-10-23: "I just need one switch to say let's go
 * live and that should change coming soon or any blockades to online").
 *
 * Before the press it says what the press will do — the list is `LAUNCH_SURFACES`, the same list
 * every held page is wired from and the browser sweep walks, never a copy written here — and the
 * press asks once more in a dialog that names the effect. After it: when it went live, and the one
 * press that holds it all again.
 *
 * `switchSays` is the SWITCH's own position (the row), and `rule` whether this deployment lets it
 * decide. They are shown apart, because on a preview or in dev nothing is held whatever the switch
 * says, and `SIGNINS=open` in Vercel opens it whatever the switch says — and the card says so rather
 * than hiding the switch, which is also what lets a browser test press it where the app is never held.
 *
 * ONCE LIVE, THE EARLY-LIST CODES: who is waiting, what they will get, and Send — his own press,
 * asked once more, never part of Go live. Absent while held (`earlyList` null).
 */
export function OwnerAccounts({
  switchSays,
  liveSince,
  rule,
  earlyList,
}: {
  switchSays: LaunchState;
  liveSince: string;
  rule: HoldRule;
  earlyList: EarlyListView | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState<"switch" | "codes" | null>(null);
  const [said, setSaid] = useState("");
  const [codesSaid, setCodesSaid] = useState("");
  const held = switchSays === "held";

  const flip = () =>
    start(async () => {
      const res = await setAccountsOpen(held);
      setAsking(null);
      setSaid(res.ok ? (res.now === "open" ? OWNER_CARD.wentLive : OWNER_CARD.heldAgain) : res.error ?? "That did not save.");
      router.refresh();
    });

  const send = () =>
    start(async () => {
      const res = await sendEarlyListCodes();
      setAsking(null);
      // `nextAt` comes back already in words, on the owner's clock (the server words every moment here).
      setCodesSaid(
        res.ok
          ? EARLY_LIST.done(res.sent ?? 0, res.later ?? 0, res.nextAt ?? "")
          : res.error && res.sent !== undefined
            ? EARLY_LIST.failed(res.sent, res.error)
            : res.error ?? "That did not send.",
      );
      router.refresh();
    });

  const dialog = (title: string, body: string, keep: string, confirm: string, onConfirm: () => void) =>
    createPortal(
      <div className="dialog-backdrop" onClick={() => !pending && setAsking(null)}>
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="golive-dialog-title" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-title" id="golive-dialog-title">
            {title}
          </div>
          <div className="dialog-body">{body}</div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setAsking(null)}>
              {keep}
            </button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={onConfirm}>
              {confirm}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }} id="accounts">
      <span className="card-title" style={{ fontSize: 15 }}>{OWNER_CARD.title}</span>
      <p style={{ fontSize: 14, margin: "6px 0 4px" }}>{held ? OWNER_CARD.held : OWNER_CARD.live(liveSince)}</p>
      {OWNER_CARD.rule[rule] && (
        <p className="text-muted" style={{ fontSize: 13, margin: "0 0 4px" }}>
          {OWNER_CARD.rule[rule]}
        </p>
      )}

      <p style={{ fontSize: 13.5, fontWeight: 600, margin: "10px 0 4px" }}>{held ? OWNER_CARD.willGoLive : OWNER_CARD.willHold}</p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
        {LAUNCH_SURFACES.map((s) => (
          <li key={s.id}>
            <span style={{ fontWeight: 500 }}>{s.where}</span>: {held ? s.live : s.held}
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          className={held ? "btn btn-primary" : "btn btn-secondary"}
          disabled={pending}
          onClick={() => setAsking("switch")}
        >
          <Icon name={held ? "lock-key-open" : "lock"} /> {held ? OWNER_CARD.goLive : OWNER_CARD.holdAgain}
        </button>
      </div>
      {said && (
        <p role="status" style={{ fontSize: 13, margin: "8px 0 0" }}>
          {said}
        </p>
      )}

      {earlyList && (
        <section id="early-list" aria-labelledby="early-list-title" style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--color-divider)" }}>
          <p id="early-list-title" style={{ fontSize: 13.5, fontWeight: 600, margin: "0 0 4px" }}>{EARLY_LIST.title}</p>
          <p style={{ fontSize: 13, margin: "0 0 4px" }}>{EARLY_LIST.waiting(earlyList.owed, earlyList.sent)}</p>
          {earlyList.owed > 0 && (
            <>
              <p className="text-muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
                {EARLY_LIST.allowance(earlyList.limit, earlyList.now, earlyList.later, earlyList.nextAt)} {EARLY_LIST.allowanceShared}
              </p>
              <p style={{ fontSize: 13, margin: "0 0 4px" }}>{EARLY_LIST.preview}</p>
              <div style={{ fontSize: 13, lineHeight: 1.55, padding: "8px 12px", borderLeft: "3px solid var(--color-divider)", margin: "0 0 8px" }}>
                <p className="text-muted" style={{ margin: "0 0 4px" }}>{EARLY_LIST.previewTo(earlyList.previewName)}</p>
                <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{EARLY_LIST.email.subject}</p>
                {EARLY_LIST.email.paragraphs(earlyList.previewName, EARLY_LIST.previewCode).map((p, i) => (
                  <p key={i} style={{ margin: "0 0 6px" }}>{p}</p>
                ))}
                <p className="text-muted" style={{ margin: 0 }}>[{EARLY_LIST.email.action}]</p>
              </div>
              <button type="button" className="btn btn-primary" disabled={pending || earlyList.now === 0} onClick={() => setAsking("codes")}>
                <Icon name="paper-plane-tilt" /> {EARLY_LIST.send(earlyList.now)}
              </button>
            </>
          )}
          {codesSaid && (
            <p role="status" style={{ fontSize: 13, margin: "8px 0 0" }}>
              {codesSaid}
            </p>
          )}
        </section>
      )}

      <details style={{ marginTop: 10, fontSize: 13 }}>
        <summary style={{ cursor: "pointer", minHeight: 32 }}>{OWNER_CARD.notSwitched}</summary>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
          {NOT_SWITCHED.map((n) => (
            <li key={n.id}>
              <span style={{ fontWeight: 500 }}>{n.what}</span> — {n.why}
            </li>
          ))}
        </ul>
      </details>

      {/* ASKED ONCE MORE, IN A DIALOG THAT SAYS WHAT HAPPENS — portalled to the page as the player
          app's sign-out is, so nothing in the console's layout can become its containing block. */}
      {asking === "switch" &&
        dialog(
          held ? OWNER_CARD.goLiveTitle : OWNER_CARD.holdTitle,
          held ? OWNER_CARD.goLiveNote(LAUNCH_SURFACES.length) : OWNER_CARD.holdNote,
          held ? OWNER_CARD.keepHeld : OWNER_CARD.keepLive,
          held ? OWNER_CARD.goLiveConfirm : OWNER_CARD.holdConfirm,
          flip,
        )}
      {asking === "codes" &&
        earlyList &&
        dialog(EARLY_LIST.confirmTitle, EARLY_LIST.confirmNote(earlyList.now, earlyList.later), EARLY_LIST.keep, EARLY_LIST.confirm, send)}
    </div>
  );
}
