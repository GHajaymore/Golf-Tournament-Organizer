"use client";
import { useOrgProfile } from "@/components/OrgProfileProvider";
import { useState, useTransition } from "react";
import { saveOrganizationLocale } from "@/app/actions/organization";
import { LOCALES, formatDay, formatDayRange, DEFAULT_LOCALE } from "@/lib/domain/locale";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";

/**
 * How this club writes a date.
 *
 * Beside the currency, because it is the same kind of setting and, as it turns
 * out, half of the same one: the club's currency was already honoured and the
 * CONVENTIONS it was written in were American, so a club set to euros still
 * read "€1,234.00" where its members write "1.234,00 €".
 *
 * IT SHOWS A WORKED EXAMPLE, for the same reason the currency control does.
 * "en-GB" tells a golf secretary nothing; "16 May 2026" tells them everything,
 * and it is the only part of this control that would reveal a wrong choice
 * before a club sent its members a date they read as the wrong day. A date
 * that crosses the month is used deliberately — 14–16 May is where the
 * conventions actually diverge.
 */
export function LocalePicker({ locale }: { locale: string }) {
  // A society is not a club, and this screen says so. See OrgProfileProvider.
  const org = useOrgProfile();
  const [value, setValue] = useState(locale || DEFAULT_LOCALE);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = (next: string) => {
    setValue(next);
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await saveOrganizationLocale(next);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        setValue(locale || DEFAULT_LOCALE);
        return;
      }
      setSaved(true);
    });
  };

  // Whatever is stored, even a tag the list no longer offers, so the control
  // never silently shows a different region from the one in force.
  const offered = LOCALES.some((l) => l.tag === value)
    ? LOCALES
    : [...LOCALES, { tag: value, label: value }];

  return (
    <div className="field" style={{ maxWidth: 340 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Dates and numbers
        {/* Same fault as CurrencyPicker had: this becomes an `aria-label`, and
            the sentence one line below already uses the outfit's own word. */}
        <FieldInfo label={`how the ${org.noun} writes a date`}>
          <p>
            How every date and amount in this {org.noun} is written — the order of the day and
            month, and where the thousands separator and the currency symbol go.
          </p>
          <p>
            It does not translate the app. The words stay in English; what changes is the way a
            date and a number are set out, which is what a member notices first.
          </p>
          <p>
            A single tournament can be set to write its own way, on Tournament details — for an
            invitational run to conventions the visiting field expects rather than the ones this{" "}
            {org.noun} writes its letters in.
          </p>
        </FieldInfo>
      </label>

      <select
        className="input"
        aria-label="Dates and numbers"
        value={value}
        disabled={pending}
        onChange={(e) => save(e.target.value)}
      >
        {offered.map((l) => (
          <option key={l.tag} value={l.tag}>
            {l.label}
          </option>
        ))}
      </select>

      <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.55 }}>
        A tournament on 14–16 May reads{" "}
        <b style={{ color: "var(--color-text)" }}>{formatDayRange("2026-05-14", "2026-05-16", value)}</b>
        , and entries closing on the 7th read{" "}
        <b style={{ color: "var(--color-text)" }}>{formatDay("2026-05-07", value)}</b>.
      </p>

      {error && (
        <p style={{ color: "var(--color-danger)", fontSize: 12, margin: "6px 0 0" }}>{error}</p>
      )}
      {saved && !error && (
        <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
          <Icon name="check" /> Saved
        </p>
      )}
    </div>
  );
}
