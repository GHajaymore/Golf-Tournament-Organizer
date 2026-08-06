import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { ScorecardClient } from "@/components/ScorecardClient";
import { COURSES, type CoursePreset } from "@/lib/courses";
import { eventCourses } from "@/lib/services/courses";
import { brandForEvent } from "@/lib/services/organization";

export default async function ScorecardPage() {
  const session = await requireScreen("scorecard");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const brand = await brandForEvent(session.eventId);

  // The club's own venues come first, then the built-in presets. Without this
  // a course saved in the library — which is where a club's real card lives —
  // simply couldn't be printed, only the demo presets could.
  const venues = await eventCourses(session.eventId);
  const venuePresets: CoursePreset[] = venues.map((v) => ({
    name: v.name,
    city: v.city,
    address: "",
    pars: v.pars,
    yards: v.yards,
    strokeIndex: v.strokeIndex,
  }));
  const courseOptions = [
    ...venuePresets,
    ...COURSES.filter((c) => !venuePresets.some((v) => v.name === c.name)),
  ];

  const flights = state.groups.map((g, i) => ({
    label: `Flight ${i + 1}`,
    players: state.confirmed
      .filter((p) => p.groupId === g.id)
      .sort((a, b) => a.handicap - b.handicap)
      .map((p) => ({ name: p.name, handicap: p.handicap })),
  }));

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Scorecards</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Printable scorecards for the current field — one per flight or one for the whole field, on your course.
        </p>
      </div>
      <ScorecardClient
        courses={courseOptions}
        flights={flights}
        eventName={state.event.name}
        eventDates={state.event.dates}
        defaultCourse={venuePresets[0]?.name ?? state.event.course}
        isStroke={state.isStroke}
        brand={brand}
      />
    </>
  );
}
