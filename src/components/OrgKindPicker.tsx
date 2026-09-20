"use client";
import { useState, useTransition } from "react";
import { saveOrganizationKind } from "@/app/actions/organization";
import { ORG_KINDS, orgProfile } from "@/lib/domain/org-profile";
import { Icon } from "./Icon";

/**
 * WHAT THIS OUTFIT IS — the setting that had no control.
 *
 * `Organization.kind` was set when the organization came into being and could
 * never be changed afterwards. That is fine for somebody who answered the
 * sign-up question; it is not fine for the many tenants created lazily, which
 * default to `personal`. Measured in the development database on 2026-09-17:
 * three of six organizations were `personal`, two of them belonging to
 * somebody running a club.
 *
 * AND IT IS NOT ONLY THE WORD ON THE SCREEN — but it is less than it looks,
 * which is worth writing down because the first version of this comment said
 * otherwise and was wrong. Measured on 2026-09-17:
 *
 *   sharedRoster  whether SETUP ASKS for a members list, and how three screens
 *                 word it. The Members screen itself is there for every kind.
 *   ledger        the club's DEFAULT MONEY MODE — `money-mode.ts` reads it to
 *                 choose between split and none. A real behavioural change.
 *   ownsCourse    whether setup asks for a home course.
 *
 * So the honest summary is: the words everywhere, what setup asks for, and
 * what money defaults to.
 *
 * Each option says what it TURNS ON rather than describing a category, because
 * that is the part a person can act on: "a shared members list" is a reason to
 * pick one; "a golf club" is a label.
 */
export function OrgKindPicker({ kind, country, noun }: { kind: string; country: string; noun: string }) {
  const [value, setValue] = useState(kind);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  /** The roster this would hide, when the answer was "ask me first". */
  const [confirmCount, setConfirmCount] = useState(0);

  const save = (next: string, confirmed = false) => {
    setError("");
    startTransition(async () => {
      const res = await saveOrganizationKind(next, confirmed);
      if (res.ok) {
        setValue(next);
        setConfirmCount(0);
        return;
      }
      setError(res.error ?? "That could not be saved.");
      // A number rather than a flag: the button then says how many people it
      // is about, which is the fact that makes the decision.
      setConfirmCount(res.hidesRoster ?? 0);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {ORG_KINDS.map((k) => {
          // The profile for THAT option, resolved whole — a community is a
          // society in Cheshire and a league in Ohio, and the picker has to
          // offer the word this outfit would actually get.
          const p = orgProfile(k, country, noun);
          const chosen = value === k;
          return (
            <label
              key={k}
              className="card"
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 10px",
                cursor: pending ? "default" : "pointer",
                boxShadow: chosen ? "inset 0 0 0 1px var(--color-accent)" : "inset 0 0 0 1px var(--color-divider)",
              }}
            >
              <input
                type="radio"
                name="orgkind"
                checked={chosen}
                disabled={pending}
                onChange={() => save(k)}
                style={{ marginTop: 3 }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: chosen ? "var(--color-accent-300)" : undefined }}>
                  {p.label}
                </span>
                <span className="text-muted" style={{ display: "block", fontSize: 12 }}>
                  {p.blurb}
                </span>
                {/* WHAT ACTUALLY DIFFERS, read off the profile rather than
                    written out — so it cannot drift from what the kind does.

                    Measured before it was written, because the first draft of
                    this line said "No shared members list", which is not true:
                    the Members screen is there for every kind. `sharedRoster`
                    decides whether SETUP ASKS for one and how three screens
                    word it. `ledger` decides the club's default money mode,
                    and `ownsCourse` whether setup asks for a home course.
                    A fourth flag, `seasonPlay`, was offered here in a first
                    draft and turned out to be read nowhere in the app; it was
                    deleted on 2026-09-20 rather than advertised. */}
                <span className="text-muted" style={{ display: "block", fontSize: 12 }}>
                  {p.sharedRoster ? "Setup asks for a members list" : "Just your own list of players"}
                  {p.ownsCourse ? " · asks for your home course" : ""}
                  {p.ledger ? " · money splits between players by default" : " · money left to the shop by default"}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {error && (
        <p style={{ fontSize: 12.5, margin: 0, color: confirmCount ? undefined : "var(--color-danger)" }}>
          <Icon name={confirmCount ? "warning" : "warning-circle"} /> {error}
        </p>
      )}

      {/* The way through the question, with the number in the words — the same
          shape as the same-name warning: asked, not refused. */}
      {confirmCount > 0 && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ alignSelf: "flex-start" }}
          disabled={pending}
          onClick={() => save("personal", true)}
        >
          Switch anyway and hide the list
        </button>
      )}
    </div>
  );
}
