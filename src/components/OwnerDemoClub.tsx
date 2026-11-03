"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";
import { refreshDemoClub } from "@/app/actions/owner";

/**
 * DEMO CLUB: CREATE / REFRESH, on the owner console (Ajay, 2026-10-24). One
 * press, asked twice, builds the invented demo club — or builds it again from
 * nothing — and says beside the press what happened. `built` and `when` are the
 * demo as it stands, read on the server (`demoStatus`).
 */
export function OwnerDemoClub({
  built,
  when,
  day,
  holesIn,
  links,
}: {
  built: boolean;
  when: string;
  day: string;
  holesIn: number;
  links: { board: string; event: string; clubhouse: string; finishedEvent: string; report: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const press = () =>
    start(async () => {
      const res = await refreshDemoClub();
      setSaid(
        res.ok
          ? { ok: true, text: "The demo club is built: two tournaments, today's medal playing from eight o'clock at the club." }
          : { ok: false, text: res.error || "That did not work. Nothing was changed." },
      );
      router.refresh();
    });

  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener" style={{ marginRight: 14, whiteSpace: "nowrap" }}>
      {label}
    </a>
  );

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }} id="demo-club">
      <span className="card-title" style={{ fontSize: 15 }}>Demo club</span>
      <p style={{ fontSize: 14, margin: "6px 0 4px" }}>
        {built
          ? `Built ${when}. Today's medal is on ${day}, ${holesIn} ${holesIn === 1 ? "hole" : "holes"} in so far.`
          : "Not built yet. Visitors following “See a demo club’s day” are told it is on its way."}
      </p>
      <p className="text-muted" style={{ fontSize: 13, margin: "0 0 4px" }}>
        An invented club with invented players. It is left out of every count on this page, the deploy freeze, plan limits and billing, and it never sends a message.
      </p>
      {built && (
        <p style={{ fontSize: 13, margin: "6px 0" }}>
          {link(links.board, "Board")}
          {link(links.event, "Event page")}
          {link(links.clubhouse, "Clubhouse screen")}
          {link(links.report, "Finished report")}
        </p>
      )}
      <div style={{ marginTop: 6 }}>
        <ConfirmButton
          className={built ? "btn btn-secondary" : "btn btn-primary"}
          icon="arrows-clockwise"
          label={built ? "Refresh the demo club" : "Create the demo club"}
          title={built ? "Build the demo club again from nothing" : "Build the demo club"}
          confirmLabel={built ? "Yes, rebuild it" : "Yes, build it"}
          note="Only the demo club's own rows are written. Takes a few seconds."
          disabled={pending}
          onConfirm={press}
        />
      </div>
      {said && (
        <p role={said.ok ? "status" : "alert"} className={said.ok ? undefined : "form-error"} style={{ fontSize: 13, margin: "8px 0 0" }}>
          {said.text}
        </p>
      )}
    </div>
  );
}
