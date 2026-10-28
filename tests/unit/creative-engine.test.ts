/**
 * Creative engine honesty — intent parsing and the capability truth table.
 *
 * The brief's core safety rule is "no fake generation": with no durable storage and no
 * animation/video provider in this deployment, the capability matrix must say so, and the
 * built-in provider must never be described as photographic.
 */
import { describe, expect, it } from "vitest";
import { parseCreativeInstruction } from "@/lib/creative/intent";
import { capabilityForMediaType, creativeCapabilities } from "@/lib/creative/capabilities";
import { IMAGE_PRESETS } from "@/lib/ai/promptBuilder";

describe("parseCreativeInstruction — the brief's example commands", () => {
  it("understands a poster request", () => {
    const intent = parseCreativeInstruction("Create a premium poster advertising my salon's weekend offer");
    expect(intent.mediaType).toBe("poster");
    expect(intent.followUp).toBeNull();
    expect(intent.understood).toMatch(/poster/i);
  });

  it("understands a website hero request", () => {
    const intent = parseCreativeInstruction("Make my grocery website look fresh, modern and trustworthy");
    expect(intent.mediaType).toBe("hero");
    expect(intent.aspect).toBe("wide");
  });

  it("understands a photo-improvement request and asks for the photo when none is chosen", () => {
    const withoutPhoto = parseCreativeInstruction("Improve the lighting, composition and background of this uploaded product photo");
    expect(withoutPhoto.mediaType).toBe("edit");
    expect(withoutPhoto.followUp).toMatch(/which photo/i);
    expect(withoutPhoto.editOperations.join(" ")).toMatch(/lighting/);
    expect(withoutPhoto.editOperations.join(" ")).toMatch(/background/);

    const withPhoto = parseCreativeInstruction("Improve the lighting of this photo", { hasReferenceImage: true });
    expect(withPhoto.followUp).toBeNull();
  });

  it("understands WhatsApp Status as a vertical video — and says what it is", () => {
    const intent = parseCreativeInstruction("Prepare a vertical video advert for WhatsApp Status");
    expect(intent.mediaType).toBe("video");
    expect(intent.aspect).toBe("vertical");
  });

  it("understands animation and iterative follow-ups", () => {
    expect(parseCreativeInstruction("Create a short animated promotion using my business images").mediaType).toBe("animation");
    const followUp = parseCreativeInstruction("Make it brighter");
    expect(followUp.isFollowUp).toBe(true);
    expect(parseCreativeInstruction("Use a black and gold background").isFollowUp).toBe(true);
  });

  it("asks one question for an empty instruction instead of guessing", () => {
    expect(parseCreativeInstruction("").followUp).toBeTruthy();
    expect(parseCreativeInstruction("   ").followUp).toBeTruthy();
  });

  it("only ever names real Studio presets", () => {
    const presetKeys = new Set(IMAGE_PRESETS.map((preset) => preset.key));
    for (const text of ["hero image please", "poster for my offer", "a product photo", "wide banner"]) {
      expect(presetKeys.has(parseCreativeInstruction(text).preset), text).toBe(true);
    }
  });

  it("respects an explicit media-type choice over its own guess", () => {
    const intent = parseCreativeInstruction("something nice for Saturday", { forcedMediaType: "poster" });
    expect(intent.mediaType).toBe("poster");
  });
});

describe("creativeCapabilities — no fake generation is possible", () => {
  const matrix = creativeCapabilities();
  const byKey = new Map(matrix.capabilities.map((capability) => [capability.key, capability]));

  it("always offers the starter gallery, which needs no provider", () => {
    expect(byKey.get("starter-gallery")?.state).toBe("available");
  });

  it("reports animation and video unavailable with the owner action", () => {
    expect(byKey.get("animation")?.state).toBe("unavailable");
    expect(byKey.get("video")?.state).toBe("unavailable");
    expect(byKey.get("video")?.ownerAction).toMatch(/video provider/i);
    expect(capabilityForMediaType("video", matrix).state).toBe("unavailable");
  });

  it("does not claim generation is available while output cannot be saved", () => {
    // In the test environment no durable storage provider is implemented, so a "generated"
    // asset could never be persisted. Offering generation here would be the exact fake
    // success the brief forbids.
    if (!matrix.durableStorage) {
      expect(byKey.get("image-generation")?.state).toBe("unavailable");
      expect(byKey.get("image-generation")?.reason).toMatch(/nowhere durable|not.*pretend|storage/i);
      expect(byKey.get("upload-photo")?.state).toBe("unavailable");
    }
  });

  it("never calls the built-in artwork provider photographic", () => {
    const keys = ["image-generation", "ai-photo-editing"];
    for (const key of keys) expect(byKey.get(key)?.reason, key).toBeTruthy();
    if (matrix.providerLabel.toLowerCase().includes("built-in") || matrix.providerLabel.toLowerCase().includes("jata")) {
      expect(matrix.photorealistic).toBe(false);
    }
  });

  it("keeps secrets out of the capability matrix", () => {
    const serialized = JSON.stringify(matrix);
    expect(serialized).not.toMatch(/sk-|api[_-]?key\s*[:=]\s*\S+/i);
    expect(serialized).not.toContain("OPENAI_API_KEY=");
  });

  it("gives every capability an owner-facing reason", () => {
    for (const capability of matrix.capabilities) {
      expect(capability.label, capability.key).toBeTruthy();
      expect(capability.reason.length, capability.key).toBeGreaterThan(20);
      if (capability.state === "unavailable") expect(capability.ownerAction, capability.key).toBeTruthy();
    }
  });
});
