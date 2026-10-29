import nodemailer, { type SMTPTransportOptions } from "nodemailer";
import { getBaseUrl } from "./url";

export type PasswordResetMailConfig = {
  smtpUrl: string;
  from: string;
  baseUrl: URL;
};

/**
 * Validate configuration without exposing credentials to a caller or to browser code.
 *
 * The link base URL resolves through the app's canonical chain (lib/url.ts): an explicit
 * non-localhost PUBLIC_BASE_URL/NEXTAUTH_URL wins, then the stable Vercel production URL.
 * Requiring PUBLIC_BASE_URL outright disabled recovery on any deployment that relied on the
 * Vercel-provided production URL — the reset API answered 503 even with a working SMTP relay.
 */
export function getPasswordResetMailConfig(env: NodeJS.ProcessEnv = process.env): PasswordResetMailConfig | null {
  const smtpUrl = String(env.PASSWORD_RESET_SMTP_URL ?? "").trim();
  const from = String(env.PASSWORD_RESET_FROM ?? "").trim();
  if (!smtpUrl || !from || /[\r\n]/.test(from)) return null;

  try {
    const smtp = new URL(smtpUrl);
    if (!["smtp:", "smtps:"].includes(smtp.protocol) || !smtp.hostname) return null;
    // Never build recovery links from Host/Origin/Forwarded headers — only the trusted
    // deployment URL resolution in getBaseUrl() is allowed.
    const baseUrlText = getBaseUrl(env);
    const baseUrl = new URL(baseUrlText);
    if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) return null;
    if (env.NODE_ENV === "production" && baseUrl.protocol !== "https:") return null;
    return { smtpUrl, from, baseUrl };
  } catch {
    return null;
  }
}

export function isPasswordResetEmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getPasswordResetMailConfig(env) !== null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const config = getPasswordResetMailConfig();
  if (!config) throw new Error("password_reset_delivery_unconfigured");

  // Construct from the trusted deployment URL, never from Host/Origin/Forwarded request headers.
  const resetUrl = new URL("/reset-password", config.baseUrl);
  resetUrl.hash = new URLSearchParams({ token }).toString();
  const link = resetUrl.toString();
  const text = [
    "We received a request to reset your JATA AFTERCALL password.",
    "",
    `Use this one-time link within 30 minutes: ${link}`,
    "",
    "If you did not request this, you can ignore this email. Your password will not change.",
  ].join("\n");
  const htmlLink = escapeHtml(link);
  const html = [
    "<p>We received a request to reset your JATA AFTERCALL password.</p>",
    `<p><a href="${htmlLink}">Reset your password</a></p>`,
    "<p>This one-time link expires in 30 minutes.</p>",
    "<p>If you did not request this, you can ignore this email. Your password will not change.</p>",
  ].join("\n");

  const transportOptions: SMTPTransportOptions = {
    url: config.smtpUrl,
    requireTLS: true,
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      // Optional PEM bundle for relays whose certificate chains to a private CA. When unset,
      // the platform trust store is used unchanged — never weaker than the system defaults.
      ...(String(process.env.PASSWORD_RESET_SMTP_CA ?? "").trim()
        ? { ca: String(process.env.PASSWORD_RESET_SMTP_CA).trim() }
        : {}),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  };
  const transporter = nodemailer.createTransport(transportOptions);
  try {
    await transporter.sendMail({
      from: config.from,
      to,
      subject: "Reset your JATA AFTERCALL password",
      text,
      html,
    });
  } finally {
    transporter.close();
  }
}
