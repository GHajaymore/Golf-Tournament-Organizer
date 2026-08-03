import { redirect } from "next/navigation";

// The roster merged into Registration & field (the confirmed table now shows
// flights). Kept as a redirect for any old links or bookmarks.
export default function RosterPage() {
  redirect("/registration");
}
