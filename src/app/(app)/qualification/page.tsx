import { redirect } from "next/navigation";

/**
 * Qualification now lives under the draw it seeds, on `/bracket`.
 *
 * The two were never separable: `/bracket`'s subtitle reads "Seeded from
 * qualification", both nav entries were gated on the same condition so they
 * appeared and vanished together, and both showed the same players — one as
 * "who goes through", the other as "who they play".
 *
 * Kept as a redirect rather than deleted, the same as `/scoring` when Match
 * Points moved into the round builder. An organizer's bookmark, a link in an
 * old email, and this app's own screenshots all still point here.
 */
export default function QualificationPage() {
  redirect("/bracket");
}
