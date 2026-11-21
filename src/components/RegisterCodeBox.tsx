"use client";
import { useActionState } from "react";
import { guestEntryFor, type TypedEntryState } from "@/app/actions/guest-entry";
import { bringIntoView } from "@/lib/bring-into-view";
import { Icon } from "./Icon";

/**
 * THE CODE UNDER THE SIGN-UP POSTER, TYPED (J39/J40 PR 3B; the 7 Nov "a code under every QR" ruling). The box is
 * focused when the page opens. It is a POST: the code is in the body, never in an address, and the server sends the
 * browser on to the sign-up page it opens. Every failed code, of every kind, gets the same sentence.
 */
export function RegisterCodeBox() {
  const [state, action, pending] = useActionState<TypedEntryState, FormData>(guestEntryFor, { code: "" });
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label htmlFor="register-code" style={{ fontSize: 16, fontWeight: 600 }}>
        Code from the poster
      </label>
      <input
        id="register-code"
        name="code"
        className="input"
        autoFocus
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        placeholder="ABCD-EFGH"
        maxLength={40}
        defaultValue={state.code}
        style={{ fontSize: 20, minHeight: 52, letterSpacing: "0.08em", textTransform: "uppercase" }}
      />
      {state.error && (
        <p role="alert" ref={bringIntoView} className="form-error" style={{ fontSize: 14, margin: 0 }}>
          <Icon name="warning-circle" /> {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" style={{ minHeight: 52, fontSize: 16 }} disabled={pending}>
        Open
      </button>
    </form>
  );
}
