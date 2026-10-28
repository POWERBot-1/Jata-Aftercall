import { describe, expect, it } from "vitest";
import {
  createInlineMediaPrismaMiddleware,
  installInlineMediaPrismaWritePolicy,
  type PrismaWriteMiddleware,
} from "@/lib/media/prisma-write-policy";
import {
  INLINE_MEDIA_PERSISTENCE_CODE,
  INLINE_MEDIA_PERSISTENCE_MESSAGE,
} from "@/lib/media/persistence-policy";

const inlineImage = "data:image/png;base64,BOUNDARY_SECRET_PAYLOAD";
const nextWrite = async () => "written";

describe("Prisma inline-media write boundary", () => {
  const blockedWrites: Array<{ action: string; args: unknown }> = [
    { action: "create", args: { data: { profile: { heroImage: inlineImage } } } },
    { action: "createMany", args: { data: [{ settings: JSON.stringify({ image: inlineImage }) }] } },
    { action: "createManyAndReturn", args: { data: [{ settings: { image: inlineImage } }] } },
    { action: "update", args: { where: { id: "row-1" }, data: { settings: { image: inlineImage } } } },
    { action: "updateMany", args: { where: { active: true }, data: [{ settings: { image: inlineImage } }] } },
    { action: "updateManyAndReturn", args: { where: { active: true }, data: { settings: { image: inlineImage } } } },
    {
      action: "upsert",
      args: {
        where: { id: "row-1" },
        create: { metadata: { gallery: [{ src: inlineImage }] } },
        update: { metadata: { gallery: [{ src: inlineImage }] } },
      },
    },
  ];

  it.each(blockedWrites)("rejects $action before next() when nested write data contains inline image bytes", async ({ action, args }) => {
    const middleware = createInlineMediaPrismaMiddleware();
    let nextCalls = 0;

    await expect(middleware({ action, args, model: "Business" }, async () => {
      nextCalls += 1;
      return "written";
    })).rejects.toMatchObject({
      name: "InlineMediaPersistenceError",
      code: INLINE_MEDIA_PERSISTENCE_CODE,
      status: 503,
      message: INLINE_MEDIA_PERSISTENCE_MESSAGE,
    });

    expect(nextCalls).toBe(0);
    expect(INLINE_MEDIA_PERSISTENCE_MESSAGE).not.toContain("BOUNDARY_SECRET_PAYLOAD");
  });

  it.each(["executeRaw", "queryRaw", "runCommandRaw"])("rejects inline image data in %s arguments", async (action) => {
    const middleware = createInlineMediaPrismaMiddleware();
    let nextCalls = 0;

    await expect(middleware({ action, args: ["SELECT $1", inlineImage] }, async () => {
      nextCalls += 1;
      return "written";
    })).rejects.toMatchObject({ code: INLINE_MEDIA_PERSISTENCE_CODE, status: 503 });

    expect(nextCalls).toBe(0);
  });

  it("allows ordinary writes and read filters containing legacy inline images", async () => {
    const middleware = createInlineMediaPrismaMiddleware();
    let nextCalls = 0;
    const next = async () => {
      nextCalls += 1;
      return "forwarded";
    };

    await expect(middleware({
      action: "create",
      args: { data: { heroImage: "https://cdn.example.test/hero.png", title: "Tea" } },
      model: "Product",
    }, next)).resolves.toBe("forwarded");
    await expect(middleware({
      action: "findMany",
      args: { where: { legacyImage: inlineImage } },
      model: "Product",
    }, next)).resolves.toBe("forwarded");

    expect(nextCalls).toBe(2);
  });

  it("installs once and exercises the registered callback before a fake Prisma write", async () => {
    const registered: PrismaWriteMiddleware[] = [];
    const client = {
      $use: (middleware: PrismaWriteMiddleware) => registered.push(middleware),
    };

    expect(installInlineMediaPrismaWritePolicy(client)).toBe(client);
    expect(installInlineMediaPrismaWritePolicy(client)).toBe(client);
    expect(registered).toHaveLength(1);

    let nextCalls = 0;
    await expect(registered[0]({
      action: "update",
      args: { where: { id: "row-1" }, data: { serializedContent: `{"photo":"${inlineImage}"}` } },
      model: "Experience",
    }, async () => {
      nextCalls += 1;
      return "written";
    })).rejects.toMatchObject({ code: INLINE_MEDIA_PERSISTENCE_CODE });
    expect(nextCalls).toBe(0);
  });

  it("fails closed for a configured client without Prisma middleware support", () => {
    const client = {};
    expect(() => installInlineMediaPrismaWritePolicy(client)).toThrow(/middleware is unavailable/i);
    expect(installInlineMediaPrismaWritePolicy(client, { required: false })).toBe(client);
  });
});
