import { redirect } from "next/navigation";

// Match Points configuration now lives inside the Round builder, on each
// round-robin round card. This route is kept as a redirect for old links.
export default function ScoringPage() {
  redirect("/stages");
}
