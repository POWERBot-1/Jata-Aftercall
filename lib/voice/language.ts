/**
 * English/Kiswahili conversation language: detection and explicit switching (§Voice deliverable 4).
 * Switching is driven only by the caller's words — never guessed from caller ID or number.
 */
import { isVoiceLanguage, type VoiceLanguage } from "./types";

const TO_SWAHILI = [
  "zungumza kiswahili",
  "kiswahili tafadhali",
  "badili kiswahili",
  "switch to kiswahili",
  "speak kiswahili",
  "in swahili",
  "nisaidie kiswahili",
];

const TO_ENGLISH = [
  "zungumza kiingereza",
  "ingereza tafadhali",
  "badili ingereza",
  "switch to english",
  "speak english",
  "in english",
  "talk english",
];

const SWAHILI_MARKERS = [
  "habari",
  "habari za",
  "niaje",
  "sasa",
  "mambo",
  "karibu",
  "tafadhali",
  "asante",
  "ndio",
  "hapana",
  "sikuhii",
  "vipi",
  "naomba",
  "nataka",
  "bei",
  "muda",
  "wapi",
  "nani",
  "lini",
  "saa",
  "kesho",
  "leo",
  "bila shaka",
  "sawa",
  "nzuri",
  "mzuri",
];

/** Detect an explicit language switch request; null when the caller is not switching. */
export function detectLanguageSwitch(transcript: string, current: VoiceLanguage): VoiceLanguage | null {
  const text = transcript.toLowerCase();
  for (const phrase of TO_SWAHILI) {
    if (text.includes(phrase) && current !== "sw") return "sw";
  }
  for (const phrase of TO_ENGLISH) {
    if (text.includes(phrase) && current !== "en") return "en";
  }
  return null;
}

/** Heuristic language hint for the first utterance (explicit switches always win). */
export function detectLanguage(transcript: string, fallback: VoiceLanguage = "en"): VoiceLanguage {
  const text = transcript.toLowerCase();
  let hits = 0;
  for (const marker of SWAHILI_MARKERS) {
    if (text.includes(marker)) hits += 1;
  }
  return hits >= 2 ? "sw" : fallback;
}

export function isSupportedLanguage(value: string): value is VoiceLanguage {
  return isVoiceLanguage(value);
}
