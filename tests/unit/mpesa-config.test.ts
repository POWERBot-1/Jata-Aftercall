/**
 * M-PESA configuration: strict environment separation and fail-closed validation.
 *
 * The connector must never guess. There is no default environment, no silent fallback between
 * Daraja's sandbox and production, and a value that is present but malformed is refused with a
 * diagnostic that names the variable and the rule — never the value.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MPESA_HOSTS,
  describeMpesaConfig,
  readMpesaConfig,
  readTestMode,
  redactCallbackUrl,
} from "@/lib/payments/config";
import { TEST_MPESA, applyMpesaEnv } from "@/tests/helpers/mpesaEnv";

let restore: () => void = () => undefined;
afterEach(() => restore());

/** Production-shaped values: a real-looking (but fake) shortcode that is not the sandbox one. */
const PRODUCTION = { MPESA_ENV: "production", MPESA_SHORTCODE: "4123456" };

describe("environment selection — no default, no silent fallback", () => {
  it("is not ready, and has no host, when MPESA_ENV is missing", () => {
    restore = applyMpesaEnv({ MPESA_ENV: undefined });
    const config = readMpesaConfig();
    expect(config.ready).toBe(false);
    expect(config.env).toBeNull();
    expect(config.baseUrl).toBe("");
    expect(config.missing).toContain("MPESA_ENV");
  });

  it.each(["prod", "live", "true", "1", "Production2", "sandbox ", "sand box", "staging"])(
    "refuses the unrecognised MPESA_ENV %j instead of falling back to sandbox",
    (value) => {
      restore = applyMpesaEnv({ MPESA_ENV: value });
      const config = readMpesaConfig();
      // `sandbox ` is trimmed to a valid value; every other value must be refused outright.
      if (value.trim() === "sandbox") {
        expect(config.env).toBe("sandbox");
        return;
      }
      expect(config.ready).toBe(false);
      expect(config.env).toBeNull();
      expect(config.baseUrl).toBe("");
      expect(config.invalid.join(" ")).toMatch(/MPESA_ENV must be exactly "sandbox" or "production"/);
    },
  );

  it("selects the official sandbox host for sandbox, and only that host", () => {
    restore = applyMpesaEnv({ MPESA_ENV: "sandbox" });
    const config = readMpesaConfig();
    expect(config.ready).toBe(true);
    expect(config.env).toBe("sandbox");
    expect(config.baseUrl).toBe("https://sandbox.safaricom.co.ke");
    expect(config.baseUrl).toBe(MPESA_HOSTS.sandbox);
  });

  it.each(["production", "PRODUCTION", " Production "])("selects the official production host for %j", (value) => {
    restore = applyMpesaEnv({ ...PRODUCTION, MPESA_ENV: value });
    const config = readMpesaConfig();
    expect(config.ready).toBe(true);
    expect(config.env).toBe("production");
    expect(config.baseUrl).toBe("https://api.safaricom.co.ke");
    expect(config.baseUrl).not.toContain("sandbox");
  });

  it("never resolves production to the sandbox host or the reverse", () => {
    restore = applyMpesaEnv(PRODUCTION);
    const live = readMpesaConfig().baseUrl;
    restore();
    restore = applyMpesaEnv({ MPESA_ENV: "sandbox" });
    const sandbox = readMpesaConfig().baseUrl;
    expect(live).not.toBe(sandbox);
    expect(live).toBe("https://api.safaricom.co.ke");
    expect(sandbox).toBe("https://sandbox.safaricom.co.ke");
  });
});

describe("missing variables", () => {
  const REQUIRED = ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_TOKEN"] as const;

  it("is ready when everything is present and valid", () => {
    restore = applyMpesaEnv();
    const config = readMpesaConfig();
    expect(config.ready).toBe(true);
    expect(config.missing).toEqual([]);
    expect(config.invalid).toEqual([]);
  });

  it.each(REQUIRED)("is not ready, and names the variable, when %s is missing", (name) => {
    restore = applyMpesaEnv({ [name]: undefined });
    const config = readMpesaConfig();
    expect(config.ready).toBe(false);
    expect(config.missing).toEqual([name]);
  });

  it.each(REQUIRED)("treats a whitespace-only %s as missing", (name) => {
    restore = applyMpesaEnv({ [name]: "   " });
    const config = readMpesaConfig();
    expect(config.ready).toBe(false);
    expect(config.missing).toContain(name);
  });

  it("reports every missing name at once when nothing is configured", () => {
    restore = applyMpesaEnv(Object.fromEntries([...REQUIRED, "MPESA_ENV", "PUBLIC_BASE_URL"].map((key) => [key, undefined])));
    const config = readMpesaConfig();
    expect(config.ready).toBe(false);
    expect(config.missing).toEqual(["MPESA_ENV", ...REQUIRED]);
  });
});

describe("malformed variables are refused with a rule, never a value", () => {
  it.each([
    ["MPESA_SHORTCODE", "17437", /MPESA_SHORTCODE must be a 5–7 digit number/, true],
    ["MPESA_SHORTCODE", "12", /MPESA_SHORTCODE must be a 5–7 digit number/, false],
    ["MPESA_SHORTCODE", "12345678", /MPESA_SHORTCODE must be a 5–7 digit number/, false],
    ["MPESA_SHORTCODE", "60A987", /MPESA_SHORTCODE must be a 5–7 digit number/, false],
    ["MPESA_CONSUMER_KEY", "has a space inside", /MPESA_CONSUMER_KEY must be 8–512 printable characters without spaces/, false],
    ["MPESA_CONSUMER_KEY", "short", /MPESA_CONSUMER_KEY must be 8–512 printable characters without spaces/, false],
    ["MPESA_CONSUMER_SECRET", "tab\tinside_value", /MPESA_CONSUMER_SECRET must be 8–512 printable characters without spaces/, false],
    ["MPESA_PASSKEY", "x".repeat(600), /MPESA_PASSKEY must be 8–512 printable characters without spaces/, false],
  ])("%s=%j", (name, value, rule, allowed) => {
    restore = applyMpesaEnv({ [name]: value });
    const config = readMpesaConfig();
    if (allowed) {
      // 5 digits is the shortest valid shortcode: this row documents the boundary.
      expect(config.invalid).toEqual([]);
      return;
    }
    expect(config.ready).toBe(false);
    expect(config.invalid.join(" ")).toMatch(rule);
    expect(JSON.stringify(config.invalid)).not.toContain(value);
  });

  it.each([
    ["too short", "abc123"],
    ["base64 plus", "A".repeat(23) + "+"],
    ["base64 slash", "A".repeat(23) + "/"],
    ["base64 padding", "A".repeat(22) + "=="],
    ["ampersand", "A".repeat(23) + "&"],
    ["hash", "A".repeat(23) + "#"],
    ["percent", "A".repeat(23) + "%"],
    ["space", "A".repeat(23) + " B"],
    ["too long", "A".repeat(129)],
  ])("rejects a callback token that is %s (it would not survive the callback URL)", (_label, token) => {
    restore = applyMpesaEnv({ MPESA_CALLBACK_TOKEN: token });
    const config = readMpesaConfig();
    expect(config.ready).toBe(false);
    expect(config.invalid.join(" ")).toMatch(/MPESA_CALLBACK_TOKEN must be 24–128 URL-safe characters/);
    // An unusable token must never be embedded in a URL that is handed to Safaricom.
    expect(config.stkCallbackUrl).toBe("");
    expect(JSON.stringify(config.invalid)).not.toContain(token.trim() || "~~");
  });

  it.each(["abcdefghijklmnopqrstuvwx", "Abc-123_xyz-ABC_123-xyz_789", "0".repeat(64), "z".repeat(128)])(
    "accepts the URL-safe callback token %s",
    (token) => {
      restore = applyMpesaEnv({ MPESA_CALLBACK_TOKEN: token });
      expect(readMpesaConfig().ready).toBe(true);
    },
  );

  it("rejects a malformed MPESA_ALLOWED_IPS list but accepts exact addresses", () => {
    restore = applyMpesaEnv({ MPESA_ALLOWED_IPS: "196.201.214.200, 196.201.214.206" });
    expect(readMpesaConfig().ready).toBe(true);
    expect(readMpesaConfig().allowedIps).toEqual(["196.201.214.200", "196.201.214.206"]);
    restore();
    restore = applyMpesaEnv({ MPESA_ALLOWED_IPS: "196.201.214.0/24" });
    expect(readMpesaConfig().ready).toBe(false);
    expect(readMpesaConfig().invalid.join(" ")).toMatch(/MPESA_ALLOWED_IPS must be a comma-separated list of exact IP addresses/);
  });
});

describe("environment coherence", () => {
  it("refuses Safaricom's public sandbox shortcode in production", () => {
    restore = applyMpesaEnv({ MPESA_ENV: "production", MPESA_SHORTCODE: "174379" });
    const config = readMpesaConfig();
    expect(config.ready).toBe(false);
    expect(config.invalid.join(" ")).toMatch(/sandbox shortcode and cannot be used with MPESA_ENV=production/);
  });

  it("allows the sandbox shortcode in sandbox", () => {
    restore = applyMpesaEnv({ MPESA_ENV: "sandbox", MPESA_SHORTCODE: "174379" });
    expect(readMpesaConfig().ready).toBe(true);
  });

  it.each(["preview", "development"])("refuses the production connector on a Vercel %s deployment", (vercelEnv) => {
    restore = applyMpesaEnv({ ...PRODUCTION, VERCEL_ENV: vercelEnv });
    const config = readMpesaConfig();
    expect(config.ready).toBe(false);
    expect(config.invalid.join(" ")).toMatch(/only permitted on the Vercel Production deployment/);
  });

  it("allows the production connector on Vercel Production and off Vercel", () => {
    restore = applyMpesaEnv({ ...PRODUCTION, VERCEL_ENV: "production" });
    expect(readMpesaConfig().ready).toBe(true);
    restore();
    restore = applyMpesaEnv({ ...PRODUCTION, VERCEL_ENV: undefined });
    expect(readMpesaConfig().ready).toBe(true);
  });

  it("allows the sandbox connector on Preview, and warns (without blocking) about it on Production", () => {
    restore = applyMpesaEnv({ VERCEL_ENV: "preview" });
    expect(readMpesaConfig().ready).toBe(true);
    expect(readMpesaConfig().warnings).toEqual([]);
    restore();
    restore = applyMpesaEnv({ VERCEL_ENV: "production" });
    const config = readMpesaConfig();
    expect(config.ready).toBe(true);
    expect(config.warnings.join(" ")).toMatch(/SANDBOX connector is active on a Vercel Production deployment/);
  });
});

describe("callback URLs", () => {
  it("builds the neutral default URLs from the public https origin, with the token", () => {
    restore = applyMpesaEnv({ PUBLIC_BASE_URL: "https://jata-aftercall.vercel.app" });
    const config = readMpesaConfig();
    const token = TEST_MPESA.MPESA_CALLBACK_TOKEN;
    expect(config.stkCallbackUrl).toBe(`https://jata-aftercall.vercel.app/api/payments/webhooks/daraja/stk?token=${token}`);
    expect(config.c2bConfirmationUrl).toBe(`https://jata-aftercall.vercel.app/api/payments/webhooks/daraja/confirmation?token=${token}`);
    expect(config.c2bValidationUrl).toBe(`https://jata-aftercall.vercel.app/api/payments/webhooks/daraja/validation?token=${token}`);
  });

  it("registers nothing by default that contains a word Daraja is reported to filter", () => {
    restore = applyMpesaEnv();
    const config = readMpesaConfig();
    for (const url of [config.stkCallbackUrl, config.c2bConfirmationUrl, config.c2bValidationUrl]) {
      expect(url).not.toMatch(/mpesa|m-pesa|safaricom/i);
    }
  });

  it("tolerates a trailing slash and falls back from PUBLIC_BASE_URL to NEXTAUTH_URL", () => {
    restore = applyMpesaEnv({ PUBLIC_BASE_URL: "https://jata.test/" });
    expect(readMpesaConfig().stkCallbackUrl).toMatch(/^https:\/\/jata\.test\/api\/payments\/webhooks\/daraja\/stk\?token=/);
    restore();
    restore = applyMpesaEnv({ PUBLIC_BASE_URL: undefined, NEXTAUTH_URL: "https://jata.test" });
    expect(readMpesaConfig().ready).toBe(true);
  });

  it("is not ready when no public origin is configured — it never defaults to localhost", () => {
    restore = applyMpesaEnv({ PUBLIC_BASE_URL: undefined });
    const config = readMpesaConfig();
    expect(config.ready).toBe(false);
    expect(config.invalid.join(" ")).toMatch(/PUBLIC_BASE_URL \(or NEXTAUTH_URL\) is not set/);
    expect(config.stkCallbackUrl).toBe("");
    expect(config.c2bConfirmationUrl).toBe("");
  });

  it.each([
    ["localhost", "http://localhost:3000"],
    ["localhost over https", "https://localhost:3000"],
    ["plain http", "http://jata.test"],
    ["a private address", "https://192.168.1.20"],
    ["a loopback address", "https://127.0.0.1"],
    ["a link-local address", "https://169.254.1.1"],
    ["a single-label host", "https://jata"],
    ["embedded credentials", "https://user:pass@jata.test"],
    ["a schemeless value", "jata.test"],
    ["an internal host", "https://jata.internal"],
  ])("refuses a base URL that is %s", (_label, url) => {
    restore = applyMpesaEnv({ PUBLIC_BASE_URL: url });
    const config = readMpesaConfig();
    expect(config.ready).toBe(false);
    expect(config.invalid.join(" ")).toMatch(/PUBLIC_BASE_URL \(or NEXTAUTH_URL\)/);
    expect(config.stkCallbackUrl).toBe("");
  });

  describe("explicit overrides", () => {
    const token = TEST_MPESA.MPESA_CALLBACK_TOKEN;
    const good = {
      MPESA_STK_CALLBACK_URL: `https://hooks.jata.test/pay/stk?token=${token}`,
      MPESA_C2B_CONFIRMATION_URL: `https://hooks.jata.test/pay/confirmation?token=${token}`,
      MPESA_C2B_VALIDATION_URL: `https://hooks.jata.test/pay/validation?token=${token}`,
    };

    it("are used verbatim, and make the public origin unnecessary when all three are set", () => {
      restore = applyMpesaEnv({ ...good, PUBLIC_BASE_URL: undefined });
      const config = readMpesaConfig();
      expect(config.ready).toBe(true);
      expect(config.stkCallbackUrl).toBe(good.MPESA_STK_CALLBACK_URL);
      expect(config.c2bConfirmationUrl).toBe(good.MPESA_C2B_CONFIRMATION_URL);
      expect(config.c2bValidationUrl).toBe(good.MPESA_C2B_VALIDATION_URL);
    });

    it("must carry the callback token (an override is not rewritten)", () => {
      restore = applyMpesaEnv({ ...good, MPESA_STK_CALLBACK_URL: "https://hooks.jata.test/pay/stk" });
      const config = readMpesaConfig();
      expect(config.ready).toBe(false);
      expect(config.invalid.join(" ")).toMatch(/MPESA_STK_CALLBACK_URL must carry \?token=<MPESA_CALLBACK_TOKEN>/);
    });

    it("must carry the *same* token", () => {
      restore = applyMpesaEnv({ ...good, MPESA_C2B_CONFIRMATION_URL: "https://hooks.jata.test/pay/confirmation?token=another_token_0123456789abcd" });
      expect(readMpesaConfig().invalid.join(" ")).toMatch(/MPESA_C2B_CONFIRMATION_URL must carry/);
    });

    it.each([
      ["MPESA_STK_CALLBACK_URL", "/stk"],
      ["MPESA_C2B_CONFIRMATION_URL", "/confirmation"],
      ["MPESA_C2B_VALIDATION_URL", "/validation"],
    ])("%s must end in %s, because JATA routes the callback type by its last path segment", (name, suffix) => {
      restore = applyMpesaEnv({ ...good, [name]: `https://hooks.jata.test/pay/other?token=${token}` });
      expect(readMpesaConfig().invalid.join(" ")).toContain(`${name} must end in ${suffix}`);
    });

    it("must be public https URLs", () => {
      restore = applyMpesaEnv({ ...good, MPESA_STK_CALLBACK_URL: `http://hooks.jata.test/pay/stk?token=${token}` });
      expect(readMpesaConfig().invalid.join(" ")).toMatch(/MPESA_STK_CALLBACK_URL must use https/);
      restore();
      restore = applyMpesaEnv({ ...good, MPESA_STK_CALLBACK_URL: `https://localhost/pay/stk?token=${token}` });
      expect(readMpesaConfig().invalid.join(" ")).toMatch(/MPESA_STK_CALLBACK_URL must be a publicly reachable host/);
    });
  });
});

describe("initiator-authenticated operations (reversals) are configured separately", () => {
  it("is collection-ready but not reversal-ready without the initiator", () => {
    restore = applyMpesaEnv({ MPESA_INITIATOR_NAME: undefined, MPESA_SECURITY_CREDENTIAL: undefined });
    const config = readMpesaConfig();
    expect(config.ready).toBe(true);
    expect(config.reversalReady).toBe(false);
    expect(config.reversalMissing).toEqual(["MPESA_INITIATOR_NAME", "MPESA_SECURITY_CREDENTIAL"]);
  });

  it("is reversal-ready with a valid initiator and SecurityCredential", () => {
    restore = applyMpesaEnv();
    const config = readMpesaConfig();
    expect(config.reversalReady).toBe(true);
    expect(config.reversalMissing).toEqual([]);
  });

  it.each([
    ["initiator with a space", "MPESA_INITIATOR_NAME", "api user", /MPESA_INITIATOR_NAME must be 3–64/],
    ["initiator that is too short", "MPESA_INITIATOR_NAME", "ab", /MPESA_INITIATOR_NAME must be 3–64/],
    ["credential that is not base64", "MPESA_SECURITY_CREDENTIAL", "plain password!", /MPESA_SECURITY_CREDENTIAL must be the base64 SecurityCredential/],
    ["credential that is too short", "MPESA_SECURITY_CREDENTIAL", "YWJj", /MPESA_SECURITY_CREDENTIAL must be the base64 SecurityCredential/],
  ])("refuses an %s", (_label, name, value, rule) => {
    restore = applyMpesaEnv({ [name]: value });
    const config = readMpesaConfig();
    expect(config.reversalReady).toBe(false);
    expect(config.reversalInvalid.join(" ")).toMatch(rule);
    expect(JSON.stringify(config.reversalInvalid)).not.toContain(value);
  });

  it("is never reversal-ready while the collection connector is not ready", () => {
    restore = applyMpesaEnv({ MPESA_ENV: undefined });
    expect(readMpesaConfig().reversalReady).toBe(false);
  });
});

describe("diagnostics never carry a secret", () => {
  it("describes the connector with names, rules and redacted URLs only", () => {
    restore = applyMpesaEnv({ PUBLIC_BASE_URL: "https://jata-aftercall.vercel.app" });
    const text = JSON.stringify(describeMpesaConfig());
    for (const secret of [
      TEST_MPESA.MPESA_CONSUMER_KEY,
      TEST_MPESA.MPESA_CONSUMER_SECRET,
      TEST_MPESA.MPESA_PASSKEY,
      TEST_MPESA.MPESA_CALLBACK_TOKEN,
      TEST_MPESA.MPESA_SECURITY_CREDENTIAL,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("token=[redacted]");
    expect(describeMpesaConfig()).toMatchObject({ environment: "sandbox", collectionReady: true, reversalReady: true });
  });

  it("keeps secrets out of the diagnostics even when the configuration is invalid", () => {
    restore = applyMpesaEnv({ MPESA_CALLBACK_TOKEN: "bad token with spaces & symbols!!", MPESA_CONSUMER_KEY: "no spaces allowed here" });
    const text = JSON.stringify(describeMpesaConfig());
    expect(text).not.toContain("bad token");
    expect(text).not.toContain("no spaces allowed");
  });

  it("redacts the token of any callback URL", () => {
    expect(redactCallbackUrl("https://x.test/a/stk?token=SECRET123&b=1")).toBe("https://x.test/a/stk?token=[redacted]&b=1");
    expect(redactCallbackUrl("https://x.test/a/stk")).toBe("https://x.test/a/stk");
  });
});

describe("test mode never weakens a live connector", () => {
  it("treats a fully configured SANDBOX connector as test mode, not production", () => {
    restore = applyMpesaEnv();
    expect(readMpesaConfig().ready).toBe(true);
    expect(readTestMode()).toMatchObject({ enabled: true, explicit: false });
  });

  it("treats a ready PRODUCTION connector as live (test mode off)", () => {
    restore = applyMpesaEnv(PRODUCTION);
    expect(readTestMode()).toMatchObject({ enabled: false, explicit: false });
  });

  it("honours JATA_PAYMENTS_TEST_MODE=on off production, and only there", () => {
    restore = applyMpesaEnv({ JATA_PAYMENTS_TEST_MODE: "on" });
    expect(readTestMode()).toMatchObject({ enabled: true, explicit: true });
  });

  it.each([
    ["MPESA_ENV=production", { ...PRODUCTION, JATA_PAYMENTS_TEST_MODE: "on" }],
    ["a Vercel Production deployment", { VERCEL_ENV: "production", JATA_PAYMENTS_TEST_MODE: "on" }],
  ])("ignores JATA_PAYMENTS_TEST_MODE=on on %s, so it can never accept unsigned callbacks there", (_label, env) => {
    restore = applyMpesaEnv(env);
    const state = readTestMode();
    expect(state.explicit).toBe(false);
    expect(state.ignoredOnInProduction).toBe(true);
    expect(state.reason).toMatch(/ignored because this is a production deployment/);
  });

  it("honours an explicit off", () => {
    restore = applyMpesaEnv({ JATA_PAYMENTS_TEST_MODE: "off" });
    expect(readTestMode()).toMatchObject({ enabled: false, explicit: false });
  });

  it("names the real variable (plural) in its reason", () => {
    restore = applyMpesaEnv({ JATA_PAYMENTS_TEST_MODE: "on" });
    expect(readTestMode().reason).toContain("JATA_PAYMENTS_TEST_MODE");
  });
});

beforeEach(() => {
  restore = () => undefined;
});
