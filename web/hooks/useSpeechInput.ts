import { useCallback, useEffect, useRef, useState } from "react";

type SpeechStatus = "idle" | "listening" | "processing" | "error" | "unsupported";

type SpeechMode = "browser" | "hybrid";

interface UseSpeechInputOptions {
  lang: string;
  mode?: SpeechMode;
  onFinalTranscript: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onError?: (message: string) => void;
}

interface SpeechRecognitionResultItem {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionResultItem;
  [index: number]: SpeechRecognitionResultItem;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    item(index: number): SpeechRecognitionResultLike;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useSpeechInput({
  lang,
  mode = "hybrid",
  onFinalTranscript,
  onInterimTranscript,
  onError,
}: UseSpeechInputOptions) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [error, setError] = useState<string>("");
  const [supported, setSupported] = useState(false);
  const [isRecordingSessionActive, setIsRecordingSessionActive] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const currentTranscriptRef = useRef("");
  const committedTranscriptRef = useRef("");
  const segmentsRef = useRef<string[]>([]);
  const hadErrorRef = useRef(false);
  const isStartingRef = useRef(false);
  const isListeningRef = useRef(false);
  const isStoppingRef = useRef(false);
  const manualStopRequestedRef = useRef(false);
  const shouldKeepRecordingRef = useRef(false);
  const acceptResultsRef = useRef(false);
  const stopFinalizeDoneRef = useRef(false);
  const stopTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const Recognition =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;

    if (!Recognition || (mode !== "browser" && mode !== "hybrid")) {
      // Browser capability is only available after mount; reflect that external state here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupported(false);
      setStatus("unsupported");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = lang || "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const clearStopTimeout = () => {
      if (stopTimeoutRef.current !== null) {
        window.clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
      }
    };

    const finalizeManualStop = () => {
      if (stopFinalizeDoneRef.current) {
        return;
      }
      stopFinalizeDoneRef.current = true;
      clearStopTimeout();

      isStartingRef.current = false;
      isListeningRef.current = false;
      isStoppingRef.current = false;
      acceptResultsRef.current = false;

      const text = `${committedTranscriptRef.current} ${currentTranscriptRef.current}`.trim();
      if (text) {
        setError("");
        onFinalTranscript(text);
      } else {
        setStatus((prev) => (prev === "error" ? prev : "idle"));
      }

      if (onInterimTranscript) {
        onInterimTranscript("");
      }

      currentTranscriptRef.current = "";
      committedTranscriptRef.current = "";
      segmentsRef.current = [];
      hadErrorRef.current = false;
      manualStopRequestedRef.current = false;
      shouldKeepRecordingRef.current = false;
      setIsRecordingSessionActive(false);
    };

    recognition.onstart = () => {
      clearStopTimeout();
      currentTranscriptRef.current = "";
      segmentsRef.current = [];
      hadErrorRef.current = false;
      manualStopRequestedRef.current = false;
      stopFinalizeDoneRef.current = false;
      acceptResultsRef.current = true;
      isStartingRef.current = false;
      isListeningRef.current = true;
      isStoppingRef.current = false;
      setIsRecordingSessionActive(true);
      setError("");
      setStatus("listening");
    };

    recognition.onresult = (event) => {
      if (!acceptResultsRef.current) {
        return;
      }

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = (result[0]?.transcript || "").trim();
        segmentsRef.current[i] = piece;
      }

      currentTranscriptRef.current = segmentsRef.current
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (onInterimTranscript) {
        onInterimTranscript(
          `${committedTranscriptRef.current} ${currentTranscriptRef.current}`.trim(),
        );
      }
    };

    recognition.onerror = (event) => {
      if (manualStopRequestedRef.current && (event.error === "aborted" || event.error === "no-speech")) {
        return;
      }

      const message = event.message || event.error || "speech_recognition_failed";
      hadErrorRef.current = true;
      setError(message);
      setStatus("error");
      if (onError) {
        onError(message);
      }
    };

    recognition.onend = () => {
      isStartingRef.current = false;
      isListeningRef.current = false;
      acceptResultsRef.current = false;

      if (manualStopRequestedRef.current) {
        finalizeManualStop();
        return;
      }

      clearStopTimeout();
      isStoppingRef.current = false;

      const shouldResume = shouldKeepRecordingRef.current && !manualStopRequestedRef.current;
      const currentChunk = currentTranscriptRef.current.trim();

      if (shouldResume) {
        if (currentChunk) {
          committedTranscriptRef.current = `${committedTranscriptRef.current} ${currentChunk}`.trim();
        }
        currentTranscriptRef.current = "";
        segmentsRef.current = [];

        if (onInterimTranscript) {
          onInterimTranscript(committedTranscriptRef.current);
        }

        isStartingRef.current = true;
        acceptResultsRef.current = true;
        setStatus("listening");
        try {
          recognition.start();
          return;
        } catch {
          isStartingRef.current = false;
          acceptResultsRef.current = false;
          shouldKeepRecordingRef.current = false;
          setIsRecordingSessionActive(false);
          setStatus("error");
          setError("speech_recognition_restart_failed");
          if (onError) {
            onError("speech_recognition_restart_failed");
          }
          return;
        }
      }

      if (!hadErrorRef.current && !manualStopRequestedRef.current) {
        setStatus("processing");
      }

      const text = `${committedTranscriptRef.current} ${currentChunk}`.trim();
      if (text) {
        setError("");
        onFinalTranscript(text);
        setStatus("idle");
      } else {
        setStatus((prev) => (prev === "error" ? prev : "idle"));
      }

      if (onInterimTranscript) {
        onInterimTranscript("");
      }

      currentTranscriptRef.current = "";
      committedTranscriptRef.current = "";
      segmentsRef.current = [];
      hadErrorRef.current = false;
      manualStopRequestedRef.current = false;
      shouldKeepRecordingRef.current = false;
      setIsRecordingSessionActive(false);
    };

    recognitionRef.current = recognition;
    setSupported(true);
    setStatus("idle");

    return () => {
      clearStopTimeout();
      try {
        recognition.stop();
      } catch {
        // no-op: stopping an inactive recognizer may throw in some browsers.
      }
      recognitionRef.current = null;
    };
  }, [lang, mode, onError, onFinalTranscript, onInterimTranscript]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      setStatus("unsupported");
      return;
    }

    if (isStartingRef.current || isListeningRef.current || isStoppingRef.current) {
      return;
    }

    try {
      isStartingRef.current = true;
      isListeningRef.current = true;
      hadErrorRef.current = false;
      manualStopRequestedRef.current = false;
      shouldKeepRecordingRef.current = true;
      acceptResultsRef.current = true;
      currentTranscriptRef.current = "";
      committedTranscriptRef.current = "";
      segmentsRef.current = [];
      setError("");
      setIsRecordingSessionActive(true);
      setStatus("listening");
      recognitionRef.current.start();
    } catch {
      isStartingRef.current = false;
      isListeningRef.current = false;
      shouldKeepRecordingRef.current = false;
      setIsRecordingSessionActive(false);
      setStatus("error");
      setError("speech_recognition_start_failed");
      if (onError) {
        onError("speech_recognition_start_failed");
      }
    }
  }, [onError]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) {
      return;
    }

    if ((!isStartingRef.current && !isListeningRef.current) || isStoppingRef.current) {
      return;
    }

    manualStopRequestedRef.current = true;
    shouldKeepRecordingRef.current = false;
    stopFinalizeDoneRef.current = false;
    isStoppingRef.current = true;
    setIsRecordingSessionActive(false);
    setStatus("processing");

    try {
      // Prefer stop() so browsers can flush final recognition results.
      recognitionRef.current.stop();
    } catch {
      // Some browsers throw if stop() is called right after automatic end.
      // Fall back to abort() only when stop() is unavailable.
      try {
        recognitionRef.current.abort?.();
      } catch {
        // Keep this silent to avoid false negative UX.
      }
    }

    // Some engines occasionally never emit onend after stop().
    // Force abort after timeout so the browser can release microphone usage.
    if (stopTimeoutRef.current !== null) {
      window.clearTimeout(stopTimeoutRef.current);
    }
    stopTimeoutRef.current = window.setTimeout(() => {
      if (!isStoppingRef.current || stopFinalizeDoneRef.current) {
        return;
      }
      try {
        recognitionRef.current?.abort?.();
      } catch {
        // no-op
      }

      isStartingRef.current = false;
      isListeningRef.current = false;
      isStoppingRef.current = false;
      acceptResultsRef.current = false;

      const text = `${committedTranscriptRef.current} ${currentTranscriptRef.current}`.trim();
      if (text) {
        setError("");
        onFinalTranscript(text);
      } else {
        setStatus((prev) => (prev === "error" ? prev : "idle"));
      }

      if (onInterimTranscript) {
        onInterimTranscript("");
      }

      currentTranscriptRef.current = "";
      committedTranscriptRef.current = "";
      segmentsRef.current = [];
      hadErrorRef.current = false;
      manualStopRequestedRef.current = false;
      shouldKeepRecordingRef.current = false;
      stopFinalizeDoneRef.current = true;
      stopTimeoutRef.current = null;
      setIsRecordingSessionActive(false);
      if (onError) {
        onError("speech_recognition_stop_timeout");
      }
    }, 1400);
  }, [onError, onFinalTranscript, onInterimTranscript]);

  const clearError = useCallback(() => {
    setError("");
    setStatus((prev) => (prev === "error" ? "idle" : prev));
  }, []);

  return {
    status,
    error,
    supported,
    isListening: isRecordingSessionActive,
    startListening,
    stopListening,
    clearError,
  };
}
