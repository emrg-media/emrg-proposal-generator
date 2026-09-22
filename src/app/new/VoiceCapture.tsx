"use client";

import { useEffect, useRef, useState } from "react";

// Voice intake (brief §5, option 3). Uses the browser's own speech
// recognition, so nothing is uploaded, there is no API key and no per-minute
// cost. Where the browser doesn't support it the textarea still works, so the
// feature degrades to typing rather than disappearing.

// Minimal shape of the Web Speech API — it isn't in the TS DOM lib.
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike {
  isFinal: boolean; 0: SpeechRecognitionAlternativeLike; length: number;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function VoiceCapture({ value, onChange }: {
  value: string; onChange: (v: string) => void;
}) {
  // Assume support until proven otherwise. Probing in an effect would either
  // cause a hydration mismatch (window is absent on the server) or a cascading
  // render, and start() already reports the truth the moment it is used.
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Held in a ref so the recognition callback always appends to the latest text.
  const committedRef = useRef(value);

  useEffect(() => { committedRef.current = value; }, [value]);
  // Always release the microphone when this component goes away.
  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  function start() {
    const Ctor = getRecognition();
    if (!Ctor) { setSupported(false); return; }

    setError("");
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalText = "";
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else pending += result[0].transcript;
      }
      if (finalText) {
        const joined = (committedRef.current + " " + finalText.trim()).trim();
        committedRef.current = joined;
        onChange(joined);
      }
      setInterim(pending);
    };

    recognition.onerror = (e) => {
      setError(e.error === "not-allowed"
        ? "Microphone access was blocked. Allow it in your browser, then try again."
        : `Speech recognition stopped: ${e.error}`);
      setListening(false);
    };

    recognition.onend = () => { setListening(false); setInterim(""); };

    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: "#111111" }}>
          Speak the details
        </p>
        {supported && (
          <button type="button" onClick={listening ? stop : start}
            className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] uppercase px-3 py-1.5 rounded border-2 transition-colors"
            style={listening
              ? { borderColor: "var(--emrg-red)", background: "var(--emrg-red)", color: "#fff" }
              : { borderColor: "#d6d3d1", color: "#57534e", background: "#fff" }}>
            <span className="w-[7px] h-[7px] rounded-full"
              style={{ background: listening ? "#fff" : "var(--emrg-red)" }} />
            {listening ? "Stop" : "Start talking"}
          </button>
        )}
      </div>

      {!supported && (
        <p className="text-[12.5px] mb-2" style={{ color: "#7a5309" }}>
          This browser can&apos;t do speech recognition — type or paste below instead. Chrome and Safari both work.
        </p>
      )}

      <textarea
        value={value + (interim ? ` ${interim}` : "")}
        onChange={(e) => { committedRef.current = e.target.value; onChange(e.target.value); }}
        placeholder={supported
          ? 'Tap "Start talking", then speak naturally: "Google holiday party, 200 people, Jane Doe is the planner, December 14th, they want entertainment, AV and staffing."'
          : "Type the details here."}
        className="w-full h-40 text-[14px] resize-none bg-transparent outline-none leading-relaxed text-stone-900 placeholder-stone-400" />

      {listening && (
        <p className="text-[12px] mt-1" style={{ color: "var(--emrg-red)" }}>
          Listening… speak naturally, then press Stop.
        </p>
      )}
      {error && <p className="text-[12.5px] mt-1" style={{ color: "var(--emrg-red)" }}>{error}</p>}
    </>
  );
}
