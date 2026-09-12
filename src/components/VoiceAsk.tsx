"use client";
import { useRef, useState } from "react";
import { parseVoiceQuery, answerVoiceQuery, type VoiceContext } from "@/lib/domain/voice-query";
import { Icon } from "./Icon";
import { startDictation, type Dictation } from "@/lib/dictation";

/**
 * Ask the round a question out loud.
 *
 * The other mics on this screen write scores; this one reads them back. On a
 * tee with a glove on, "what do I play off" is faster asked than found, and
 * the answer already exists in the snapshot the screen was rendered with —
 * so it is answered locally, with no network call and no model.
 *
 * Every answer comes from `answerVoiceQuery`, which is honest when the data
 * isn't there. That matters more here than anywhere: a confidently invented
 * handicap gets played off, and the card is wrong before the first tee shot.
 */
export function VoiceAsk({ context }: { context: VoiceContext }) {
  const [listening, setListening] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const recognitionRef = useRef<Dictation | null>(null);

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    setAnswer(null);
    setHeard(null);
    const started = startDictation({
      onTranscript: (transcript) => {
        setHeard(transcript);
        setAnswer(answerVoiceQuery(parseVoiceQuery(transcript), context));
        setListening(false);
      },
      onError: () => {
        setAnswer("Didn’t catch that — try again.");
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    // The wording is this screen's: a player asking a question is told voice
    // is unavailable, not told to type the scores.
    if (!started) {
      setAnswer("Voice isn’t supported in this browser.");
      return;
    }
    recognitionRef.current = started;
    setListening(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={toggle}
          className={listening ? "btn btn-primary" : "btn btn-secondary"}
          aria-pressed={listening}
          aria-label="Ask a question about this round"
        >
          <Icon name={listening ? "ph-fill ph-microphone" : "ph ph-microphone"} />
          {listening ? "Listening…" : "Ask"}
        </button>
        <span className="text-muted" style={{ fontSize: 12 }}>
          “What’s my handicap for round 2?” · “Who am I playing?” · “Where do I stand?”
        </span>
      </div>
      {/* Spoken input is misheard often enough that the answer alone is not
          enough — showing the transcript is how someone knows whether to
          trust it or simply say it again. */}
      {answer && (
        <div
          role="status"
          aria-live="polite"
          style={{
            fontSize: 13,
            padding: "8px 10px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: "1px solid var(--color-divider)",
          }}
        >
          {heard && (
            <div className="text-muted" style={{ fontSize: 11.5, marginBottom: 2 }}>
              Heard: “{heard}”
            </div>
          )}
          {answer}
        </div>
      )}
    </div>
  );
}
