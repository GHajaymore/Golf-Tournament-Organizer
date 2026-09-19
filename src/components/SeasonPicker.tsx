"use client";
import { useOrgProfile } from "@/components/OrgProfileProvider";
import { useState, useTransition } from "react";
import { saveOrganizationSeason } from "@/app/actions/organization";
import { seasonWindow, seasonLabel, seasonWraps } from "@/lib/domain/club-season";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";

/**
 * WHEN THIS CLUB'S SEASON RUNS.
 *
 * Two calendar pickers, because a season is a window: January to December,
 * April to September, April to March next year, October to August next year —
 * all four are answers a secretary gave when this was specified. The YEAR is
 * thrown away; a season recurs, and storing 2026 would make 2027 something
 * somebody has to remember to add.
 *
 * IT SHOWS THE ANSWER BACK, the way the locale and currency controls do: a
 * window that crosses the new year is labelled "2026–27" on every screen that
 * groups by it, and that is the part a club would otherwise discover on its
 * members' phones. A worked example is the only thing that makes "04-01 to
 * 03-31" mean anything to a golf secretary.
 *
 * Both halves are optional. Clearing them returns the club to the calendar
 * year, which is what every club that has never answered already has.
 */
export function SeasonPicker({ startsOn, endsOn }: { startsOn: string; endsOn: string }) {
  const org = useOrgProfile();
  const [start, setStart] = useState(startsOn);
  const [end, setEnd] = useState(endsOn);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // The pickers are `type="date"`, so they need a year to show anything. It is
  // a scratch year and never stored — `saveOrganizationSeason` keeps `mm-dd`.
  const SCRATCH = "2026";
  const toPicker = (mmdd: string) => (/^\d{2}-\d{2}$/.test(mmdd) ? `${SCRATCH}-${mmdd}` : "");
  const fromPicker = (iso: string) => (/^\d{4}-(\d{2})-(\d{2})$/.test(iso) ? iso.slice(5) : "");

  const save = (nextStart: string, nextEnd: string) => {
    setStart(nextStart);
    setEnd(nextEnd);
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await saveOrganizationSeason(nextStart, nextEnd);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        setStart(startsOn);
        setEnd(endsOn);
        return;
      }
      setSaved(true);
    });
  };

  const window = seasonWindow(start, end);
  const example = seasonLabel(2026, window);

  return (
    <div className="field" style={{ maxWidth: 420 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Season
        <FieldInfo label={`when the ${org.noun}'s season runs`}>
          <p>
            Tournaments are grouped into seasons by the day they start, so members see the season
            they are in rather than everything you have ever run.
          </p>
          <p>
            Leave both blank for the calendar year. A season that ends before it starts — April to
            March, or October to August — crosses the new year and is written {example}.
          </p>
        </FieldInfo>
      </label>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          className="input"
          type="date"
          aria-label="Season starts"
          value={toPicker(start)}
          onChange={(e) => save(fromPicker(e.target.value), end)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <span className="text-muted">to</span>
        <input
          className="input"
          type="date"
          aria-label="Season ends"
          value={toPicker(end)}
          onChange={(e) => save(start, fromPicker(e.target.value))}
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      <p className="text-muted" style={{ fontSize: 12.5, margin: "6px 0 0", lineHeight: 1.5 }}>
        {!start && !end
          ? "The calendar year. Tournaments group as 2026, 2027, and so on."
          : seasonWraps(window)
            ? `Crosses the new year, so this season is written ${example}.`
            : `Tournaments starting in this window group as ${example}.`}{" "}
        The year you pick is ignored — a season repeats every year.
      </p>
      {error && (
        <p style={{ fontSize: 12.5, margin: "6px 0 0", color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
      {saved && !pending && !error && (
        <p className="text-muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
          <Icon name="check" /> Saved.
        </p>
      )}
    </div>
  );
}
