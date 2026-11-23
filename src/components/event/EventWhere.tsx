"use client";
import { useId, useState } from "react";
import { CoursePicker } from "@/components/CoursePicker";
import type { PickedCardNote } from "@/lib/domain/picked-card";
import { useGolfTerms } from "@/components/GolfTermsProvider";
import { Icon } from "../Icon";

export interface CourseOption {
  id: string;
  name: string;
  city: string;
  address: string;
  /** What the picker says about this course's card once chosen. */
  cardNote?: PickedCardNote | null;
}

/**
 * WHERE IT IS PLAYED: the course select, an open course, a course typed by hand with its zip and
 * "use my location", and the city and address. Lifted out of `EventSetupClient` (R3-1), no
 * behaviour change; Event (R3) mounts it. The draft stays in the caller's one form; the zip lookup
 * and the locate button are this block's own and keep their state here.
 */
export function EventWhere({
  courses,
  courseSelect,
  course,
  city,
  address,
  onSelectCourse,
  onBusyChange,
  onEnterNew,
  onCourseName,
  onCity,
  onAddress,
  onPlaceFound,
  offerOpen = true,
}: {
  /** Whether "No fixed course" is a row of the picker. Event (R3) asks it as its own answer and passes false. */
  offerOpen?: boolean;
  courses: CourseOption[];
  /** The picker's row: an id, "__other" (typed by hand), "__open" (players choose) or "". */
  courseSelect: string;
  course: string;
  city: string;
  address: string;
  onSelectCourse: (val: string, taken?: { name: string; city: string }) => void;
  /** A course from the search is being added: Save waits for it. */
  onBusyChange: (busy: boolean) => void;
  onEnterNew: (name: string) => void;
  onCourseName: (v: string) => void;
  onCity: (v: string) => void;
  onAddress: (v: string) => void;
  /** A zip or a location found a city: the caller sets it, and the address only if it was empty. */
  onPlaceFound: (city: string, addressIfEmpty: string) => void;
}) {
  const golfWords = useGolfTerms();
  const fid = useId();
  const [zip, setZip] = useState("");
  const [zipMsg, setZipMsg] = useState("Enter a US zip to fill in the city/state.");
  const [locating, setLocating] = useState(false);

  const lookupZip = async () => {
    const z = zip.trim();
    if (!/^\d{5}$/.test(z)) {
      if (z) setZipMsg("Enter a 5-digit US zip code.");
      return;
    }
    setZipMsg("Looking up…");
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${z}`);
      if (!res.ok) {
        setZipMsg("Zip not found — enter the city/address manually.");
        return;
      }
      const data = (await res.json()) as {
        places?: Array<{ "place name": string; "state abbreviation": string }>;
      };
      const place = data.places?.[0];
      if (place) {
        const found = place["place name"];
        const state = place["state abbreviation"];
        onPlaceFound(found, `${found}, ${state} ${z}`);
        setZipMsg(`Found ${found}, ${state}. Add the street address if needed.`);
      }
    } catch {
      setZipMsg("Lookup unavailable — enter the city/address manually.");
    }
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setZipMsg("Location isn't available in this browser — enter a zip instead.");
      return;
    }
    setLocating(true);
    setZipMsg("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
          );
          const data = (await res.json()) as { city?: string; locality?: string; principalSubdivisionCode?: string; postcode?: string };
          const found = data.city || data.locality || "";
          const state = (data.principalSubdivisionCode || "").split("-").pop() || "";
          if (found) {
            onPlaceFound(found, `${found}, ${state}`.trim());
            setZipMsg(`Found ${found}${state ? `, ${state}` : ""}. Add the street address if needed.`);
            if (data.postcode) setZip(data.postcode);
          } else {
            setZipMsg("Couldn't determine your city — enter it manually.");
          }
        } catch {
          setZipMsg("Location lookup failed — enter the city/address manually.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setZipMsg("Location access denied — enter a zip instead.");
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  return (
    <>
      <div className="field">
        <CoursePicker
          label="Golf course"
          /**
           * Keyed by NAME here, and only here.
           *
           * The Event stores its venue as a course name plus its own hole-by-hole card, which
           * predates the Course library and is what `resolveCourse` matches on. Every other screen
           * picks by id. That split is a data-model question, not a control question, so the CONTROL
           * is the one used everywhere while what it saves is untouched.
           */
          options={courses.map((c) => ({ id: c.id, name: c.name, city: c.city, cardNote: c.cardNote }))}
          value={courseSelect}
          onChange={onSelectCourse}
          onBusyChange={onBusyChange}
          noneLabel="— Select a course —"
          searchDirectory
          // A society playing somewhere new every month should not have to go and add the course
          // somewhere else first, then come back.
          onEnterNew={onEnterNew}
          extras={
            offerOpen
              ? [
                  { id: "__other", label: "Other (enter manually)" },
                  { id: "__open", label: "No fixed course — players choose" },
                ]
              : [{ id: "__other", label: "Other (enter manually)" }]
          }
        />
        {courseSelect === "__open" && (
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>
            For a league or {golfWords.golfGroup} where each pairing arranges its own venue.
            Nothing is set here; whoever enters a card names the course they
            played, and it is saved to the club&rsquo;s list for next time.
          </p>
        )}
      </div>

      {courseSelect === "__other" && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div className="field">
            <label htmlFor={`${fid}-course`}>Course name</label>
            <input id={`${fid}-course`} className="input" value={course} onChange={(e) => onCourseName(e.target.value)} placeholder="e.g. Maketewah Country Club" />
          </div>
          <div className="field">
            <label htmlFor={`${fid}-zip`}>Zip code</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                id={`${fid}-zip`}
                className="input"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                onBlur={lookupZip}
                placeholder="45202"
                inputMode="numeric"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                disabled={locating}
                onClick={useMyLocation}
                title="Use my current location"
              >
                <Icon name={locating ? "ph ph-spinner-gap" : "ph ph-navigation-arrow"} />
              </button>
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: 13, margin: "-6px 0 0", gridColumn: "1 / -1" }}>{zipMsg}</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
        <div className="field"><label htmlFor={`${fid}-city`}>City</label><input id={`${fid}-city`} className="input" value={city} onChange={(e) => onCity(e.target.value)} placeholder="City" /></div>
        <div className="field"><label htmlFor={`${fid}-address`}>Address</label><input id={`${fid}-address`} className="input" value={address} onChange={(e) => onAddress(e.target.value)} placeholder="Street, city, state zip" /></div>
      </div>
    </>
  );
}
