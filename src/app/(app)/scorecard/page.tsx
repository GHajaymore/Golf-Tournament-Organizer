import { requireScreen } from "@/lib/page-helpers";
import { ScorecardClient } from "@/components/ScorecardClient";
import { COURSES } from "@/lib/courses";

export default async function ScorecardPage() {
  await requireScreen("scorecard");

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Scorecard generator</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Build a match-play scorecard for a course, then send it to score entry.
        </p>
      </div>
      <ScorecardClient courses={COURSES} />
    </>
  );
}
