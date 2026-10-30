import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessagingProviderAdapter, SendRequest, SendResult } from "./providers";

/** Pinned to Meta's documented v26.0 copy-code authentication template request. */
export const META_GRAPH_VERSION = "v26.0";
export const META_WHATSAPP_KEY = "meta-whatsapp-cloud";

type MetaConfig = { token: string; phoneNumberId: string; appSecret: string; template: string; language: string };
export function metaConfig(): MetaConfig | null {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN || "";
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID || "";
  const appSecret = process.env.META_WHATSAPP_APP_SECRET || "";
  const template = process.env.AGENT_VERIFICATION_WHATSAPP_TEMPLATE_NAME || "";
  const language = process.env.AGENT_VERIFICATION_WHATSAPP_TEMPLATE_LANGUAGE || "";
  if (process.env.META_WHATSAPP_CLOUD_ENABLED !== "true" || process.env.META_WHATSAPP_WEBHOOK_ENABLED !== "true" ||
      (process.env.META_WHATSAPP_VERIFY_TOKEN || "").length < 16 || process.env.META_WHATSAPP_GRAPH_VERSION !== META_GRAPH_VERSION ||
      process.env.AGENT_VERIFICATION_WHATSAPP_TEMPLATE_APPROVED !== "true" || token.length < 16 || token.length > 4096 ||
      !/^\d{5,32}$/.test(phoneNumberId) || appSecret.length < 16 || !/^[a-z0-9_]{1,128}$/.test(template) ||
      !/^[A-Za-z0-9_-]{2,20}$/.test(language)) return null;
  return { token, phoneNumberId, appSecret, template, language };
}

/** Verify Meta's X-Hub-Signature-256 over the exact raw bytes, not reserialized JSON. */
export function verifyMetaSignature(body: Uint8Array, header: string | null, secret: string): boolean {
  if (!secret || !header || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const provided = Buffer.from(header.slice(7), "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Only explicit client-side Graph rejection codes are safe for SMS fallback. Never infer it from
 * a timeout, 5xx, 429, malformed response, generic 4xx, or an exception. */
const DEFINITE_REJECTIONS = new Set([131026, 132000, 132001, 132005, 132007, 132012, 132015]);
export function createMetaWhatsAppProvider(config: MetaConfig, transport: typeof fetch = fetch): MessagingProviderAdapter {
  return {
    key: META_WHATSAPP_KEY, channel: "WHATSAPP", live: true, configured: true,
    supportsWhatsAppAuthenticationTemplates: true,
    async send(request: SendRequest): Promise<SendResult> {
      const template = request.authenticationTemplate;
      if (request.channel !== "WHATSAPP" || request.senderId !== config.phoneNumberId ||
          !/^\+?[1-9]\d{7,14}$/.test(request.to) || !template || template.name !== config.template ||
          template.language !== config.language || !/^\d{6}$/.test(template.code)) {
        return { outcome: "FAILED", code: "INVALID_REQUEST", retryable: false };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await transport(`https://graph.facebook.com/${META_GRAPH_VERSION}/${config.phoneNumberId}/messages`, {
          method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
          signal: controller.signal, redirect: "error", cache: "no-store",
          body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: request.to.replace(/^\+/, ""), type: "template",
            template: { name: template.name, language: { code: template.language }, components: [
              { type: "body", parameters: [{ type: "text", text: template.code }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: template.code }] },
            ] } }),
        });
        // Never store or log Meta's raw body: it may contain personal data or secrets.
        const raw = await response.text();
        if (raw.length > 32_768) return { outcome: "UNKNOWN", code: "MALFORMED_RESPONSE" };
        let data: unknown;
        try { data = JSON.parse(raw); } catch { return { outcome: "UNKNOWN", code: "MALFORMED_RESPONSE" }; }
        const payload = data && typeof data === "object" ? data as { messages?: unknown; error?: { code?: unknown } } : {};
        if (response.ok) {
          const messages = Array.isArray(payload.messages) ? payload.messages : [];
          const id = messages.length === 1 && messages[0] && typeof messages[0] === "object" ? (messages[0] as { id?: unknown }).id : null;
          if (typeof id !== "string" || !/^wamid\.[A-Za-z0-9._:+/=-]{1,240}$/.test(id)) return { outcome: "UNKNOWN", code: "MALFORMED_RESPONSE" };
          return { outcome: "ACCEPTED", providerMessageId: id };
        }
        const errorCode = typeof payload.error?.code === "number" ? payload.error.code : null;
        if (response.status === 429 || errorCode === 4 || errorCode === 80007 || errorCode === 130429) return { outcome: "UNKNOWN", code: "RATE_LIMITED", retryable: true };
        if (response.status === 401 || response.status === 403 || errorCode === 190) return { outcome: "FAILED", code: "AUTH_FAILED", retryable: false };
        if (response.status >= 400 && response.status < 500 && errorCode !== null && DEFINITE_REJECTIONS.has(errorCode)) {
          return { outcome: "FAILED", code: "META_REJECTED", retryable: false, safeToFallback: true };
        }
        return { outcome: "UNKNOWN", code: response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "UNCLASSIFIED_RESPONSE" };
      } catch { return { outcome: "UNKNOWN", code: "NETWORK_OR_TIMEOUT" }; }
      finally { clearTimeout(timeout); }
    },
    async status() { return { status: "UNKNOWN" }; },
    async health() { return { ok: false, state: "DEGRADED", checkedAt: new Date(), message: "Configured; connectivity not tested." }; },
    verifyCallback(rawBody, headers) { return { ok: verifyMetaSignature(Buffer.from(rawBody), headers["x-hub-signature-256"] ?? null, config.appSecret), reason: "Signature checked" }; },
    parseCallbacks() { return []; },
  };
}
