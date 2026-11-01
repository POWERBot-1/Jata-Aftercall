import { afterEach, describe, expect, it, vi } from "vitest";
import { getShareableAILink } from "@/lib/qr";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shareable AI link origin", () => {
  it("uses the official JATA AFTERCALL domain when no public origin is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getShareableAILink("sample-business").url).toBe(
      "https://jataaftercall.co.ke/b/sample-business/ai",
    );
  });

  it("honours the configured public app origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://preview.example.test/");
    expect(getShareableAILink("sample-business").url).toBe(
      "https://preview.example.test/b/sample-business/ai",
    );
  });

  it("honours an explicit origin ahead of environment configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://preview.example.test");
    expect(getShareableAILink("sample-business", "https://jata-aftercall.vercel.app/").url).toBe(
      "https://jata-aftercall.vercel.app/b/sample-business/ai",
    );
  });
});
