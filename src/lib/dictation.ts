/**
 * One way to take dictation from the browser.
 *
 * Three components each did this by hand — the scorer's match-result entry,
 * the stroke-play card, and the player's "where am I?" question — and the
 * duplicated part was never the interesting part:
 *
 *   - the vendor-prefix lookup, four lines of `as unknown as` casting, because
 *     Safari still exposes `webkitSpeechRecognition` and nothing else;
 *   - `lang`, `interimResults` and `maxAlternatives`, set identically;
 *   - digging the words out of `e.results[0][0].transcript`;
 *   - remembering that `onend` fires whether or not anything was heard, so the
 *     button has to be un-pressed from there as well as from `onresult`.
 *
 * What differs between the three is what they do with the sentence, which is
 * the half that belongs in a component.
 *
 * `lang` is "en-US" here, once, rather than in three places. That matters more
 * than it looks: the app already has an open question about wording by
 * country, and a language this app dictates in is a thing it will eventually
 * have to answer — a search for the string now finds one line.
 *
 * NO REACT IN HERE on purpose. It takes callbacks and hands back a stop
 * function, so a component owns its own state shape — one of the three tracks
 * "which field is listening" as a string key and the others as a boolean, and
 * neither had to change.
 */

/** A recogniser that has been started. `stop` is safe to call more than once. */
export interface Dictation {
  stop: () => void;
}

type Recogniser = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop?: () => void;
};

/** Whether this browser can dictate at all — for wording a refusal. */
export function canDictate(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/**
 * Start listening. Returns null when the browser cannot — the CALLER words
 * that, because "type the scores instead" and "type it instead" are different
 * sentences about different screens.
 */
export function startDictation(handlers: {
  onTranscript: (transcript: string) => void;
  /** Nothing usable was heard. `onEnd` still runs afterwards. */
  onError: () => void;
  /** Always runs when the recogniser stops, heard or not. Un-press the button here. */
  onEnd: () => void;
}): Dictation | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => Recogniser)
    | undefined;
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = "en-US";
  // One shot, one answer: a scorer says a result and expects the button to
  // finish, not a running transcript.
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => handlers.onTranscript(e.results[0][0].transcript);
  rec.onerror = () => handlers.onError();
  rec.onend = () => handlers.onEnd();
  rec.start();

  return { stop: () => rec.stop?.() };
}
