"use client";
import { useState, useTransition } from "react";
import { saveOrganizationNoun } from "@/app/actions/organization";
import { COMMUNITY_VOICES, COMMUNITY_VOICE_KEYS, orgProfile } from "@/lib/domain/org-profile";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";

/**
 * WHAT THIS OUTFIT CALLS ITSELF.
 *
 * "Society" is a British word and the app said it worldwide. The country a
 * club gives for itself now picks a default — a society in Britain and
 * Ireland, a league in the United States — but a country can only ever be a
 * good guess. A US outfit that has always called itself a society is not wrong
 * about its own name, and an app that keeps correcting it is worse than one
 * that never guessed.
 *
 * So: the country is the DEFAULT, the organizer is the AUTHORITY.
 *
 * SHOWN ONLY TO A COMMUNITY, because it is the only kind whose noun travels
 * badly. A club is a club and an outing is an outing wherever they are played,
 * and offering those two a word to change would be asking a question with no
 * right answer behind it.
 *
 * IT SHOWS THE SENTENCE, not just the word, for the reason the currency and
 * date controls both do: "league" tells a golf secretary nothing about what
 * changes, and "League settings" tells them exactly what their sidebar will
 * say tomorrow. These strings are the ones that actually appear, read from the
 * same table the app reads, so the preview cannot drift from the result.
 */
export function OrgNounPicker({
  noun,
  country,
}: {
  /** The stored override, or "" for "follow the country". */
  noun: string;
  /** Only to show what "follow the country" currently resolves to. */
  country: string;
}) {
  const [value, setValue] = useState(noun ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = (next: string) => {
    setValue(next);
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await saveOrganizationNoun(next);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        setValue(noun ?? "");
        return;
      }
      setSaved(true);
    });
  };

  /**
   * What the blank option actually does, resolved through the SAME function
   * the rest of the app uses rather than repeated here.
   *
   * Writing "follow the country (society)" by hand would be a second source of
   * the same truth, and the first one to go stale — a country added to the
   * table later would leave this label confidently wrong.
   */
  const followed = orgProfile("community", country, "").noun;
  const active = orgProfile("community", country, value);

  return (
    <div className="field" style={{ maxWidth: 340 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        What to call this outfit
        <FieldInfo label="what this outfit is called">
          <p>
            The same outfit is a <b>society</b> in Britain and Ireland and a <b>golf league</b> or{" "}
            <b>association</b> in the United States. The app picks one from the country on this
            page, and this is where you overrule it.
          </p>
          <p>
            It changes the words, never the behaviour. Whatever you choose, the shared roster, the
            settle-up and the season table work exactly as they do now — a society in Boston still
            fronts the minibus.
          </p>
        </FieldInfo>
      </label>

      <select
        className="input"
        value={value}
        disabled={pending}
        onChange={(e) => save(e.target.value)}
      >
        {/* The blank is first and is a real answer, not an empty state: it is
            what every outfit said before this setting existed, and an
            organizer who changes their mind has to be able to get back to it. */}
        <option value="">Follow our country — {followed}</option>
        {COMMUNITY_VOICE_KEYS.map((key) => (
          <option key={key} value={key}>
            {COMMUNITY_VOICES[key].noun}
          </option>
        ))}
      </select>

      <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.55 }}>
        The sidebar reads <b style={{ color: "var(--color-text)" }}>{active.groupLabel}</b>, this
        page is called <b style={{ color: "var(--color-text)" }}>{active.settingsLabel}</b>, and
        screens say things like &ldquo;your {active.noun}&rsquo;s home course&rdquo;.
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
