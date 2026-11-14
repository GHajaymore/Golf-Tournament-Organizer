"use client";
import { useEffect, useState, useTransition } from "react";
import { Icon } from "./Icon";
import { PLAYER_LINK_WORDS, normaliseLinkCode } from "@/lib/domain/player-link";
import { openPlayerLink } from "@/app/actions/player-link";

/**
 * /p — WHERE A GUEST'S PLAYER LINK OPENS (J39/J40 PR 1; the review's S1).
 *
 * The code arrives in the address's FRAGMENT (`/p#K7QM2XRA9DTP`), which no
 * server is ever sent. On mounting, this page reads it and strips it from the
 * address at once (`history.replaceState`), and then WAITS FOR A TAP: "Open my
 * card". A page load opens nothing — iMessage builds its link preview in a
 * WebKit view that runs scripts, and mail scanners open links in headless
 * browsers; each would otherwise count as "opened on another phone" and, by
 * three, prompt the organizer to kill the guest's link (D3 through D6). Only
 * the tap posts the code (`openPlayerLink`), and only the tap records a browser.
 *
 * The typed box needs a press too. Its input has no `name`, so a press made
 * before the page's script arrives posts nothing — never `?code=…` in an
 * address a server would log — and the buttons wait for the script anyway.
 */
export function PlayerLinkOpener({ ended }: { ended: boolean }) {
  const W = PLAYER_LINK_WORDS;
  const [fromLink, setFromLink] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState(ended ? W.dead : "");
  const [ready, setReady] = useState(false);
  const [pending, start] = useTransition();

  // S1: read and strip the fragment. Never opens anything from here.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.length > 1) {
      setFromLink(normaliseLinkCode(hash));
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setReady(true);
  }, []);

  const press = (code: string) =>
    start(async () => {
      setError("");
      const r = await openPlayerLink(code);
      if (r.ok) window.location.assign("/me");
      else setError(r.error);
    });

  return (
    <main style={{ maxWidth: 460, margin: "0 auto", padding: "40px 16px 60px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 26, lineHeight: 1.25, margin: 0, fontFamily: "var(--font-heading)" }}>{W.openHeading}</h1>
        <p className="text-muted" style={{ fontSize: 15, lineHeight: 1.55, margin: "8px 0 0" }}>{W.openLead}</p>
      </div>
      <noscript>
        <p style={{ fontSize: 14, margin: 0 }}>{W.noScript}</p>
      </noscript>

      {error && (
        <p role="alert" style={{ fontSize: 14, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      {fromLink && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ minHeight: 52, fontSize: 17 }}
          disabled={!ready || pending}
          onClick={() => press(fromLink)}
        >
          {W.openButton} <Icon name="arrow-right" />
        </button>
      )}

      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          const code = normaliseLinkCode(typed);
          if (!code) {
            setError(W.notACode);
            return;
          }
          press(code);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        <label htmlFor="player-link-code" style={{ fontSize: 14, fontWeight: 600 }}>
          {W.typeLabel}
        </label>
        <input
          id="player-link-code"
          className="input"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="K7QM-2XRA-9DTP"
          maxLength={20}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          style={{ fontSize: 18, letterSpacing: "0.06em", minHeight: 48 }}
        />
        <button type="submit" className="btn btn-secondary btn-block" style={{ minHeight: 48 }} disabled={!ready || pending}>
          {W.typeButton}
        </button>
      </form>
    </main>
  );
}
