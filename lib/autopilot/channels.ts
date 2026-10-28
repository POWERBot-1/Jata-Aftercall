/**
 * JATA Autopilot — Honest Omnichannel Compatibility & Readiness Matrix (§8)
 *
 * Uses official APIs only. Never claims universal compatibility, never uses
 * browser automation/scraping, and reports real deployment readiness per channel.
 */

import type { ChannelCompatibilityStatus } from "./types";

export interface AutopilotChannelEntry {
  channelKey: string;
  label: string;
  status: ChannelCompatibilityStatus;
  inboundCapable: boolean;
  outboundCapable: boolean;
  detail: string;
}

export function getAutopilotChannelMatrix(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): AutopilotChannelEntry[] {
  const hasSmtp = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  const hasSms = Boolean(env.SMS_API_KEY && env.SMS_API_URL);
  const hasWaCloud = Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);

  return [
    {
      channelKey: "command_center_web",
      label: "JATA Autopilot Command Center & Storefront Web Chat",
      status: "SUPPORTED AND VERIFIED",
      inboundCapable: true,
      outboundCapable: true,
      detail: "Native authenticated Command Center and JATA Aftercall public storefront chat.",
    },
    {
      channelKey: "whatsapp_click_to_chat",
      label: "WhatsApp Click-to-Chat Deep Link (wa.me)",
      status: "SUPPORTED AND VERIFIED",
      inboundCapable: false,
      outboundCapable: true,
      detail: "Owner/customer-initiated deep link; cannot send unattended background campaigns.",
    },
    {
      channelKey: "whatsapp_business_cloud",
      label: "WhatsApp Business Cloud API",
      status: hasWaCloud
        ? "IMPLEMENTED BUT NOT LIVE-VERIFIED"
        : "REQUIRES PROVIDER APPROVAL",
      inboundCapable: hasWaCloud,
      outboundCapable: hasWaCloud,
      detail: hasWaCloud
        ? "Credentials present; outbound messages outside the 24-hour customer window require Meta-approved templates."
        : "Requires Meta WhatsApp Business Platform WABA verification, phone number ID, and approved message templates.",
    },
    {
      channelKey: "sms_gateway",
      label: "SMS Transactional & Consented Alerts",
      status: hasSms
        ? "IMPLEMENTED BUT NOT LIVE-VERIFIED"
        : "REQUIRES CREDENTIALS OR OWNER AUTHORIZATION",
      inboundCapable: false,
      outboundCapable: hasSms,
      detail: hasSms
        ? "SMS gateway credentials configured via lib/notification.ts; honours STOP/ACHA opt-outs and EAT quiet hours."
        : "Configure SMS_API_URL and SMS_API_KEY (e.g., Africa's Talking) and Sender ID registration to dispatch live SMS.",
    },
    {
      channelKey: "email_smtp",
      label: "Email (SMTP / Transactional)",
      status: hasSmtp
        ? "IMPLEMENTED BUT NOT LIVE-VERIFIED"
        : "REQUIRES CREDENTIALS OR OWNER AUTHORIZATION",
      inboundCapable: false,
      outboundCapable: hasSmtp,
      detail: hasSmtp
        ? "SMTP transport configured; outbound emails include opt-out handling and quiet-hour checks."
        : "Configure SMTP_HOST, SMTP_USER, and SMTP_PASS to enable live outbound email delivery.",
    },
    {
      channelKey: "voice_command_center",
      label: "Owner Push-to-Talk Voice Briefs (Web Audio)",
      status: "IMPLEMENTED BUT NOT LIVE-VERIFIED",
      inboundCapable: true,
      outboundCapable: false,
      detail: "Authenticated Command Center microphone capture with mandatory editable transcript confirmation before any write action.",
    },
    {
      channelKey: "pstn_inbound_telephony",
      label: "PSTN / SIP Inbound Phone Calls",
      status: "NOT SUPPORTED",
      inboundCapable: false,
      outboundCapable: false,
      detail: "Direct PSTN telephony streaming requires external SIP/Twilio/Africa's Talking Voice trunking not provisioned in this phase.",
    },
    {
      channelKey: "instagram_facebook_messenger",
      label: "Instagram Messaging & Facebook Messenger Graph API",
      status: "REQUIRES PROVIDER APPROVAL",
      inboundCapable: false,
      outboundCapable: false,
      detail: "Requires Meta App Review (`instagram_manage_messages` / `pages_messaging`) and tenant OAuth page connection.",
    },
    {
      channelKey: "google_business_profile",
      label: "Google Business Profile Q&A / Reviews",
      status: "REQUIRES CREDENTIALS OR OWNER AUTHORIZATION",
      inboundCapable: false,
      outboundCapable: false,
      detail: "Requires verified Google Business Profile OAuth consent from the business owner.",
    },
    {
      channelKey: "tiktok_x_telegram",
      label: "TikTok Business / X / Telegram Bots",
      status: "LIMITED BY PLATFORM API",
      inboundCapable: false,
      outboundCapable: false,
      detail: "Official DM automation APIs are region/partner-restricted; browser scraping is strictly prohibited by JATA policy.",
    },
  ];
}
