/**
 * Channel-Neutral Architecture (§40)
 *
 * Pipeline:
 * Channel Message -> Normalized Conversation Event -> AI Business Front Desk Engine
 * -> Normalized Response -> Channel Delivery
 *
 * Supports:
 * - web_chat
 * - business_page
 * - whatsapp
 * - instagram
 * - facebook
 * - sms
 * - email
 * - voice
 */

import type { ChannelType } from "./ai-conversation";
import { handleAIFrontDeskTurn, type AIFrontDeskTurnResult } from "./ai-front-desk";

export const SUPPORTED_CHANNELS: readonly ChannelType[] = [
  "web_chat",
  "business_page",
  "whatsapp",
  "instagram",
  "facebook",
  "sms",
  "email",
  "voice",
] as const;

export type NormalizedChannelEvent = {
  businessId: string;
  channel: ChannelType;
  conversationId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  text: string;
  preview?: boolean;
  orderId?: string | null;
  paymentReference?: string | null;
  receivedAt: string;
};

export type NormalizedChannelDelivery = {
  channel: ChannelType;
  businessId: string;
  conversationId: string;
  replyText: string;
  responseType: AIFrontDeskTurnResult["responseType"];
  suggestedActions: string[];
  escalatedToHuman: boolean;
  cartSummary: AIFrontDeskTurnResult["cartSummary"];
  preview: boolean;
  deliveredAt: string;
  turnResult: AIFrontDeskTurnResult;
};

export function normalizeIncomingChannelMessage(raw: {
  businessId: string;
  channel?: string | null;
  message: string;
  conversationId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  preview?: boolean;
  orderId?: string | null;
  paymentReference?: string | null;
}): NormalizedChannelEvent {
  const rawChannel = typeof raw.channel === "string" ? raw.channel.trim().toLowerCase() : "web_chat";
  const channel: ChannelType = (SUPPORTED_CHANNELS as readonly string[]).includes(rawChannel)
    ? (rawChannel as ChannelType)
    : "web_chat";

  return {
    businessId: raw.businessId,
    channel,
    conversationId: raw.conversationId || null,
    customerName: raw.customerName || null,
    customerPhone: raw.customerPhone || null,
    text: String(raw.message || "").trim(),
    preview: Boolean(raw.preview),
    orderId: raw.orderId || null,
    paymentReference: raw.paymentReference || null,
    receivedAt: new Date().toISOString(),
  };
}

export async function processNormalizedChannelEvent(
  event: NormalizedChannelEvent,
): Promise<NormalizedChannelDelivery> {
  const turnResult = await handleAIFrontDeskTurn({
    businessId: event.businessId,
    message: event.text,
    conversationId: event.conversationId,
    channel: event.channel,
    preview: event.preview,
    customerName: event.customerName,
    customerPhone: event.customerPhone,
    orderId: event.orderId,
    paymentReference: event.paymentReference,
  });

  return {
    channel: event.channel,
    businessId: event.businessId,
    conversationId: turnResult.conversationId,
    replyText: turnResult.reply,
    responseType: turnResult.responseType,
    suggestedActions: turnResult.suggestedActions,
    escalatedToHuman: turnResult.escalatedToHuman,
    cartSummary: turnResult.cartSummary,
    preview: turnResult.preview,
    deliveredAt: new Date().toISOString(),
    turnResult,
  };
}
