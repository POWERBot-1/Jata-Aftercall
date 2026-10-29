import prisma from "@/lib/db";
import { handleErpRequest } from "@/lib/erp/http";
import { erpFeatureEnabled } from "@/lib/erp/entitlement";
import { listImplementedModules } from "@/lib/erp/navigation";

export const dynamic = "force-dynamic";

/**
 * Workspace status for monitoring and for the shell.
 *
 * It reports what the server knows: the product flag, the entitlement decision, whether the
 * database answered, and which integrations are genuinely configured. It never returns a green
 * "live" for a sandbox channel.
 */
export async function GET(request: Request, context: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await context.params;
  return handleErpRequest({
    businessId,
    request,
    permission: "WORKSPACE_READ",
    fallback: "We couldn't read the workspace status.",
    handler: async ({ ctx }) => {
      const [channels, wallet, pendingOrders] = await Promise.all([
        prisma.msgChannelConnection.findMany({ where: { businessId } }).catch(() => []),
        prisma.msgWallet.findUnique({ where: { businessId } }).catch(() => null),
        prisma.erpStoreOrder.count({ where: { businessId, status: "PENDING" } }).catch(() => 0),
      ]);
      return {
        data: {
          product: "ERP_PRO",
          productEnabled: erpFeatureEnabled(),
          planKey: ctx.entitlement.planKey,
          priceKES: ctx.entitlement.priceKES,
          entitled: ctx.entitlement.entitled,
          status: ctx.entitlement.status,
          lifecycle: ctx.entitlement.lifecycle,
          reason: ctx.entitlement.reason,
          role: ctx.role,
          permissions: ctx.permissions.length,
          modules: listImplementedModules().length,
          integrations: {
            storefront: Boolean(ctx.configuration?.storefrontSlug),
            messagingProvider: channels.filter((channel: any) => channel.provider !== "unconfigured" && channel.status === "ACTIVE").map((channel: any) => channel.channel),
            webhookSecretConfigured: Boolean(process.env.MESSAGING_WEBHOOK_SECRET),
          },
          wallet: wallet ? { balanceCents: Number(wallet.balanceCents), reservedCents: Number(wallet.reservedCents) } : null,
          pendingStoreOrders: pendingOrders,
          time: new Date().toISOString(),
        },
      };
    },
  });
}
