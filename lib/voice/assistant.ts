/**
 * Front-desk conversation turn for voice (§Voice deliverables 4 & 5).
 *
 * Deterministic by default (greetings, intent detection, language switching) with an
 * optional injected LLM port for richer replies. Facts come only from what the caller
 * injected — nothing about a business is invented. Handoff intent always wins over reply
 * generation so a caller asking for a human never talks to a bot loop.
 */
import { detectHandoffIntent } from "./handoff";
import { detectLanguage, detectLanguageSwitch } from "./language";
import type { VoiceLanguage } from "./types";

export type AssistantTurnInput = {
  transcript: string;
  language: VoiceLanguage;
  businessName: string;
  /** Owner-provided facts (hours, address, offerings) — never fabricated here. */
  facts?: string[];
  turnIndex: number;
  /** Optional richer reply generator (resolved application AI provider). */
  llm?: (input: { system: string; prompt: string; facts: string[] }) => Promise<string | null>;
};

export type AssistantIntent = "ANSWER" | "HANDOFF" | "GOODBYE";

export type AssistantTurn = {
  language: VoiceLanguage;
  languageSwitched: boolean;
  intent: AssistantIntent;
  reply: string;
};

const GREETING_EN = (name: string) =>
  `Thank you for calling ${name}. This is the JATA AI front desk. How can I help you today?`;
const GREETING_SW = (name: string) =>
  `Asante kwa kupiga simu ${name}. Nina mbele ya mezajangu ya JATA. Nikusaidieje leo?`;

const HANDOFF_ACK_EN = "Let me connect you with a member of the team. Please hold for a moment.";
const HANDOFF_ACK_SW = "Nita kuunganisha na mmoja wa timu. Tafadhali subiri kidogo.";

const GOODBYE_EN = "Thank you for calling. Goodbye.";
const GOODBYE_SW = "Asante kwa kupiga simu. Kwaheri.";

const BYE_PATTERN = /\b(bye|goodbye|see you|that's all|that is all|kwaheri|tutaonana|hakuna kitu|no more)\b/i;

export async function runAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurn> {
  const transcript = input.transcript.trim();

  // 1. Explicit language switch (caller's words only).
  const switched = detectLanguageSwitch(transcript, input.language);
  const language = switched ?? (input.turnIndex === 0 ? detectLanguage(transcript, input.language) : input.language);

  // 2. Handoff intent — highest priority.
  if (detectHandoffIntent(transcript)) {
    return {
      language,
      languageSwitched: switched !== null,
      intent: "HANDOFF",
      reply: language === "sw" ? HANDOFF_ACK_SW : HANDOFF_ACK_EN,
    };
  }

  // 3. Goodbye.
  if (input.turnIndex > 0 && BYE_PATTERN.test(transcript)) {
    return {
      language,
      languageSwitched: switched !== null,
      intent: "GOODBYE",
      reply: language === "sw" ? GOODBYE_SW : GOODBYE_EN,
    };
  }

  // 4. First turn: greeting regardless of content.
  if (input.turnIndex === 0) {
    return {
      language,
      languageSwitched: switched !== null,
      intent: "ANSWER",
      reply: language === "sw" ? GREETING_SW(input.businessName) : GREETING_EN(input.businessName),
    };
  }

  // 5. Reply: LLM port when injected, otherwise a deterministic fallback that never invents
  //    business facts (it defers to the owner-provided facts list).
  if (input.llm) {
    try {
      const generated = await input.llm({
        system:
          language === "sw"
            ? "You are the telephone front desk for a Kenyan business. Answer ONLY from the provided facts. Reply in Kiswahili. Keep it under 60 words. If the answer is not in the facts, offer to connect a human."
            : "You are the telephone front desk for a Kenyan business. Answer ONLY from the provided facts. Reply in English. Keep it under 60 words. If the answer is not in the facts, offer to connect a human.",
        prompt: transcript,
        facts: input.facts ?? [],
      });
      if (generated && generated.trim()) {
        return { language, languageSwitched: switched !== null, intent: "ANSWER", reply: generated.trim().slice(0, 600) };
      }
    } catch {
      // Fall through to the deterministic reply — speech failure must not drop the caller.
    }
  }

  const factsLine = (input.facts ?? []).slice(0, 2).join(" ");
  const fallback =
    language === "sw"
      ? `Nimesikia swali lako kuhusu ${"mambo ya biashara"}. ${factsLine || "Maelezo yanatoka kwa mmiliki wa biashara."} Ukitaka mtu wa kawaida, sema "mtu".`
      : `I understand your question. ${factsLine || "Details come from the business owner's own information."} If you would like a person, just say "agent".`;

  return { language, languageSwitched: switched !== null, intent: "ANSWER", reply: fallback };
}

/** Bundle the owner-controlled facts a voice turn may cite (injected by the worker). */
export function buildVoiceFacts(input: { businessName: string; phone?: string | null; openingHours?: string | null; services?: string[] }): string[] {
  const facts: string[] = [`Business name: ${input.businessName}`];
  if (input.openingHours) facts.push(`Opening hours: ${input.openingHours}`);
  if (input.services?.length) facts.push(`Services: ${input.services.slice(0, 8).join(", ")}`);
  return facts;
}
