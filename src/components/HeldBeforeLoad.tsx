/**
 * A PRESS MADE BEFORE THE PAGE IS LIVE IS HELD, NOT LOST AND NOT A NEW PAGE (2026-10-25).
 *
 * The round code's two forms (the code box, the list of names) are real forms, so they work with no
 * script at all: a plain post, and the server draws the next step. But a plain post is a NEW PAGE,
 * and on slow 3G that was measured to cost more than it saves: the page being left was part-way
 * through its scripts and fonts, every half-fetched one starts again on the next, and the pad that
 * takes a score woke 2 s LATER than if the press had simply waited (12.5 s against 10.5 s from
 * opening the link, a player typing at a key every 300 ms — `e2e/round-code-on-3g.spec.ts`).
 *
 * So where the page's script IS coming, this holds the press instead: the tiny script below runs
 * the moment the browser reads it, catches the submit of a form marked `data-held-until-live` that
 * React has not taken over yet, keeps it, and marks the button busy. The page, once live, takes the
 * press up exactly as if it had just been made (`takeHeldPress`). With JavaScript off this never
 * runs and the form posts the plain way; and if the page has still not woken ten seconds after the
 * press — the script blocked, or never coming — the press goes as the plain post after all.
 *
 * Only what React leaves alone is touched before it arrives: two attributes and an opacity, never
 * a word (a word changed before hydration is a mismatch).
 */
const HOLD = `(function(){var k="__thqHeld";if(window[k]!==undefined)return;window[k]=null;function live(el){var ks=Object.keys(el);for(var i=0;i<ks.length;i++){if(ks[i].indexOf("__reactFiber$")===0)return true;}return false;}document.addEventListener("submit",function(e){var f=e.target;if(!f||!f.hasAttribute||!f.hasAttribute("data-held-until-live")||live(f))return;if(window.__thqLetGo===f){window.__thqLetGo=null;return;}e.preventDefault();if(window[k])return;var s=e.submitter||null;var b=s||f;window[k]={form:f,submitter:s,data:new FormData(f),value:s?s.value:""};b.setAttribute("data-held","");b.setAttribute("aria-busy","true");b.style.opacity="0.6";setTimeout(function(){var h=window[k];if(!h||h.form!==f||live(f))return;window[k]=null;window.__thqLetGo=f;if(f.requestSubmit){f.requestSubmit(s||undefined);}else{if(s&&s.name){var i=document.createElement("input");i.type="hidden";i.name=s.name;i.value=s.value;f.appendChild(i);}f.submit();}},${10_000});},true);})();`;

/** The holder, drawn above the forms it holds for. */
export function HeldBeforeLoad() {
  return <script dangerouslySetInnerHTML={{ __html: HOLD }} />;
}

interface HeldPress {
  form: HTMLFormElement;
  submitter: HTMLButtonElement | null;
  /**
   * What the form held AT THE PRESS. Read then, not when the page wakes: read in the instant the
   * page went live — while `TypedBeforeLoadSync` is handing the typed box over to React — the box
   * was found EMPTY, and an empty code was sent (measured, 2026-10-25).
   */
  data: FormData;
  value: string;
}

/**
 * The press the holder kept, if it was made on one of these forms — and it is no longer held. The
 * caller acts on it. Null when there is none.
 */
export function takeHeldPress(): { kind: string; data: FormData; value: string } | null {
  const w = window as unknown as { __thqHeld?: HeldPress | null };
  const held = w.__thqHeld;
  if (!held || !document.contains(held.form)) return null;
  w.__thqHeld = null;
  const el = held.submitter ?? held.form;
  el.removeAttribute("data-held");
  el.removeAttribute("aria-busy");
  el.style.opacity = "";
  return { kind: held.form.getAttribute("data-held-until-live") ?? "", data: held.data, value: held.value };
}

/** A press the page took itself: whatever the holder kept of the same form is let go. */
export function dropHeldPress(form: HTMLFormElement | null) {
  const w = window as unknown as { __thqHeld?: HeldPress | null };
  if (form && w.__thqHeld?.form === form) takeHeldPress();
}
