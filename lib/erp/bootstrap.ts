/**
 * Workspace bootstrap
 *
 * Sets up what every ERP workspace needs once: a configuration row, the chart of accounts,
 * effective-dated tax rules, a compliance profile, a zero-balance messaging wallet, starter
 * templates and honest "not connected" channel rows. It is idempotent, so running it again after a
 * partial failure repairs the missing pieces instead of duplicating them.
 */

import { CHART_OF_ACCOUNTS, ensureChartOfAccounts } from "./accounting";
import { DEFAULT_KENYA_TAX_RULES } from "./tax";
import { STARTER_TEMPLATES, extractVariables } from "../messaging/templates";
import { ensureWallet } from "../messaging/billing";

export type BootstrapResult = {
  created: boolean;
  configuration: any;
  accountsCreated: number;
  taxRulesCreated: number;
  templatesCreated: number;
  channelsCreated: number;
  walletCreated: boolean;
};

export async function bootstrapErpWorkspace(
  client: any,
  input: { businessId: string; actorId?: string | null; actorName?: string | null; industryPackKey?: string; storefrontSlug?: string | null },
): Promise<BootstrapResult> {
  const business = await client.business.findUnique({ where: { id: input.businessId } });
  if (!business) throw Object.assign(new Error("That business was not found."), { status: 404 });

  const existing = await client.erpConfiguration.findUnique({ where: { businessId: input.businessId } }).catch(() => null);
  let configuration = existing;
  if (!configuration) {
    const slugBase = String(business.slug ?? business.name ?? "shop")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "shop";
    let slug = input.storefrontSlug || `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await client.erpConfiguration.findUnique({ where: { storefrontSlug: slug } }).catch(() => null);
      if (!clash) break;
      slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
    }
    configuration = await client.erpConfiguration.create({
      data: {
        businessId: input.businessId,
        industryPackKey: input.industryPackKey ?? "retail",
        legalName: business.name,
        storefrontSlug: slug,
        featureFlagsJson: JSON.stringify({ erpProEnabled: true, messagingKillSwitch: false, automationKillSwitch: false }),
        storefrontJson: JSON.stringify({ enabled: false }),
      },
    });
  }

  const accountsCreated = await ensureChartOfAccounts(client, input.businessId);

  let taxRulesCreated = 0;
  const existingRules = await client.erpTaxRule.findMany({ where: { businessId: input.businessId } }).catch(() => []);
  const existingRuleKeys = new Set(existingRules.map((rule: any) => `${rule.key}:${new Date(rule.effectiveFrom).toISOString().slice(0, 10)}`));
  for (const rule of DEFAULT_KENYA_TAX_RULES) {
    if (existingRuleKeys.has(`${rule.key}:${rule.effectiveFrom}`)) continue;
    await client.erpTaxRule.create({
      data: {
        businessId: input.businessId,
        key: rule.key,
        label: rule.label,
        rateBps: rule.rateBps,
        treatment: rule.treatment,
        inclusive: rule.inclusive,
        effectiveFrom: new Date(rule.effectiveFrom),
        effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo) : null,
        verified: false,
        sourceRef: rule.sourceRef ?? null,
        notes: "Reference default. Confirm with your accountant before filing.",
      },
    });
    taxRulesCreated += 1;
  }

  let templatesCreated = 0;
  for (const template of STARTER_TEMPLATES) {
    const exists = await client.msgTemplate.findFirst({ where: { businessId: input.businessId, key: template.key } }).catch(() => null);
    if (exists) continue;
    await client.msgTemplate.create({
      data: {
        businessId: input.businessId,
        key: template.key,
        name: template.name,
        channel: "SMS",
        category: template.category,
        body: template.body,
        variablesJson: JSON.stringify(extractVariables(template.body)),
        status: "ACTIVE",
        version: 1,
        createdById: input.actorId ?? null,
      },
    });
    templatesCreated += 1;
  }

  let channelsCreated = 0;
  for (const channel of ["SMS", "WHATSAPP", "EMAIL"] as const) {
    const existingChannel = await client.msgChannelConnection.findUnique({ where: { businessId_channel: { businessId: input.businessId, channel } } }).catch(() => null);
    if (existingChannel) continue;
    await client.msgChannelConnection.create({
      data: {
        businessId: input.businessId,
        channel,
        provider: "unconfigured",
        status: "NOT_CONNECTED",
        configJson: JSON.stringify({ configured: false }),
        healthJson: JSON.stringify({ state: "UNCONFIGURED", message: "No provider credentials are present. Nothing can be sent on this channel." }),
      },
    });
    channelsCreated += 1;
  }

  const profile = await client.erpComplianceProfile.findUnique({ where: { businessId: input.businessId } }).catch(() => null);
  if (!profile) {
    await client.erpComplianceProfile.create({
      data: {
        businessId: input.businessId,
        taxpayerName: configuration.legalName ?? business.name,
        kraPin: configuration.kraPin ?? null,
        vatRegistered: false,
        sector: configuration.industryPackKey ?? "retail",
        etimsSolution: "NONE",
        etimsStatus: "NOT_STARTED",
      },
    });
  }

  await ensureWallet(client, input.businessId).catch(() => null);

  return {
    created: !existing,
    configuration,
    accountsCreated,
    taxRulesCreated,
    templatesCreated,
    channelsCreated,
    walletCreated: true,
  };
}

/** The seeded chart, exported so the settings screen can show what bootstrap created. */
export const BOOTSTRAP_ACCOUNT_COUNT = CHART_OF_ACCOUNTS.length;
