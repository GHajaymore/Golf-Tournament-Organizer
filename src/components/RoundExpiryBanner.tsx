"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { keepRound } from "@/app/actions/round-expiry";
import { Icon } from "./Icon";

/**
 * Telling somebody their round is temporary, while it still is.
 *
 * A casual round deletes itself about a day after it was set up, and the whole
 * justification for that being acceptable is that the person it belongs to is
 * told BEFORE it happens and can stop it in one press. Without this banner the
 * feature is a scheduled data loss that nobody consented to; with it, it is a
 * default with an exit.
 *
 * So this is not decoration and must not be made subtle. It renders only on a
 * round that actually carries an expiry — never on a tournament, which has
 * none — and it disappears the moment the round is kept.
 */
export function RoundExpiryBanner({
  notice,
  canKeep,
}: {
  /** Already-worded, from `expiryNotice`. Empty renders nothing. */
  notice: string;
  /**
   * Whether this viewer may keep it — staff of the round, which for a casual
   * round is whoever set it up.
   *
   * A player who cannot keep it is still TOLD. Hiding the warning from the
   * people whose scores are about to go is the wrong half to hide: the button
   * is the part they cannot use, the sentence is the part they need.
   */
  canKeep: boolean;
}) {
  const router = useRouter();
  const [kept, setKept] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!notice || kept) return null;

  const keep = () =>
    startTransition(async () => {
      setError("");
      const res = await keepRound();
      if (!res.ok) {
        setError(res.error ?? "Couldn't keep this round.");
        return;
      }
      // Hidden immediately AND refreshed. The refresh is what makes the
      // server agree; hiding it locally is what stops the banner sitting
      // there claiming the round is about to go after it has been saved.
      setKept(true);
      router.refresh();
    });

  return (
    <div
      className="card elev-sm"
      style={{
        marginBottom: 16,
        // `.card` is `display: flex; flex-direction: column`, so the row has to
        // be asked for. Three cards in this app came out as centred stacks
        // because an inline `display: flex` was assumed to undo that.
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        borderColor: "var(--color-warning, var(--color-divider))",
      }}
    >
      <Icon name="clock" style={{ flex: "none" }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>{notice}</div>
        {error && (
          <div style={{ fontSize: 12, marginTop: 4, color: "var(--color-danger)" }}>{error}</div>
        )}
      </div>
      {canKeep && (
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 44, flex: "none" }}
          disabled={pending}
          onClick={keep}
        >
          {pending ? "Keeping…" : "Keep this round"}
        </button>
      )}
    </div>
  );
}
