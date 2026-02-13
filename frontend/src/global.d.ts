declare const __APP_VERSION__: string;

interface SpeechRecognitionResultAlternative {
  transcript: string;
}

interface SpeechRecognitionResultEntry {
  [index: number]: SpeechRecognitionResultAlternative;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: {
    [index: number]: SpeechRecognitionResultEntry;
  };
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface Window {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}
