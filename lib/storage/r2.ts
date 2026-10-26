/**
 * Cloudflare R2 object storage adapter (owner decision 2026-10-26: R2, free-first).
 *
 * Implements the `ObjectStorageProvider` contract over R2's S3-compatible API using the
 * maintained AWS SDK v3. The adapter exists so the application can be *configured*; it changes
 * nothing until an operator sets `JATA_STORAGE_PROVIDER=cloudflare-r2` together with the R2
 * variables below. Incomplete configuration throws `StorageNotConfiguredError` naming the
 * missing variables (never their values), and `resolveDurableStorageProvider` turns that into
 * the usual fail-closed behaviour.
 *
 * Safety properties, enforced here rather than trusted to callers:
 *   • Keys come only from `objectKeyFor` — server-built `tenants/<businessId>/<kind>/<name>`,
 *     with traversal, content-type and per-kind size rules applied before any byte moves.
 *   • Credentials are read from server-side environment only, are used to sign requests, and
 *     never appear in returned refs, error messages or logs.
 *   • Every request has a hard timeout; the SDK retries transient failures (max 3 attempts).
 *     Object names are caller-generated UUIDs, so a retried PUT cannot duplicate content under
 *     a second name, and DELETE of a missing key succeeds — orphan cleanup is safe to retry.
 *   • `remove` refuses keys outside the `tenants/` namespace.
 *   • Objects are immutable by naming, so they are stored with a long-lived cache header.
 *
 * R2 buckets are private by default. Storefront media is public by design in this product, so
 * a public base URL (an enabled `r2.dev` subdomain for pilots, or a custom domain) is required
 * configuration: without a durable URL for browsers, this provider is not considered usable.
 */

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MAX_BYTES_BY_KIND, objectKeyFor } from "./keys";
import {
  StorageCapabilityError,
  StorageNotConfiguredError,
  type ObjectStorageProvider,
  type PutObjectInput,
  type StoredObjectRef,
} from "./types";

export const R2_PROVIDER_ID = "cloudflare-r2";

/** Server-side variables that must all be present before R2 can be selected. */
export const R2_REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
] as const;

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  endpoint: string;
};

/** The slice of an S3 client this adapter needs, injectable for tests. */
export type R2ObjectClient = {
  send(command: PutObjectCommand | DeleteObjectCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
};

const REQUEST_TIMEOUT_MS = 15_000;

/** Names (never values) of the R2 variables missing from `env`. */
export function missingR2Env(env: NodeJS.ProcessEnv = process.env): string[] {
  return R2_REQUIRED_ENV.filter((name) => !String(env[name] || "").trim());
}

export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config {
  const missing = missingR2Env(env);
  if (missing.length > 0) {
    throw new StorageNotConfiguredError(
      `Cloudflare R2 storage is selected but not fully configured. Missing server-side variable(s): ${missing.join(", ")}.`,
    );
  }
  const accountId = String(env.R2_ACCOUNT_ID).trim();
  return {
    accountId,
    accessKeyId: String(env.R2_ACCESS_KEY_ID).trim(),
    secretAccessKey: String(env.R2_SECRET_ACCESS_KEY).trim(),
    bucket: String(env.R2_BUCKET).trim(),
    publicBaseUrl: String(env.R2_PUBLIC_BASE_URL).trim().replace(/\/+$/, ""),
    // R2_ENDPOINT is an optional override (custom S3 endpoint); the canonical R2 endpoint is
    // derived from the account id and is what production should use.
    endpoint: String(env.R2_ENDPOINT || "").trim() || `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

function defaultClient(config: R2Config): R2ObjectClient {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 3,
    // S3-compatible stores do not all implement the SDK's newer default checksum behaviour;
    // only calculate/validate checksums when an operation requires them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  }) as unknown as R2ObjectClient;
}

async function sendWithTimeout(
  client: R2ObjectClient,
  command: PutObjectCommand | DeleteObjectCommand,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    await client.send(command, { abortSignal: controller.signal });
  } catch {
    // Deliberately generic: SDK errors can embed endpoints and request metadata. Callers map
    // this to their honest, owner-facing failure responses; nothing is logged here.
    throw new Error("Durable media storage request failed.");
  } finally {
    clearTimeout(timer);
  }
}

export function createR2Storage(
  env: NodeJS.ProcessEnv = process.env,
  clientFactory: (config: R2Config) => R2ObjectClient = defaultClient,
): ObjectStorageProvider {
  const config = r2ConfigFromEnv(env);
  const client = clientFactory(config);

  return {
    id: R2_PROVIDER_ID,
    capabilities: {
      durable: true,
      cdn: true,
      maxObjectBytes: MAX_BYTES_BY_KIND["image-original"],
      derivatives: true,
      // Held back deliberately: immersive 3D remains a separate owner decision, so this build
      // does not offer model storage even though R2 could physically hold the files.
      models: false,
    },

    async put(input: PutObjectInput): Promise<StoredObjectRef> {
      const key = objectKeyFor({
        businessId: input.businessId,
        kind: input.kind,
        name: input.name,
        contentType: input.contentType,
        bytes: input.body.length,
      });
      await sendWithTimeout(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.body.length,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      return {
        provider: R2_PROVIDER_ID,
        key,
        url: `${config.publicBaseUrl}/${key}`,
        bytes: input.body.length,
        contentType: input.contentType,
      };
    },

    async remove(ref: Pick<StoredObjectRef, "key">): Promise<void> {
      if (!ref.key.startsWith("tenants/") || ref.key.includes("..") || ref.key.includes("\\")) {
        throw new StorageCapabilityError("Refusing to delete an object outside the tenant namespace.");
      }
      await sendWithTimeout(client, new DeleteObjectCommand({ Bucket: config.bucket, Key: ref.key }));
    },
  };
}
