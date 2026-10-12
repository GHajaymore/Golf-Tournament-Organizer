"use client";
import { useOrgProfile } from "@/components/OrgProfileProvider";
import { useEffect, useState, useTransition } from "react";
import { saveOrganizationTimeZone } from "@/app/actions/organization";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";

/**
 * Where the club is — the clock its deadlines are read from.
 *
 * Beside how it writes a date, because it is the other half of the same
 * answer: "entries close 12 October" needs a way to WRITE the 12th and a
 * place for the 12th to end.
 *
 * IT SHOWS THE TIME, for the reason the date control shows a date. A zone
 * name tells a golf secretary very little — is the club "America/Detroit" or
 * "America/New_York"? — and an offset tells them less. The time on the club's
 * wall is something they can check against their own watch, and it is the
 * only part of this control that would reveal a wrong choice.
 *
 * The time is worked out on the SERVER and handed in as words: a clock read
 * while drawing would be read twice, once on each side, and the two would not
 * agree (`no-client-screen-draws-from-its-own-clock.test.ts`).
 */

/** "America/Argentina/Buenos_Aires" → "Buenos Aires (Argentina)". The region is the group's heading. */
function zoneLabel(zone: string): string {
  const [, ...rest] = zone.split("/");
  if (rest.length === 0) return zone.replace(/_/g, " ");
  const city = rest[rest.length - 1].replace(/_/g, " ");
  const within = rest.slice(0, -1).map((p) => p.replace(/_/g, " "));
  return within.length ? `${city} (${within.join(", ")})` : city;
}

const regionOf = (zone: string) => (zone.includes("/") ? zone.split("/")[0] : "Other");

export function TimeZonePicker({
  timeZone,
  zones,
  clock,
}: {
  /** The club's zone, or "" when it has not said. */
  timeZone: string;
  /** Every zone on offer, from the server (`timeZoneChoices`). */
  zones: string[];
  /** The time on the club's wall right now, in words — "" when no zone is set. */
  clock: string;
}) {
  const org = useOrgProfile();
  const [value, setValue] = useState(timeZone);
  const [shownClock, setShownClock] = useState(clock);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // The device's own zone, read after mount: the server has no device.
  const [device, setDevice] = useState("");
  useEffect(() => {
    try {
      setDevice(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    } catch {
      setDevice("");
    }
  }, []);
  // The server's answer after a refresh (another tab, or the first adoption).
  useEffect(() => {
    setValue(timeZone);
    setShownClock(clock);
  }, [timeZone, clock]);

  const save = (next: string) => {
    if (!next) return;
    const before = value;
    setValue(next);
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await saveOrganizationTimeZone(next);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        setValue(before);
        return;
      }
      setShownClock(res.clock ?? "");
      setSaved(true);
    });
  };

  // Whatever is stored, even a name this list does not carry — India is
  // "Asia/Calcutta" to one runtime and "Asia/Kolkata" to another — so the
  // control never shows a different place from the one in force.
  const offered = !value || zones.includes(value) ? zones : [value, ...zones];
  const regions = [...new Set(offered.map(regionOf))];

  return (
    <div className="field" style={{ maxWidth: 340 }}>
      <label htmlFor="club-time-zone" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Time zone
        <FieldInfo label={`where the ${org.noun} is`}>
          <p>
            Where this {org.noun} is. Every closing date, sign-up deadline and round date is a day
            on this clock: entries that close on the 12th stay open until midnight here.
          </p>
          <p>
            It is taken from the device of whoever set the {org.noun} up. Change it if that was
            somewhere else.
          </p>
        </FieldInfo>
      </label>

      <select
        id="club-time-zone"
        className="input"
        value={value}
        disabled={pending}
        onChange={(e) => save(e.target.value)}
      >
        {!value && <option value="">Not set yet</option>}
        {regions.map((region) => (
          <optgroup key={region} label={region}>
            {offered
              .filter((z) => regionOf(z) === region)
              .map((z) => (
                <option key={z} value={z}>
                  {zoneLabel(z)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>

      <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0", lineHeight: 1.55 }}>
        {value && shownClock ? (
          <>
            It is <b style={{ color: "var(--color-text)" }}>{shownClock}</b> at the {org.noun}. A closing
            date ends at midnight on this clock.
          </>
        ) : (
          <>Not set, so closing dates end at midnight UTC rather than at the {org.noun}.</>
        )}
      </p>

      {device && device !== value && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 8, alignSelf: "flex-start", whiteSpace: "normal", textAlign: "left" }}
          disabled={pending}
          onClick={() => save(device)}
        >
          Use this device&rsquo;s zone — {zoneLabel(device)}
        </button>
      )}

      {error && (
        <p style={{ color: "var(--color-danger)", fontSize: 13, margin: "6px 0 0" }}>{error}</p>
      )}
      {saved && !error && (
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          <Icon name="check" /> Saved
        </p>
      )}
    </div>
  );
}
