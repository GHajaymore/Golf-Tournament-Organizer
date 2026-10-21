"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";
import { setAccountsOpen } from "@/app/actions/owner";

/**
 * THE LAUNCH SWITCH, on the owner console (Ajay, 2026-10-21: "make sure its an easy control which
 * we can flip back to allow signup / signin"). One press, asked twice, either way; the answer is
 * said beside the press. `ruleHolds` is whether this deployment holds accounts at all — on a
 * preview or in dev they are open whatever the switch says, and the card says so.
 */
export function OwnerAccounts({ held, ruleHolds }: { held: boolean; ruleHolds: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState("");

  const flip = (open: boolean) =>
    start(async () => {
      const res = await setAccountsOpen(open);
      setSaid(res.ok ? (res.now === "open" ? "Accounts are open. Anybody can sign up and sign in." : "Accounts are held again. Only you can sign in.") : res.error ?? "That did not save.");
      router.refresh();
    });

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }} id="accounts">
      <span className="card-title" style={{ fontSize: 15 }}>Accounts</span>
      <p style={{ fontSize: 14, margin: "6px 0 10px" }}>
        {!ruleHolds
          ? "Open: this deployment does not hold accounts, so the switch has nothing to hold."
          : held
            ? "Held until launch. Visitors see “opening soon”; only you can sign in, and nobody can sign up."
            : "Open. Anybody can sign up and sign in."}
      </p>
      {ruleHolds && (
        <ConfirmButton
          className={held ? "btn btn-primary" : "btn btn-secondary"}
          icon={held ? "lock-key-open" : "lock"}
          label={held ? "Open accounts" : "Hold accounts again"}
          title={held ? "Open accounts to everybody" : "Hold accounts until launch"}
          confirmLabel={held ? "Yes, open to everybody" : "Yes, hold them"}
          note={held ? "Takes effect on the next page anybody opens. You can hold them again here." : "Everybody but you is signed out at their next page."}
          disabled={pending}
          onConfirm={() => flip(held)}
        />
      )}
      {said && (
        <p role="status" style={{ fontSize: 13, margin: "8px 0 0" }}>
          {said}
        </p>
      )}
    </div>
  );
}
