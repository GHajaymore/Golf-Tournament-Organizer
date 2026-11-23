"use client";
import { useState } from "react";
import { rotatePublicToken } from "@/app/actions/tournament";
import { eventLinks } from "@/lib/domain/event-page";
import { Icon } from "../Icon";
import { useCopy } from "./use-copy";

/**
 * THE PUBLIC LEADERBOARD LINK and the two other ways in on the same token: lifted out of `PlaySettings`
 * (R3-1), no behaviour change. Home (R10) mounts it; the caller draws it only while the board is public.
 */
export function ShareLinks({ shareToken, canEdit }: { shareToken: string; canEdit: boolean }) {
  const { origin, copied, copy } = useCopy();
  const [rotateError, setRotateError] = useState("");
  const [rotating, setRotating] = useState(false);

  const shareUrl = origin ? `${origin}/live/${shareToken}` : "";
  const shareLinks = eventLinks(shareToken);
  // The real host is only known in the browser, so nothing is drawn until it is.
  if (!shareUrl) return null;

  return (
    <div
      // The tournament's own link, locked in an archive like the card it was lifted from (R3-1).
      data-this-tournament=""
      style={{
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Public leaderboard link</div>
        <code style={{ fontSize: 13, wordBreak: "break-all" }}>{shareUrl}</code>
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => copy(shareUrl, "share")}>
        <Icon name="copy" /> {copied === "share" ? "Copied" : "Copy"}
      </button>
      {/* P3 of the audit: this token was minted once at creation and nothing replaced it, so a link
          posted somewhere public could only be dealt with by turning the leaderboard off. Confirmed,
          because every copy of the old URL dies the moment it runs — including the one on the
          clubhouse noticeboard. */}
      {canEdit && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={rotating}
          title="Replace this link — the old one stops working"
          onClick={() => {
            if (
              !window.confirm(
                "Replace the leaderboard link?\n\nThe current link stops working immediately — anyone who has it, including on a noticeboard or in a group chat, will get a not-found page. You'll need to share the new one.",
              )
            ) {
              return;
            }
            setRotating(true);
            setRotateError("");
            // The answer was dropped: a refusal said nothing (2026-10-21).
            void rotatePublicToken("share")
              .then((res) => { if (!res.ok) setRotateError(res.error ?? "Couldn't replace the link."); })
              .catch(() => setRotateError("Couldn't replace the link."))
              .finally(() => setRotating(false));
          }}
        >
          <Icon name="arrows-clockwise" /> New link
        </button>
      )}
      {rotateError && (
        <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)", flexBasis: "100%" }}>
          {rotateError}
        </p>
      )}
      {/* THE TWO OTHER WAYS IN, ON THE SAME LINK (2026-10-24): the event page to send before and after
          the day, and the clubhouse screen for the TV in the bar. Both live under this token, so New
          link replaces all three at once, and both obey this setting. */}
      {[
        { key: "event", label: "Event page", href: shareLinks.event, what: "One link to send before and after the day: entries, the board, the report." },
        { key: "clubhouse", label: "Clubhouse screen", href: shareLinks.clubhouse, what: "The board for a TV: large type, a page at a time." },
      ].map((l) => (
        <div key={l.key} style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid var(--color-divider)" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{l.label}</div>
            <p className="text-muted" style={{ fontSize: 13, margin: "0 0 2px" }}>{l.what}</p>
            <code style={{ fontSize: 13, wordBreak: "break-all" }}>{origin + l.href}</code>
          </div>
          <a className="btn btn-secondary" href={l.href} target="_blank" rel="noopener">
            Open {l.label.toLowerCase()} <Icon name="arrow-right" />
          </a>
          <button type="button" className="btn btn-secondary" aria-label={`Copy the ${l.label.toLowerCase()} link`} onClick={() => copy(origin + l.href, l.key)}>
            <Icon name="copy" /> {copied === l.key ? "Copied" : "Copy"}
          </button>
        </div>
      ))}
    </div>
  );
}
