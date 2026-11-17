"use server";
import { redirect } from "next/navigation";
import { clientAddress } from "@/lib/client-address";
import { openAnyCode, type OpenedCode, type RedeemedRound } from "@/lib/services/code-door";

/**
 * ONE CODE BOX, PRESSED (plan row 4c, simplicity cut 1).
 *
 * The press of every box a player types a code into — /play's, /p's — and a
 * tap on /p's "Open my card". Both hand the code to THE ONE DOOR
 * (`openAnyCode`, `services/code-door.ts`), which reads its shape, chooses its
 * budget by that shape, does that shape's one lookup and answers every failure
 * in one sentence. Neither says which box it came from, and the door takes no
 * box: the answer cannot depend on which page asked.
 *
 * Opening is its own authorization, as a round code always was: a code looked
 * up behind limits that are never cleared for a failure. It never makes an
 * account's session.
 */
export async function openCode(input: unknown): Promise<OpenedCode> {
  return openAnyCode(input, await clientAddress());
}

/**
 * /play's box WITH NO SCRIPT (or none ten seconds after the press: the form is
 * posted the plain way, `round-code-on-3g.spec.ts`). The same door, so the same
 * answer: a round code draws its names and groups in the page the server sends
 * back; a personal code ends in its Today (`redirect`); a refusal is said
 * beside the button with what was typed kept in the box.
 *
 * Shaped for `useActionState` (the state before, then the form). The code
 * arrives in the BODY of a POST, never in an address a server logs.
 */
export interface CodeFormState extends Partial<RedeemedRound> {
  ok: boolean;
  error?: string;
  /** The code as it goes on to the name step, or as it was typed when refused. */
  code: string;
}

export async function openCodeForm(_before: CodeFormState | null, form: FormData): Promise<CodeFormState> {
  const typed = form.get("code");
  const opened = await openAnyCode(typed, await clientAddress());
  if (!opened.ok) return { ok: false, error: opened.error, code: String(typed ?? "").slice(0, 64) };
  // Outside any try: `redirect` works by throwing.
  if (opened.kind !== "round") redirect(opened.href);
  return { ok: true, code: opened.code, ...opened.round };
}
