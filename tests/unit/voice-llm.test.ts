/**
 * Grounded reply provider (voice LLM port): request/response handling with a mocked fetch —
 * no network egress. Fail-closed: missing configuration yields null, provider errors yield
 * null, and only the provider's message content is ever returned.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLlmAdapter } from "@/lib/voice/llm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("voice LLM adapter", () => {
  it("resolves only for a credentialed openai provider", () => {
    expect(resolveLlmAdapter({})).toBeNull();
    expect(resolveLlmAdapter({ VOICE_AI_PROVIDER: "loopback" })).toBeNull();
    expect(resolveLlmAdapter({ VOICE_AI_PROVIDER: "openai" })).toBeNull();
    expect(resolveLlmAdapter({ VOICE_AI_PROVIDER: "openai", OPENAI_API_KEY: "  " })).toBeNull();
    expect(typeof resolveLlmAdapter({ VOICE_AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" })).toBe("function");
  });

  it("sends the system prompt, facts and transcript and returns the message content", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: " We open at 6pm on Saturdays." } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const llm = resolveLlmAdapter({ VOICE_AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" })!;
    const reply = await llm({
      system: "Answer only from facts.",
      prompt: "what time do you close?",
      facts: ["Opening hours: 08:00–18:00"],
    });
    expect(reply).toBe("We open at 6pm on Saturdays.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/chat/completions");
    expect(String((init.headers as Record<string, string>).Authorization)).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBeTruthy();
    expect(body.messages[0]).toMatchObject({ role: "system", content: "Answer only from facts." });
    expect(body.messages[1].content).toContain("Opening hours: 08:00–18:00");
    expect(body.messages[1].content).toContain("what time do you close?");
  });

  it("fails closed on provider errors and malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "boom" }, false, 500)));
    const llm = resolveLlmAdapter({ VOICE_AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" })!;
    expect(await llm({ system: "s", prompt: "p", facts: [] })).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ choices: [] })));
    expect(await llm({ system: "s", prompt: "p", facts: [] })).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await llm({ system: "s", prompt: "p", facts: [] })).toBeNull();
  });

  it("treats an empty completion as null so the deterministic fallback answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ choices: [{ message: { content: "   " } }] })));
    const llm = resolveLlmAdapter({ VOICE_AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" })!;
    expect(await llm({ system: "s", prompt: "p", facts: [] })).toBeNull();
  });
});
