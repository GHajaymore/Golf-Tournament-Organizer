"use client";
import { useState, useTransition } from "react";
import { setContestSponsor } from "@/app/actions/contests";
import { Icon } from "./Icon";
import { SPONSOR_NAME_MAX } from "@/lib/domain/contest-board";

/**
 * WHO SPONSORS THIS CONTEST (2026-10-17) — on a closest to the pin or a long
 * drive, the two the public board announces. Closed until wanted, so a contest
 * with no sponsor reads exactly as it did. Saved by a press, and a refusal is
 * said here, beside the press, not at the top of the screen.
 */
export function ContestSponsor({ contestId, name, url }: { contestId: string; name: string; url: string }) {
  const [open, setOpen] = useState(false);
  const [sponsor, setSponsor] = useState(name);
  const [site, setSite] = useState(url);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const save = (nextName: string, nextSite: string) =>
    startTransition(async () => {
      setError("");
      const res = await setContestSponsor(contestId, nextName, nextSite);
      if (!res.ok) setError(res.error ?? "Couldn't save the sponsor.");
      else setOpen(false);
    });

  if (!open) {
    return (
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {name && (
          <span style={{ fontSize: 13 }}>
            Sponsored by <b>{name}</b>
          </span>
        )}
        <button type="button" className="btn btn-secondary touch-target" style={{ fontSize: 13 }} onClick={() => setOpen(true)}>
          <Icon name="handshake" /> {name ? "Change sponsor" : "Add a sponsor"}
        </button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="field">
        <label htmlFor={`sponsor-${contestId}`}>Sponsored by</label>
        <input
          id={`sponsor-${contestId}`}
          className="input"
          value={sponsor}
          maxLength={SPONSOR_NAME_MAX}
          placeholder="Smith Motors"
          onChange={(e) => setSponsor(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`sponsor-site-${contestId}`}>Sponsor&apos;s website (optional)</label>
        <input
          id={`sponsor-site-${contestId}`}
          className="input"
          value={site}
          inputMode="url"
          placeholder="https://example.com"
          onChange={(e) => setSite(e.target.value)}
        />
      </div>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Shown beside this contest on the public leaderboard, and thanked at the foot of it.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary touch-target" disabled={pending} onClick={() => save(sponsor, site)}>
          Save sponsor
        </button>
        {name && (
          <button type="button" className="btn btn-secondary touch-target" disabled={pending} onClick={() => save("", "")}>
            Remove sponsor
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary touch-target"
          disabled={pending}
          onClick={() => {
            setSponsor(name);
            setSite(url);
            setError("");
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
