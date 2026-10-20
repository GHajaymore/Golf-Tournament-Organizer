"use client";
import { useState, useTransition } from "react";
import { registerInterest } from "@/app/actions/interest";
import { INTEREST_COPY, INTEREST_LIMITS, INTEREST_ROLES, INTEREST_SIZES } from "@/lib/domain/interest";

type Field = "name" | "email" | "phone" | "club" | "role" | "members" | "note";

/**
 * THE /interest FORM (2026-10-21), worded with the panel's marketing manager.
 * Every refusal is said beside the box it is about — the rule this app keeps
 * for every press. Who they are and how big, as radios: five answers are one
 * tap on a phone, where a dropdown is two and a scroll. The hidden "website"
 * box is for scripts; a person never sees it.
 */
export function InterestForm() {
  const [v, setV] = useState<Record<Field, string>>({ name: "", email: "", phone: "", club: "", role: "", members: "", note: "" });
  const [website, setWebsite] = useState("");
  const [refusal, setRefusal] = useState<{ error: string; field?: string } | null>(null);
  const [sent, setSent] = useState<{ name: string; email: string; role: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: Field) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  if (sent) {
    return (
      <div role="status" className="iv-sent">
        <p>{INTEREST_COPY.sent(sent.name, sent.email)}</p>
        {sent.role === "player" ? (
          <p>{INTEREST_COPY.sentPlayer}</p>
        ) : (
          <p>
            {INTEREST_COPY.share}{" "}
            <button
              type="button"
              className="iv-copy"
              onClick={() => {
                navigator.clipboard
                  ?.writeText("https://tourneyhq.club/interest")
                  .then(() => setCopied(true))
                  .catch(() => {});
              }}
            >
              {copied ? "Link copied" : "Copy the link"}
            </button>
          </p>
        )}
      </div>
    );
  }

  const said = (k: Field) =>
    refusal?.field === k ? (
      <span role="alert" className="iv-err">
        {refusal.error}
      </span>
    ) : null;
  const optional = <span className="iv-opt"> ({INTEREST_COPY.optional})</span>;

  return (
    <form
      className="iv-form"
      aria-label="Register your interest"
      onSubmit={(e) => {
        e.preventDefault();
        setRefusal(null);
        start(async () => {
          const res = await registerInterest({ ...v, website });
          if (res.ok) setSent({ name: v.name.trim(), email: v.email.trim().toLowerCase(), role: v.role });
          else setRefusal({ error: res.error ?? "That could not be sent — try again, or write to inquiries@tourneyhq.club.", field: res.field });
        });
      }}
    >
      <div className="iv-field">
        <label htmlFor="iv-name">{INTEREST_COPY.labels.name}</label>
        <input id="iv-name" autoComplete="name" maxLength={INTEREST_LIMITS.name} value={v.name} onChange={set("name")} />
        {said("name")}
      </div>
      <div className="iv-field">
        <label htmlFor="iv-email">{INTEREST_COPY.labels.email}</label>
        <input
          id="iv-email"
          type="email"
          autoComplete="email"
          placeholder={INTEREST_COPY.placeholders.email}
          maxLength={INTEREST_LIMITS.email}
          value={v.email}
          onChange={set("email")}
          aria-describedby="iv-email-hint"
        />
        <span id="iv-email-hint" className="iv-hint">{INTEREST_COPY.hints.email}</span>
        {said("email")}
      </div>
      <div className="iv-field">
        <label htmlFor="iv-phone">
          {INTEREST_COPY.labels.phone}
          {optional}
        </label>
        <input
          id="iv-phone"
          type="tel"
          autoComplete="tel"
          maxLength={INTEREST_LIMITS.phone}
          value={v.phone}
          onChange={set("phone")}
          aria-describedby="iv-phone-hint"
        />
        <span id="iv-phone-hint" className="iv-hint">{INTEREST_COPY.hints.phone}</span>
        {said("phone")}
      </div>
      <div className="iv-field">
        <label htmlFor="iv-club">{INTEREST_COPY.labels.club}</label>
        <input
          id="iv-club"
          autoComplete="organization"
          maxLength={INTEREST_LIMITS.club}
          value={v.club}
          onChange={set("club")}
          aria-describedby="iv-club-hint"
        />
        <span id="iv-club-hint" className="iv-hint">{INTEREST_COPY.hints.club}</span>
        {said("club")}
      </div>
      <fieldset className="iv-field iv-choices">
        <legend>{INTEREST_COPY.labels.role}</legend>
        {INTEREST_ROLES.map((r) => (
          <label key={r.key} className="iv-choice">
            <input type="radio" name="iv-role" value={r.key} checked={v.role === r.key} onChange={set("role")} /> {r.label}
          </label>
        ))}
        {said("role")}
      </fieldset>
      <fieldset className="iv-field iv-choices">
        <legend>
          {INTEREST_COPY.labels.members}
          {optional}
        </legend>
        {INTEREST_SIZES.map((s) => (
          <label key={s.key} className="iv-choice">
            <input type="radio" name="iv-members" value={s.key} checked={v.members === s.key} onChange={set("members")} /> {s.label}
          </label>
        ))}
      </fieldset>
      <div className="iv-field">
        <label htmlFor="iv-note">
          {INTEREST_COPY.labels.note}
          {optional}
        </label>
        <textarea
          id="iv-note"
          rows={3}
          placeholder={INTEREST_COPY.placeholders.note}
          maxLength={INTEREST_LIMITS.note}
          value={v.note}
          onChange={set("note")}
        />
      </div>
      {/* For scripts only: off screen, out of the tab order, hidden from a reader. */}
      <div aria-hidden="true" className="iv-hp">
        <label htmlFor="iv-website">Website</label>
        <input id="iv-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <div className="iv-send">
        <button type="submit" className="btn accent" disabled={pending}>
          {pending ? "Sending…" : INTEREST_COPY.submit}
        </button>
        {refusal && !refusal.field && (
          <span role="alert" className="iv-err">
            {refusal.error}
          </span>
        )}
      </div>
      <p className="iv-small">
        {INTEREST_COPY.reassure} <a href="/privacy">Privacy notice</a>
      </p>
    </form>
  );
}
