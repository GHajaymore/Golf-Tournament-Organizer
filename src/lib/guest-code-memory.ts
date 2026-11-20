/**
 * THE GUEST'S OWN CODE, HELD IN THE PAGE AND NOWHERE ELSE (J39/J40 PR 3B, C3.3).
 *
 * `registerAsGuest` answers with the code once. It is kept here, in this module's memory, so the waiting screen can
 * show "Save this code" across the 20-second refresh and across the client-side move from the sign-up page to Today.
 * It is NEVER server-rendered (the RSC payload of a polled `/me` holds no code), never put in storage, a cookie or an
 * address. A full reload drops the display, never the entry: the cookie still holds the guest in, and staff can show
 * the link from the guest's row.
 */
let held: string | null = null;

export function holdGuestCode(code: string | null): void {
  held = code && code.length > 0 ? code : null;
}

export function heldGuestCode(): string | null {
  return held;
}

export function dropGuestCode(): void {
  held = null;
}
