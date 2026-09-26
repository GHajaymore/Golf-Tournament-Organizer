"use client";
import { useState, useTransition } from "react";
import { useOrgProfile } from "@/components/OrgProfileProvider";
import { setEventFormatting } from "@/app/actions/tournament";
import { LOCALES, formatDayRange, resolveLocale, resolveCurrency } from "@/lib/domain/locale";
import { CURRENCIES, money, currencySymbol, minorUnitDigits } from "@/lib/domain/money-format";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";

/**
 * ONE TOURNAMENT WRITING ITS DATES AND MONEY ITS OWN WAY.
 *
 * Almost every tournament should leave both of these alone: the club's answer
 * is where its members are, and an override is a second place for the same
 * fact to be wrong. So both default to "Follow the club", and the control says
 * what the club's answer currently is rather than making anybody go and look.
 *
 * WHAT IT IS FOR is the case a club genuinely has — an invitational run to the
 * conventions a visiting field expects rather than the ones the club writes
 * its letters in, or an event priced in the money its entrants are carrying.
 *
 * TWO CONTROLS, NOT A SWITCH. A single "run this in American" toggle would be
 * shorter and would not express the case that actually turns up: a club in
 * Osaka pricing an invitational in dollars while still writing its dates the
 * Japanese way. They are two questions and they get two answers.
 *
 * A WORKED EXAMPLE under each, for the same reason the club's own pickers have
 * one: "en-GB" and "SGD" tell a golf secretary nothing, and "14–16 May 2026"
 * and "S$1,234.00" tell them everything — before a field arrives having
 * misread a date.
 */
export function TournamentFormatting({
  localeOverride,
  currencyOverride,
  clubLocale,
  clubCurrency,
  canEdit,
}: {
  localeOverride: string;
  currencyOverride: string;
  /** What this tournament follows when it says nothing. Shown, not guessed at. */
  clubLocale: string;
  clubCurrency: string;
  canEdit: boolean;
}) {
  // A society is not a club, and this control says so. See OrgProfileProvider.
  const org = useOrgProfile();
  const [loc, setLoc] = useState(localeOverride);
  const [cur, setCur] = useState(currencyOverride);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = (nextLocale: string, nextCurrency: string) => {
    setLoc(nextLocale);
    setCur(nextCurrency);
    setError("");
    setSaved(false);
    start(async () => {
      const res = await setEventFormatting(nextLocale, nextCurrency);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        setLoc(localeOverride);
        setCur(currencyOverride);
        return;
      }
      setSaved(true);
    });
  };

  /**
   * What this tournament ACTUALLY reads as, resolved exactly the way the server
   * resolves it.
   *
   * Through `resolveLocale`/`resolveCurrency` rather than `loc || clubLocale`
   * written out here, so the preview cannot come to disagree with the screens
   * it is previewing — including on the part that is easy to forget, which is
   * that an unusable stored value falls through to the club rather than being
   * used.
   */
  const club = { locale: clubLocale, currency: clubCurrency };
  const event = { localeOverride: loc, currencyOverride: cur };
  const activeLocale = resolveLocale(club, event);
  const activeCurrency = resolveCurrency(club, event);

  const clubLocaleLabel =
    LOCALES.find((l) => l.tag === clubLocale)?.label.split(" — ")[0] ?? clubLocale;
  const clubCurrencyLabel =
    CURRENCIES.find((c) => c.code === clubCurrency)?.label ?? clubCurrency;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="field" style={{ maxWidth: 380 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Dates and numbers
          <FieldInfo label="this tournament's date conventions">
            <p>
              How this tournament&rsquo;s dates and numbers are written. Leave it following the{" "}
              {org.noun} unless this event is run for a field that reads them another way.
            </p>
            <p>
              It does not translate anything. The words stay in English; what changes is the order
              of the day and month, and where the separators go.
            </p>
          </FieldInfo>
        </label>
        <select
          className="input"
          aria-label="Dates and numbers for this tournament"
          value={loc}
          disabled={pending || !canEdit}
          onChange={(e) => save(e.target.value, cur)}
        >
          <option value="">Follow the {org.noun} — {clubLocaleLabel}</option>
          {LOCALES.map((l) => (
            <option key={l.tag} value={l.tag}>
              {l.label}
            </option>
          ))}
        </select>
        <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.55 }}>
          A tournament on 14–16 May reads{" "}
          <b style={{ color: "var(--color-text)" }}>
            {formatDayRange("2026-05-14", "2026-05-16", activeLocale)}
          </b>
          .
        </p>
      </div>

      <div className="field" style={{ maxWidth: 380 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Currency
          <FieldInfo label="this tournament's currency">
            <p>
              What this tournament&rsquo;s prizes, pots and buy-ins are priced in. Leave it{" "}
              following the {org.noun} unless this event takes money in something else.
            </p>
            <p>
              It is the currency itself, not just the symbol — amounts are held in the smallest
              unit and currencies differ in how many of those there are.
            </p>
            <p>
              <b>Nothing is converted.</b> Players pay and settle in whatever currency this
              tournament is set to; the app never applies an exchange rate. Changing this after
              amounts have been entered RE-LABELS them rather than converting them — a 1,234.00
              buy-in set here becomes a 1,234 buy-in in a currency with no minor unit. Set it
              before you take any money.
            </p>
          </FieldInfo>
        </label>
        <select
          className="input"
          aria-label="Currency for this tournament"
          value={cur}
          disabled={pending || !canEdit}
          onChange={(e) => save(loc, e.target.value)}
        >
          <option value="">Follow the {org.noun} — {clubCurrencyLabel}</option>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label} ({currencySymbol(c.code)})
            </option>
          ))}
        </select>
        <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.55 }}>
          {/* THE EXAMPLE HAS TO HOLD IN EVERY CURRENCY, which a fixed number
              of minor units does not. This passed 123400 — correct as
              "$1,234.00" and correct as "¥123,400", because yen has no minor
              unit — under a label reading "a prize of 1,234". The label was
              true for two-decimal currencies and wrong for the ones this
              control exists to support.

              Scaled by the currency's own minor units instead, so the sentence
              says what the example shows whatever is selected. */}
          A prize of 1,234 reads{" "}
          <b style={{ color: "var(--color-text)" }}>
            {money(1234 * 10 ** minorUnitDigits(activeCurrency), activeCurrency, activeLocale)}
          </b>
          .
        </p>
      </div>

      {error && <p style={{ color: "var(--color-danger)", fontSize: 12, margin: 0 }}>{error}</p>}
      {saved && !error && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          <Icon name="check" /> Saved
        </p>
      )}
    </div>
  );
}
