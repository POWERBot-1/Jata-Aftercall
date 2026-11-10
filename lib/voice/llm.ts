/**
 * Grounded reply provider for the voice front desk (§Voice deliverable 4).
 *
 * The worker must never run with an implicit "no brain": this module resolves the configured
 * application AI provider into an explicit LLM port, or null (the deterministic assistant
 * fallback stays fully functional). The selected provider's credential is part of voice
 * readiness, so a deployment that can sell Voice has a grounded reply path wired.
 *
 * Fail-closed by design: any provider error, timeout or malformed response yields null and
 * the turn falls back to the deterministic facts-based reply — speech must never drop the
 * caller, and nothing outside the injected owner facts is ever generated.
 */
import type { ResolvedSpeech } from "@/lib/voice/speech";

export type LlmTurn = (input: { system: string; prompt: string; facts: string[] }) => Promise<string | null>;

type LlmEnvironment = Partial<Record<"VOICE_AI_PROVIDER" | "OPENAI_API_KEY" | "VOICE_LLM_MODEL" | "OPENAI_BASE_URL", string>>;

const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 8_000;

/**
 * Resolve the configured provider into a grounded reply function.
 * Returns null whenever no approved, credentialed provider is configured.
 */
export function resolveLlmAdapter(env: LlmEnvironment = process.env as LlmEnvironment): LlmTurn | null {
  const provider = (env.VOICE_AI_PROVIDER ?? "").trim();
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (provider !== "openai" || !apiKey) return null;
  const model = (env.VOICE_LLM_MODEL ?? "").trim() || DEFAULT_MODEL;
  const baseUrl = (env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1";

  return async ({ system, prompt, facts }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          max_tokens: 160,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: `Owner-provided business facts:\n${facts.join("\n") || "(none)"}\n\nCustomer said: ${prompt}`,
            },
          ],
        }),
      });
      if (!response.ok) return null;
      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim() ? content.trim() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Speech + reply provider bundle (kept together so worker deps stay one seam). */
export type SpeechAndLlm = { speech: ResolvedSpeech | null; llm: LlmTurn | null };
