"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";
import { setAccountsOpen } from "@/app/actions/owner";

/**
 * THE LAUNCH SWITCH, on the owner console (Ajay, 2026-10-21: "make sure its an easy control which
 * we can flip back to allow signup / signin"). One press, asked twice, either way; the answer is
 * said beside the press.
 *
 * `opened` is the SWITCH's own position (the row), and `ruleHolds` whether this deployment holds
 * accounts at all. They are shown apart, because on a preview or in dev nothing is held whatever
 * the switch says — and the card says so rather than hiding the switch, which is also what lets a
 * browser test press it where the app is never held.
 */
export function OwnerAccounts({ opened, ruleHolds }: { opened: boolean; ruleHolds: boolean }) {
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
      <p style={{ fontSize: 14, margin: "6px 0 4px" }}>
        {opened ? "Open. Anybody can sign up and sign in." : "Held until launch. Visitors see “opening soon”; only you can sign in, and nobody can sign up."}
      </p>
      {!ruleHolds && (
        <p className="text-muted" style={{ fontSize: 13, margin: "0 0 4px" }}>
          This deployment never holds accounts (it is not production), so here the switch changes nothing. Production reads it.
        </p>
      )}
      <div style={{ marginTop: 6 }}>
        <ConfirmButton
          className={opened ? "btn btn-secondary" : "btn btn-primary"}
          icon={opened ? "lock" : "lock-key-open"}
          label={opened ? "Hold accounts again" : "Open accounts"}
          title={opened ? "Hold accounts until launch" : "Open accounts to everybody"}
          confirmLabel={opened ? "Yes, hold them" : "Yes, open to everybody"}
          note={opened ? "Everybody but you is signed out at their next page." : "Takes effect on the next page anybody opens. You can hold them again here."}
          disabled={pending}
          onConfirm={() => flip(!opened)}
        />
      </div>
      {said && (
        <p role="status" style={{ fontSize: 13, margin: "8px 0 0" }}>
          {said}
        </p>
      )}
    </div>
  );
}
