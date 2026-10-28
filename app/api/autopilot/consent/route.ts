import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessRole, TenantError } from "@/lib/tenant";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import {
  isOptOutMessage,
  normalizeAutopilotEmail,
  normalizeAutopilotPhone,
  recordCustomerOptOutByKeyword,
} from "@/lib/autopilot/consent";
import { recordAutopilotAudit } from "@/lib/autopilot/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : "";
  const channel = typeof body.channel === "string" ? body.channel.trim().toUpperCase() : "WHATSAPP";
  const scope = body.scope === "MARKETING" ? "MARKETING" : "TRANSACTIONAL";
  const status = body.status === "OPTED_OUT" ? "OPTED_OUT" : "OPTED_IN";
  const inboundKeyword = typeof body.inboundKeyword === "string" ? body.inboundKeyword : "";

  if (!businessId || !["WHATSAPP", "SMS", "EMAIL", "VOICE"].includes(channel)) {
    return NextResponse.json(
      { error: "businessId and valid channel are required." },
      { status: 400 },
    );
  }

  const rl = rateLimitByIdentity(`${session.userId}:${businessId}`, {
    key: "autopilot_consent",
    max: 40,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Consent update rate limit reached. Try again shortly." },
      { status: 429 },
    );
  }

  try {
    await assertBusinessRole(businessId, session, "manage_orders");

    if (inboundKeyword && isOptOutMessage(inboundKeyword)) {
      const optOut = await recordCustomerOptOutByKeyword({
        businessId,
        phone: typeof body.phone === "string" ? body.phone : null,
        email: typeof body.email === "string" ? body.email : null,
        channel: channel as any,
        messageText: inboundKeyword,
      });
      await recordAutopilotAudit({
        businessId,
        actorKind: "SYSTEM",
        actorUserId: session.userId,
        action: "autopilot.consent.keyword_opt_out",
        metadata: { channel, optedOut: optOut.optedOut },
      });
      return NextResponse.json({ optedOut: true, customerProfileId: optOut.customerProfileId });
    }

    const phoneNormalized = normalizeAutopilotPhone(
      typeof body.phone === "string" ? body.phone : null,
    );
    const emailNormalized = normalizeAutopilotEmail(
      typeof body.email === "string" ? body.email : null,
    );
    if (!phoneNormalized && !emailNormalized) {
      return NextResponse.json(
        { error: "Provide a valid phone number or email address." },
        { status: 400 },
      );
    }

    let profile = phoneNormalized
      ? await prisma.autopilotCustomerProfile.findUnique({
          where: { businessId_phoneNormalized: { businessId, phoneNormalized } },
        })
      : await prisma.autopilotCustomerProfile.findFirst({
          where: { businessId, emailNormalized },
        });

    if (!profile) {
      try {
        profile = await prisma.autopilotCustomerProfile.create({
          data: {
            businessId,
            displayName: typeof body.displayName === "string" ? body.displayName.slice(0, 120) : null,
            phoneNormalized,
            emailNormalized,
            lifecycleStage: "ENQUIRED",
          },
        });
      } catch (err: any) {
        if (err?.code === "P2002") {
          profile = phoneNormalized
            ? await prisma.autopilotCustomerProfile.findUnique({
                where: { businessId_phoneNormalized: { businessId, phoneNormalized } },
              })
            : await prisma.autopilotCustomerProfile.findFirst({
                where: { businessId, emailNormalized },
              });
        } else {
          throw err;
        }
      }
    }
    if (!profile) {
      return NextResponse.json(
        { error: "Could not resolve customer profile." },
        { status: 409 },
      );
    }

    const consent = await prisma.autopilotConsentRecord.upsert({
      where: {
        businessId_customerProfileId_channel_scope: {
          businessId,
          customerProfileId: profile.id,
          channel,
          scope,
        },
      },
      update: {
        status,
        source: typeof body.source === "string" ? body.source.slice(0, 80) : "OWNER_RECORDED",
        recordedByUserId: session.userId,
      },
      create: {
        businessId,
        customerProfileId: profile.id,
        channel,
        scope,
        status,
        source: typeof body.source === "string" ? body.source.slice(0, 80) : "OWNER_RECORDED",
        recordedByUserId: session.userId,
      },
    });

    await recordAutopilotAudit({
      businessId,
      actorKind: "OWNER",
      actorUserId: session.userId,
      action: "autopilot.consent.updated",
      targetType: "AutopilotConsentRecord",
      targetId: consent.id,
      metadata: { channel, scope, status },
    });

    return NextResponse.json({ consent });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Could not save customer consent record." },
      { status: 500 },
    );
  }
}
