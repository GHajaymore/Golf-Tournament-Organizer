"use client";
import { useState, useTransition } from "react";
import { saveOrganizationGolfTerms } from "@/app/actions/organization";
import { GOLF_TERMS_LABEL, golfRegister, golfTermsFor } from "@/lib/domain/golf-terms";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";

/**
 * WHICH GOLF THE APP SPEAKS TO THIS CLUB.
 *
 * The club's country picks it — UK golf in Britain, Ireland, Australia, New
 * Zealand, South Africa and the eurozone; US golf elsewhere — and this is
 * where the club overrules it (Ajay, 2026-09-27: "local by default and
 * overridden option for … US terminologies"). The same shape as the
 * community-noun picker beside it, for the same reasons.
 *
 * It shows the WORDS, resolved through the same table the app reads, so the
 * preview cannot drift from what the screens will say.
 */
export function GolfTermsPicker({
  terms,
  country,
}: {
  /** The stored override, or "" for "follow the country". */
  terms: string;
  /** Only to show what "follow the country" currently resolves to. */
  country: string;
}) {
  const [value, setValue] = useState(terms ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = (next: string) => {
    setValue(next);
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await saveOrganizationGolfTerms(next);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        setValue(terms ?? "");
        return;
      }
      setSaved(true);
    });
  };

  const followed = golfRegister(country, "");
  const words = golfTermsFor(golfRegister(country, value));

  return (
    <div className="field" style={{ maxWidth: 380 }}>
      <label htmlFor="golf-terms" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Which golf words the app uses
        <FieldInfo label="which golf words the app uses">
          <p>
            Golf says the same things two ways. The app picks one from the country on this page, and
            this is where you overrule it.
          </p>
          <p>
            It changes the words only. Format names — foursomes, four-ball, greensomes — are the
            Rules of Golf&rsquo;s and never change.
          </p>
        </FieldInfo>
      </label>

      <select
        id="golf-terms"
        className="input"
        value={value}
        disabled={pending}
        onChange={(e) => save(e.target.value)}
      >
        <option value="">
          {GOLF_TERMS_LABEL[""]} — {followed === "us" ? "US" : "UK"}
        </option>
        <option value="us">{GOLF_TERMS_LABEL.us}</option>
        <option value="uk">{GOLF_TERMS_LABEL.uk}</option>
      </select>

      <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.55 }}>
        Screens say <b style={{ color: "var(--color-text)" }}>{words.cart}</b>,{" "}
        <b style={{ color: "var(--color-text)" }}>your {words.group}</b> and{" "}
        <b style={{ color: "var(--color-text)" }}>{words.organizer}</b>.
      </p>

      {error && <p style={{ color: "var(--color-danger)", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
      {saved && !error && (
        <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
          <Icon name="check" /> Saved
        </p>
      )}
    </div>
  );
}
