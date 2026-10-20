/** Opaque JSON/text writers that can otherwise persist an image data URL into Neon. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "owner-a", role: "OWNER" } as any,
  document: null as any,
  aiConfig: null as any,
  aiFindUnique: vi.fn(async () => mocks.aiConfig),
  aiUpsert: vi.fn(async ({ update, create }: any) => ({ ...(mocks.aiConfig || create), ...update })),
  documentFindFirst: vi.fn(async () => mocks.document),
  documentCreate: vi.fn(async ({ data }: any) => ({ id: "knowledge-a", ...data })),
  documentUpdate: vi.fn(async ({ data }: any) => ({ id: "knowledge-a", ...data })),
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  default: {
    aIConfiguration: { findUnique: mocks.aiFindUnique, upsert: mocks.aiUpsert },
    knowledgeDocument: {
      findFirst: mocks.documentFindFirst,
      create: mocks.documentCreate,
      update: mocks.documentUpdate,
    },
    fAQ: { findFirst: vi.fn(async () => null), create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => mocks.user) }));
vi.mock("@/lib/tenant", () => ({
  assertBusinessRole: vi.fn(async () => ({ allowed: true, role: "OWNER" })),
  canAccessBusiness: vi.fn(async () => true),
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { POST as postAIConfig } from "@/app/api/ai/config/route";
import { POST as postAIStatus } from "@/app/api/ai/status/route";
import { resetExtendedAIConfigForTests, saveExtendedAIConfig } from "@/lib/ai-config";
import { InlineMediaPersistenceError } from "@/lib/media/persistence-policy";

const INLINE = "data:image/png;base64,iVBORw0KGgo=";
const BUSINESS_ID = "business-a";

function request(path: string, body: unknown) {
  return new Request(`https://jata.test${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetExtendedAIConfigForTests();
  mocks.user = { id: "owner-a", role: "OWNER" };
  mocks.document = null;
  mocks.aiConfig = null;
  mocks.aiFindUnique.mockImplementation(async () => mocks.aiConfig);
  mocks.documentFindFirst.mockImplementation(async () => mocks.document);
  mocks.aiUpsert.mockImplementation(async ({ update, create }: any) => ({ ...(mocks.aiConfig || create), ...update }));
  mocks.documentCreate.mockImplementation(async ({ data }: any) => ({ id: "knowledge-a", ...data }));
  mocks.documentUpdate.mockImplementation(async ({ data }: any) => ({ id: "knowledge-a", ...data }));
});

describe("AI configuration persistence media guard", () => {
  it("rejects inline data in AI config input before the first Prisma write", async () => {
    const response = await postAIConfig(request("/api/ai/config", {
      businessId: BUSINESS_ID,
      greetingMessage: `Welcome ${INLINE}`,
      faqs: [{ question: "Photo", answer: INLINE }],
    }));

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.aiUpsert).not.toHaveBeenCalled();
    expect(mocks.documentCreate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("keeps a legacy image in the raw AI config document readable and blocks a rewrite", async () => {
    const original = JSON.stringify({ businessId: BUSINESS_ID, retiredField: { image: INLINE } });
    mocks.document = { id: "knowledge-a", content: original };

    await expect(saveExtendedAIConfig(BUSINESS_ID, { operationalStatus: "PAUSED" }))
      .rejects.toBeInstanceOf(InlineMediaPersistenceError);

    expect(mocks.documentUpdate).not.toHaveBeenCalled();
    expect(mocks.documentCreate).not.toHaveBeenCalled();
    expect(mocks.document.content).toBe(original);
  });

  it("blocks a status write when a legacy inline value exists only in an unknown config key", async () => {
    const original = JSON.stringify({ businessId: BUSINESS_ID, retiredField: { image: INLINE } });
    mocks.document = { id: "knowledge-a", content: original };

    const response = await postAIStatus(request("/api/ai/status", {
      businessId: BUSINESS_ID,
      operationalStatus: "PAUSED",
    }));

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.aiUpsert).not.toHaveBeenCalled();
    expect(mocks.documentUpdate).not.toHaveBeenCalled();
    expect(mocks.document.content).toBe(original);
  });
});
