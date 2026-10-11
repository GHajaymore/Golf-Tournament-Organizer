"use client";
import { useEffect } from "react";

/**
 * The second half of `TypedBeforeLoad`: once the page is live, tell it about
 * every text box somebody typed in while it was not.
 *
 * A box is told about ONCE, and only when the page has taken it over — a
 * screen can arrive in pieces, so the list is checked again a few times a
 * second for ten seconds rather than once.
 *
 * HOW A PAGE IS TOLD. React keeps its own note of what each box last held and
 * ignores an input event that agrees with the note — and when it takes a box
 * over it reads the note off the box, letters and all. So the note is set
 * back to what the server drew, and then the event is sent: React sees a box
 * that has changed, and runs the same handler a keystroke runs. That note
 * (`_valueTracker`) is React's own and unpromised. If it is ever not there
 * this does nothing at all, and `e2e/typed-before-load.spec.ts` goes red.
 */

type Typed = HTMLInputElement | HTMLTextAreaElement;

const TEXT = new Set(["", "text", "email", "password", "tel", "search", "url", "number"]);

function isTextBox(el: Element): el is Typed {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT.has(el.type);
}

const takenOver = (el: Element) => Object.keys(el).some((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"));

function tell(el: Typed): void {
  const note = (el as unknown as { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
  if (!note) return;
  // Nothing to say about a box that holds what the server drew in it.
  if (el.value === el.defaultValue) return;
  note.setValue(el.defaultValue);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function TypedBeforeLoadSync() {
  useEffect(() => {
    const seen = (window as unknown as { __thqTyped?: Set<Element> }).__thqTyped;
    if (!seen) return;
    let passes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pass = () => {
      for (const el of [...seen]) {
        if (!el.isConnected) {
          seen.delete(el);
          continue;
        }
        if (!takenOver(el)) continue; // its part of the screen is not live yet
        seen.delete(el);
        if (isTextBox(el)) tell(el);
      }
      passes += 1;
      if (passes < 40) timer = setTimeout(pass, 250);
    };
    pass();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}
