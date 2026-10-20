/**
 * Last-resort Prisma boundary for the no-inline-image-in-Neon rule.
 *
 * Route/service guards provide useful responses and preserve legacy-read behavior. This middleware
 * covers the runtime client exported by `lib/db` and the repository's seed/restore/DB-test helpers,
 * so an alternate model, JSON column, nested write, or raw SQL parameter cannot bypass those guards.
 * The isolated browser harness uses its own client and is not runtime application code; its fixtures
 * use hosted synthetic image URLs only. This inspects inline data-URL schemes, not arbitrary raw
 * binary blobs. It inspects proposed writes; reads and filters can still refer to legacy inline rows.
 */
import { assertNoInlineImagePersistence } from "./persistence-policy";

type PrismaMiddlewareParams = {
  action: string;
  args?: unknown;
  model?: string | null;
};
type PrismaMiddlewareNext = (params: PrismaMiddlewareParams) => Promise<unknown>;
export type PrismaWriteMiddleware = (
  params: PrismaMiddlewareParams,
  next: PrismaMiddlewareNext,
) => Promise<unknown>;
type PrismaClientLike = {
  $use?: (middleware: PrismaWriteMiddleware) => void;
  [key: symbol]: unknown;
};

const WRITE_ACTIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);
const RAW_ACTIONS = new Set(["executeRaw", "queryRaw", "runCommandRaw"]);
const INSTALLATION_MARKER = Symbol.for("jata.inline-media-prisma-write-policy");

/** Exposed for focused tests; installed clients use the same function. */
export function createInlineMediaPrismaMiddleware(): PrismaWriteMiddleware {
  return async (params, next) => {
    if (RAW_ACTIONS.has(params.action)) {
      // The application uses parameterized raw queries for reads/row locks, while isolated test
      // harnesses also issue direct SQL writes. Prisma middleware does not reliably distinguish
      // those shapes, so fail closed on image data in any raw-query arguments.
      assertNoInlineImagePersistence(params.args);
    } else if (WRITE_ACTIONS.has(params.action)) {
      const args = params.args && typeof params.args === "object"
        ? params.args as Record<string, unknown>
        : {};
      if (params.action === "upsert") {
        assertNoInlineImagePersistence({ create: args.create, update: args.update });
      } else {
        assertNoInlineImagePersistence(args.data);
      }
    }
    return next(params);
  };
}

/** Install once per real Prisma client; fail closed if a configured client lacks middleware support. */
export function installInlineMediaPrismaWritePolicy<T extends PrismaClientLike>(
  client: T,
  options: { required?: boolean } = {},
): T {
  if (!client || typeof client !== "object") throw new Error("A Prisma client is required for the media write policy.");
  if (client[INSTALLATION_MARKER] === true) return client;
  if (typeof client.$use !== "function") {
    if (options.required === false) return client;
    throw new Error("Prisma middleware is unavailable; refusing to run without the inline-media persistence guard.");
  }
  client.$use(createInlineMediaPrismaMiddleware());
  Object.defineProperty(client, INSTALLATION_MARKER, { value: true, configurable: false, enumerable: false });
  return client;
}
