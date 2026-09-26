"use client";
import { useOrgProfile } from "@/components/OrgProfileProvider";
import { useState, useTransition } from "react";
import { saveOrganizationCurrency } from "@/app/actions/organization";
import { CURRENCIES, money, currencySymbol } from "@/lib/domain/money-format";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";

/**
 * What this club's money is written in.
 *
 * Beside the theme, because it is the same kind of setting: one decision
 * belonging to the club, read by every screen that shows an amount.
 *
 * It shows a WORKED EXAMPLE rather than only a symbol, because the symbol is
 * the half that goes right on its own. Amounts are stored in minor units and
 * not every currency has two of them — 100 stored is $1.00 and also ¥100 — so
 * the example is the only part of this control that would reveal a mistake
 * before a club published a prize list.
 */
export function CurrencyPicker({ currency }: { currency: string }) {
  // A society is not a club, and this screen says so. See OrgProfileProvider.
  const org = useOrgProfile();
  const [value, setValue] = useState(currency || "USD");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = (next: string) => {
    setValue(next);
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await saveOrganizationCurrency(next);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        setValue(currency || "USD");
        return;
      }
      setSaved(true);
    });
  };

  // Whatever is stored, even a code the list no longer offers, so the control
  // never silently shows a different currency from the one in force.
  const offered = CURRENCIES.some((c) => c.code === value)
    ? CURRENCIES
    : [...CURRENCIES, { code: value, label: value }];

  return (
    <div className="field" style={{ maxWidth: 340 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Currency
        {/* The outfit's own word, not "club". `FieldInfo` renders this into
            `aria-label="More about …"`, so a hardcoded one told a society's
            screen-reader user about "the club's currency" — on a control whose
            very next line already had the right word in scope. */}
        <FieldInfo label={`the ${org.noun}'s currency`}>
          <p>
            What every amount in this {org.noun} is written in — prizes, pots, buy-ins and the
            settle-up.
            It is the {org.noun}&rsquo;s default, and almost every tournament should just use it.
            {/* This read "one setting for the club rather than one per
                tournament", which stopped being true the day a tournament
                could override it. A control that describes a rule the app no
                longer follows is worse than one that says nothing. */}
          </p>
          <p>
            A single tournament can be priced in something else, on Tournament details — for an
            invitational whose visiting field is paying in their own money.
          </p>
          <p>
            It is the currency ITSELF, not just the symbol. Amounts are held in the smallest unit,
            and currencies differ in how many of those there are — a hundred is one dollar, and a
            hundred is also a hundred yen.
          </p>
        </FieldInfo>
      </label>

      <select
        className="input"
        aria-label="Currency"
        value={value}
        disabled={pending}
        onChange={(e) => save(e.target.value)}
      >
        {offered.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label} ({currencySymbol(c.code)})
          </option>
        ))}
      </select>

      <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.55 }}>
        {/* 123456 minor units: reads 1,234.56 where there are two of them and
            123,456 where there are none, which is the whole point. */}
        Amounts appear as <b>{money(123456, value)}</b>.
      </p>

      {error && (
        <p style={{ fontSize: 12.5, margin: "6px 0 0", color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
      {saved && !error && (
        <p style={{ fontSize: 12.5, margin: "6px 0 0", color: "var(--color-accent-2-300)" }}>
          Saved.
        </p>
      )}
    </div>
  );
}
