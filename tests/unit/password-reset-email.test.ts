import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(async (_message: any) => ({ messageId: "not-recorded" })),
  close: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));

import { getPasswordResetMailConfig, isPasswordResetEmailConfigured, sendPasswordResetEmail } from "@/lib/password-reset-email";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close });
});

describe("password recovery delivery configuration", () => {
  it("stays disabled unless SMTP, a sender, and a trusted public base URL are all configured", () => {
    expect(isPasswordResetEmailConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isPasswordResetEmailConfigured({
      PASSWORD_RESET_SMTP_URL: "https://mail.example.test",
      PASSWORD_RESET_FROM: "JATA <reset@example.test>",
      PUBLIC_BASE_URL: "https://jata.example.test",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv)).toBe(false);
    expect(isPasswordResetEmailConfigured({
      PASSWORD_RESET_SMTP_URL: "smtps://mail.example.test",
      PASSWORD_RESET_FROM: "JATA <reset@example.test>\r\nBcc: victim@example.test",
      PUBLIC_BASE_URL: "https://jata.example.test",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("requires HTTPS in production and does not accept credentials in the base URL", () => {
    const base = {
      PASSWORD_RESET_SMTP_URL: "smtps://mailer:secret@mail.example.test:465",
      PASSWORD_RESET_FROM: "JATA <reset@example.test>",
      PUBLIC_BASE_URL: "http://jata.example.test",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv;
    expect(getPasswordResetMailConfig(base)).toBeNull();
    expect(getPasswordResetMailConfig({ ...base, PUBLIC_BASE_URL: "https://user:pass@jata.example.test" })).toBeNull();
  });

  it("sends an expiring one-time link over TLS using only the configured base URL", async () => {
    vi.stubEnv("PASSWORD_RESET_SMTP_URL", "smtps://mailer:secret@mail.example.test:465");
    vi.stubEnv("PASSWORD_RESET_FROM", "JATA <reset@example.test>");
    vi.stubEnv("PUBLIC_BASE_URL", "https://jata.example.test");
    vi.stubEnv("NODE_ENV", "production");

    await sendPasswordResetEmail("owner@example.test", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      url: "smtps://mailer:secret@mail.example.test:465",
      requireTLS: true,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    }));
    const mail = mocks.sendMail.mock.calls[0][0] as any;
    expect(mail.to).toBe("owner@example.test");
    expect(mail.from).toBe("JATA <reset@example.test>");
    expect(mail.text).toContain("https://jata.example.test/reset-password#token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(mail.html).toContain("https://jata.example.test/reset-password#token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(mail.text).not.toContain("localhost");
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("closes the SMTP transport even when the provider fails", async () => {
    vi.stubEnv("PASSWORD_RESET_SMTP_URL", "smtp://mail.example.test:587");
    vi.stubEnv("PASSWORD_RESET_FROM", "reset@example.test");
    vi.stubEnv("PUBLIC_BASE_URL", "https://jata.example.test");
    vi.stubEnv("NODE_ENV", "production");
    mocks.sendMail.mockRejectedValueOnce(new Error("provider secret must not be surfaced"));

    await expect(sendPasswordResetEmail("owner@example.test", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))
      .rejects.toThrow("provider secret must not be surfaced");
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
