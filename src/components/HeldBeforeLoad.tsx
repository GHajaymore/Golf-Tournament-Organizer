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
 *
 * AND THE PAGE THAT PLAIN POST OPENS IS SHOWN, ON SAFARI TOO (2026-11-03). Safari keeps showing the
 * page being left until the new one is "visually non-empty" or has finished loading. The list of
 * names is short (a field of three is under the 200 characters that count as content), and while
 * its scripts are still on their way it never finishes loading — so on the iPhone's engine the
 * names were in the document but never painted, the old page stayed on screen, and a tap on a
 * name went nowhere visible (round G421-1: the press on the name never left Playwright's "stable"
 * check, which waits for a painted frame, for 109 s; no screencast frame after the post). So a
 * press that had to be let go leaves a mark (`LET_GO_AT`, for a minute), and the next page this
 * runs on — if it is still not live a moment after it is read — stops waiting for its scripts
 * (`window.stop()`): it finishes loading, Safari paints it, and it works as the page without script
 * does, its presses posted at once. The scripts had already failed to arrive once in ten seconds.
 *
 * AND THE MARK IS PASSED ON WHILE THE SCRIPTS ARE STILL NOT COMING (2026-11-05). Since the one
 * confirmation the walk is THREE pages without script — the code, the names, "You're keeping …" —
 * and the mark was spent on the second: the name went at once from the stopped list, and the
 * confirmation it opened waited for its scripts again, unpainted on the iPhone's engine, so "Yes,
 * that's right" never took a press (round scoring-by-group-1-2: the click never left "stable" for
 * 108 s). So a press posted from a STOPPED page leaves the mark again, and the next page stops too
 * — but only a page that works without script: one with a held form (`data-held-until-live`) or a
 * plain one (`data-plain-post`, the confirmation and whose-card forms). The card itself has
 * neither, so it is never stopped: its scripts are what make the pad work, and they may yet come.
 */
const LET_GO_AT = "thqLetGoAt";
const GRACE_AFTER_LET_GO_MS = 1_500;
/** The forms that post the plain way and work without script: a page holding one may be stopped. */
const WORKS_WITHOUT_SCRIPT = "form[data-held-until-live],form[data-plain-post]";
const HOLD = `(function(){var k="__thqHeld";if(window[k]!==undefined)return;window[k]=null;function live(el){var ks=Object.keys(el);for(var i=0;i<ks.length;i++){if(ks[i].indexOf("__reactFiber$")===0)return true;}return false;}var S="${LET_GO_AT}",P="${WORKS_WITHOUT_SCRIPT}",stopped=false;function mark(){try{sessionStorage.setItem(S,String(Date.now()));}catch(x){}}try{var t=+(sessionStorage.getItem(S)||0);sessionStorage.removeItem(S);if(t&&Date.now()-t<${60_000}){var go=function(){setTimeout(function(){var f=document.querySelector(P);if(!f||live(f))return;stopped=true;window.stop();},${GRACE_AFTER_LET_GO_MS});};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go();}}catch(x){}document.addEventListener("submit",function(e){var f=e.target;if(!f||!f.hasAttribute||live(f))return;if(stopped){if(f.hasAttribute("data-held-until-live")||f.hasAttribute("data-plain-post"))mark();return;}if(!f.hasAttribute("data-held-until-live"))return;if(window.__thqLetGo===f){window.__thqLetGo=null;return;}e.preventDefault();if(window[k])return;var s=e.submitter||null;var b=s||f;window[k]={form:f,submitter:s,data:new FormData(f),value:s?s.value:""};b.setAttribute("data-held","");b.setAttribute("aria-busy","true");b.style.opacity="0.6";setTimeout(function(){var h=window[k];if(!h||h.form!==f||live(f))return;window[k]=null;window.__thqLetGo=f;try{sessionStorage.setItem(S,String(Date.now()));}catch(x){}if(f.requestSubmit){f.requestSubmit(s||undefined);}else{if(s&&s.name){var i=document.createElement("input");i.type="hidden";i.name=s.name;i.value=s.value;f.appendChild(i);}f.submit();}},${10_000});},true);})();`;

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
