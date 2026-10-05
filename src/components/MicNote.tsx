import { Icon } from "./Icon";
import { MoreInfo } from "./MoreInfo";

/**
 * WHAT THE MICROPHONE DOES, SAID WHERE THE MICROPHONE IS.
 *
 * Four places open a mic — the player's hole-by-hole card and full card, the
 * organizer's score entry, and `VoiceAsk` — and none of them told anybody what
 * happens to what they say. A golfer handed a phone that wants microphone
 * permission has no way to know whether it is listening for the rest of the
 * round.
 *
 * EVERY CLAIM HERE IS ABOUT THIS APP, AND THAT LIMIT IS THE POINT. A first
 * draft said "what you say is read on this phone — it never leaves it", which
 * is FALSE and would have been a false privacy promise: `startDictation` uses
 * the browser's Web Speech API, and Chrome's implementation sends audio to a
 * Google service to transcribe it. That is the browser's behaviour, disclosed
 * by the browser's own permission prompt, and it is not ours to deny.
 *
 * What IS checkable in this repository, and is all this says:
 *
 *   only while pressed    `startDictation` is called inside a button handler and
 *                         `stop()` runs on the next press, on `onEnd` and on
 *                         `onError`. Grep `startDictation` — four call sites,
 *                         every one behind a press. Nothing listens in the
 *                         background.
 *   no recording          only the transcript STRING reaches React state.
 *                         `dictation.ts` holds no audio and contains no `fetch`,
 *                         no `POST` and no upload of any kind; `interimResults`
 *                         is false, so not even partial text is streamed.
 *   used for the card     the transcript goes to `parseStrokesTranscript` or
 *                         `answerVoiceQuery`, both pure functions in
 *                         `src/lib/domain`. Only the SCORES are saved, by the
 *                         same Save the keyboard uses.
 *
 * ONE COMPONENT rather than a sentence typed at four call sites, so they cannot
 * drift into promising different things — a worse failure than usual when the
 * subject is privacy. `mic-says-what-it-does.test.tsx` pins that every mic
 * renders it, and that this file claims nothing about where the browser sends
 * audio.
 *
 * SHORT, WITH THE WHOLE PROMISE AN ⓘ AWAY (Ajay, 2026-10-05). Four lines of
 * it sat above the score pad on every hole of every round. The short line says
 * the two facts a golfer actually asks — is it always listening, is it kept —
 * and the full sentence is one tap behind it. `MoreInfo` keeps those words in
 * the page, so every assertion below about what it says still reads them, and
 * the short line is held to the same no-false-promise list.
 */
export const MIC_SHORT = "Listens only while pressed. Nothing is recorded.";

export function MicNote({ style }: { style?: React.CSSProperties }) {
  return (
    <MoreInfo short={MIC_SHORT} style={style}>
      <span style={{ display: "flex", gap: 6 }}>
        {/* The same name the two existing mic buttons use — Phosphor's, not a
            bare "microphone", which renders nothing. */}
        <Icon name="ph ph-microphone" aria-hidden />
        <span>
          Only on while you use this button, never in the background. Nothing you say is recorded or
          kept — just the numbers, into the card.
        </span>
      </span>
    </MoreInfo>
  );
}
