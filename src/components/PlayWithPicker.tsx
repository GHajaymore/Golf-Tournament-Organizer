"use client";
import { useState } from "react";
import { setMyPlayWith } from "@/app/actions/pairing";
import { MAX_REQUESTS } from "@/lib/domain/pairing-requests";
import { Icon } from "./Icon";
import { MoreInfo } from "./MoreInfo";
import { useAction } from "./useAction";

/**
 * "Who would you like to play with?" — a player's own pairing request, on
 * Today, until the tee sheet puts them in a group. The committee sees it on
 * the Tee sheet screen and the draw keeps them together where it can; it is a
 * request, and the card says so, because a competitive draw may not honour it.
 */
export function PlayWithPicker({
  others,
  chosen,
}: {
  /** The rest of the confirmed field. */
  others: { id: string; name: string }[];
  /** Who they have already asked for. */
  chosen: string[];
}) {
  const [picked, setPicked] = useState<string[]>(chosen);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAction({ refresh: true });
  const nameOf = new Map(others.map((p) => [p.id, p.name]));
  const toggle = (id: string) => {
    setSaved(false);
    setPicked((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : ps.length < MAX_REQUESTS ? [...ps, id] : ps));
  };

  return (
    <section className="card elev-sm" style={{ marginTop: 12, gap: 8 }} aria-labelledby="play-with">
      <span id="play-with" style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="users-three" /> Who would you like to play with?
      </span>
      {chosen.length > 0 && (
        <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>
          You&apos;ve asked for {chosen.map((id) => nameOf.get(id) ?? "").filter(Boolean).join(", ")}.
        </p>
      )}
      <MoreInfo short={`A request, not a booking. Up to ${MAX_REQUESTS}.`}>
        The draw keeps you together where it can, but a request is not a booking.
      </MoreInfo>
      {!open ? (
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
            {chosen.length ? "Change" : "Ask to play with…"}
          </button>
        </div>
      ) : (
        <>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend className="text-muted" style={{ fontSize: 13, marginBottom: 6 }}>
              {picked.length} of {MAX_REQUESTS} chosen
            </legend>
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {others.map((p) => {
                const on = picked.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={on ? "btn btn-primary" : "btn btn-ghost"}
                    style={{ fontSize: 13, minHeight: 40, cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && picked.length >= MAX_REQUESTS}
                      onChange={() => toggle(p.id)}
                      style={{ marginRight: 6 }}
                    />
                    {p.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div style={{ display: "flex", flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() =>
                run(() => setMyPlayWith(picked), () => {
                  setSaved(true);
                  setOpen(false);
                })
              }
            >
              {pending ? "Sending…" : picked.length ? "Send request" : "Clear my request"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {saved && !open && (
        <p role="status" className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Sent to the committee.
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
