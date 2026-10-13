import * as prismaClientModule from "@prisma/client";
import prisma from "@/lib/db";
import { negativeStockAllowed } from "./inventory";
import type { InventoryMovementReason } from "./types";
import type { PosConfiguration } from "./types";

/**
 * Tenant-scoped data access for the Business POS (spec §5, §53, §75).
 *
 * Three rules hold for every function in this file:
 *
 * 1. `businessId` is always the first argument and always part of the `where` clause. A caller
 *    can never widen a query by passing filters — the tenant filter is merged in, not accepted
 *    from the caller.
 * 2. Reads and writes of a single record use a *compound* key (`{ id, businessId }`) through
 *    `findFirst`/`updateMany`, never `findUnique({ where: { id } })`. A stolen or guessed record
 *    id from another business therefore matches zero rows instead of leaking or mutating data
 *    (§75: cross-tenant customer/sale/inventory access must fail safely).
 * 3. Nothing here decides *whether* an action is allowed — that is `guard.ts` (§36). This module
 *    only decides *which rows a permitted action can touch*.
 *
 * The client parameter accepts either the shared Prisma client or an interactive transaction
 * client, so a sale (money + stock + credit + receipt number) commits atomically (§27, §31).
 */
export type PosClient = any;

const db = (): PosClient => prisma;

export type DateRange = { from?: Date | string | null; to?: Date | string | null };

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Inclusive `createdAt` filter; an unparseable bound is ignored rather than widening the range. */
export function createdBetween(range: DateRange = {}): Record<string, unknown> {
  const from = toDate(range.from);
  const to = toDate(range.to);
  const filter: Record<string, unknown> = {};
  if (from) filter.gte = from;
  if (to) filter.lte = to;
  return Object.keys(filter).length ? { createdAt: filter } : {};
}

function asInt(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/**
 * Quantities, not money (§13, §14). Money stays whole shillings; quantities keep the three
 * decimals the business logic has always accepted for measurable units (kilogram, litre,
 * metre), rounded once so stock can never carry a phantom fraction.
 */
export function asQuantity(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : fallback;
}

function clampText(value: unknown, max = 200): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.slice(0, max);
}

/** Branch scope key: "" means the business's own stock room (see PosInventoryItem.branchId). */
export function branchScope(branchId: string | null | undefined): string {
  return typeof branchId === "string" ? branchId : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch isolation (§16, §75) — the server decides whose location an action touches
// ─────────────────────────────────────────────────────────────────────────────

export type BranchScopeDecision =
  | { ok: true; branchId: string | null }
  | { ok: false; code: "BRANCH_NOT_FOUND" | "BRANCH_OUT_OF_SCOPE"; message: string };

/**
 * Decides which branch a permitted action may touch (§16, §75).
 *
 * - A staff member bound to a branch never widens or moves their scope: on reads their branch
 *   is forced (a client-supplied branch is ignored), and on writes naming a different branch is
 *   refused rather than silently rewritten.
 * - An actor without a branch (owner, admin) may name a branch, but it must belong to this
 *   business — a guessed or foreign id is refused. `null` means business-wide.
 *
 * `strict` is used by writes: a branch-bound actor who names another location is told so
 * instead of having their action land somewhere else.
 */
export async function resolveBranch(
  businessId: string,
  actor: { branchId: string | null },
  requested: string | null | undefined,
  client: PosClient = db(),
  strict = false,
): Promise<BranchScopeDecision> {
  if (actor.branchId) {
    const requestedId = clampText(requested, 64);
    if (requestedId && requestedId !== actor.branchId && strict) {
      return { ok: false, code: "BRANCH_OUT_OF_SCOPE", message: "That location is not the one you are assigned to." };
    }
    return { ok: true, branchId: actor.branchId };
  }
  const requestedId = clampText(requested, 64);
  if (!requestedId) return { ok: true, branchId: null };
  const branch = await client.posBranch.findFirst({ where: { businessId, id: requestedId, isActive: true } });
  if (!branch) return { ok: false, code: "BRANCH_NOT_FOUND", message: "That location does not belong to this business." };
  return { ok: true, branchId: branch.id };
}

/** The branch a branch-bound actor's reads are forced to; null means business-wide. */
export function forcedBranchId(actor: { branchId: string | null }): string | null {
  return actor.branchId ? actor.branchId : null;
}

/**
 * The branch a READ is scoped to (§16, §75). A staff member bound to a location always reads
 * their own location — a branch named in the request is ignored, not trusted. An unbound actor
 * may name a branch, but only one that exists and belongs to the business.
 */
export async function readBranchId(
  businessId: string,
  actorBranchId: string | null,
  requested: string | null | undefined,
  client: PosClient = db(),
): Promise<{ branchId?: string | null; error?: { code: string; message: string } }> {
  if (actorBranchId) return { branchId: actorBranchId };
  const wanted = clampText(requested, 64);
  if (!wanted) return { branchId: null };
  const branch = await client.posBranch.findFirst({ where: { businessId, id: wanted, isActive: true }, select: { id: true } });
  return branch
    ? { branchId: branch.id }
    : { error: { code: "BRANCH_NOT_FOUND", message: "That location doesn't belong to this business." } };
}

/**
 * May this actor *touch an existing record* recorded at `recordBranchId`? (§16, §75)
 *
 * `resolveBranch` decides where a new row may be written; this decides whether an existing row
 * may be read or changed — the path-parameter case, where a browser supplies the id directly and
 * nothing else in the request mentions a branch at all. Without it a cashier bound to one
 * location can read, refund or void another location's sale by guessing its id (IDOR).
 *
 * - A branch-bound actor may only touch records of their own location. A record with no
 *   location (recorded business-wide by an unbound actor) is not theirs either: their reads are
 *   scoped to their branch, so a record that cannot appear in their list cannot be opened by id.
 * - An actor without a branch (owner, admin, unbound staff) keeps business-wide reach, exactly
 *   as `readBranchId` scopes their reads.
 *
 * Nothing here is taken from the request: the scope is the staff row resolved by `guard.ts`.
 */
export function branchRecordInScope(actor: { branchId?: string | null } | null | undefined, recordBranchId: string | null | undefined): boolean {
  const bound = actor?.branchId ? branchScope(actor.branchId) : "";
  if (!bound) return true;
  return branchScope(recordBranchId) === bound;
}

/** The plain-language refusal a record outside the actor's branch produces (§38). */
export function branchOutOfScopeMessage(): string {
  return "That record belongs to a location you are not assigned to.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Products and services (§13)
// ─────────────────────────────────────────────────────────────────────────────

export type ProductFilter = {
  kind?: "PRODUCT" | "SERVICE" | string;
  search?: string;
  activeOnly?: boolean;
  take?: number;
};

export async function listProducts(businessId: string, filter: ProductFilter = {}, client: PosClient = db()) {
  const where: Record<string, unknown> = { businessId };
  if (filter.kind) where.kind = filter.kind;
  if (filter.activeOnly !== false) where.isActive = true;
  const search = clampText(filter.search, 80);
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { barcode: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
    ];
  }
  return client.posProduct.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: Math.min(asInt(filter.take, 200), 500),
    include: { inventory: true },
  });
}

/** Batch lookup used while building a sale — still tenant-scoped, ids are filtered not trusted. */
export async function findProductsByIds(businessId: string, productIds: string[], client: PosClient = db()) {
  const ids = [...new Set(productIds.filter((id) => typeof id === "string" && id.trim()))].slice(0, 200);
  if (!ids.length) return [];
  return client.posProduct.findMany({ where: { businessId, id: { in: ids } }, include: { inventory: true } });
}

/** Barcode/scan lookup — exact match inside the tenant only (§59). */
export async function findProductByBarcode(businessId: string, barcode: string, client: PosClient = db()) {
  const value = clampText(barcode, 64);
  if (!value) return null;
  return client.posProduct.findFirst({ where: { businessId, barcode: value, isActive: true } });
}

export async function findProduct(businessId: string, productId: string, client: PosClient = db()) {
  const id = clampText(productId, 64);
  if (!id) return null;
  return client.posProduct.findFirst({ where: { businessId, id }, include: { inventory: true } });
}

export type ProductInput = {
  name: string;
  kind?: string;
  category?: string | null;
  description?: string | null;
  unitKey?: string;
  priceKES?: number;
  /** Sale fields, present only when the request sent them (validated in validation.ts). */
  sale?: { salePriceKES: number | null; salePriceStartsAt: Date | null; salePriceEndsAt: Date | null };
  saleError?: string;
  wholesalePriceKES?: number | null;
  costKES?: number | null;
  sku?: string | null;
  barcode?: string | null;
  trackInventory?: boolean;
  reorderLevel?: number;
  taxable?: boolean;
  durationMinutes?: number | null;
  variantOptions?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
  sortOrder?: number;
};

function productData(input: ProductInput): Record<string, unknown> {
  return {
    ...(input.sale ?? {}),
    name: clampText(input.name, 160) ?? "Untitled item",
    kind: input.kind === "SERVICE" ? "SERVICE" : "PRODUCT",
    category: clampText(input.category, 80),
    description: clampText(input.description, 2000),
    unitKey: clampText(input.unitKey, 24) ?? "piece",
    priceKES: Math.max(0, asInt(input.priceKES)),
    wholesalePriceKES: input.wholesalePriceKES == null ? null : Math.max(0, asInt(input.wholesalePriceKES)),
    costKES: input.costKES == null ? null : Math.max(0, asInt(input.costKES)),
    sku: clampText(input.sku, 64),
    barcode: clampText(input.barcode, 64),
    trackInventory: input.trackInventory !== false,
    reorderLevel: Math.max(0, asInt(input.reorderLevel)),
    taxable: input.taxable === true,
    durationMinutes: input.durationMinutes == null ? null : Math.max(0, asInt(input.durationMinutes)),
    variantOptions: clampText(input.variantOptions, 4000),
    imageUrl: clampText(input.imageUrl, 2000),
    isActive: input.isActive !== false,
    sortOrder: asInt(input.sortOrder),
  };
}

export async function createProduct(businessId: string, input: ProductInput, client: PosClient = db()) {
  return client.posProduct.create({ data: { businessId, ...productData(input) } });
}

/** Compound-key update: an id belonging to another business updates nothing. */
export async function updateProduct(businessId: string, productId: string, input: ProductInput, client: PosClient = db()) {
  return client.posProduct.updateMany({ where: { businessId, id: productId }, data: productData(input) });
}

export async function setProductActive(businessId: string, productId: string, isActive: boolean, client: PosClient = db()) {
  return client.posProduct.updateMany({ where: { businessId, id: productId }, data: { isActive } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers (§14) and their assets (§18)
// ─────────────────────────────────────────────────────────────────────────────

export async function listCustomers(businessId: string, options: { search?: string; take?: number; creditOnly?: boolean } = {}, client: PosClient = db()) {
  const where: Record<string, unknown> = { businessId };
  if (options.creditOnly) where.creditEnabled = true;
  const search = clampText(options.search, 80);
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { customerNumber: { contains: search, mode: "insensitive" } },
    ];
  }
  return client.posCustomer.findMany({
    where,
    orderBy: { name: "asc" },
    take: Math.min(asInt(options.take, 100), 500),
    include: { assets: { where: { isActive: true } } },
  });
}

export async function findCustomer(businessId: string, customerId: string, client: PosClient = db()) {
  const id = clampText(customerId, 64);
  if (!id) return null;
  return client.posCustomer.findFirst({ where: { businessId, id }, include: { assets: true } });
}

export async function findCustomerByPhone(businessId: string, phone: string, client: PosClient = db()) {
  const value = clampText(phone, 32);
  if (!value) return null;
  return client.posCustomer.findFirst({ where: { businessId, phone: value } });
}

export type CustomerInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  location?: string | null;
  customerNumber?: string | null;
  segment?: string | null;
  notes?: string | null;
  creditEnabled?: boolean;
  creditLimitKES?: number;
  isActive?: boolean;
};

function customerData(input: CustomerInput): Record<string, unknown> {
  return {
    name: clampText(input.name, 160) ?? "Walk-in customer",
    phone: clampText(input.phone, 32),
    email: clampText(input.email, 160),
    location: clampText(input.location, 160),
    customerNumber: clampText(input.customerNumber, 40),
    segment: clampText(input.segment, 60),
    notes: clampText(input.notes, 2000),
    creditEnabled: input.creditEnabled === true,
    creditLimitKES: Math.max(0, asInt(input.creditLimitKES)),
    isActive: input.isActive !== false,
  };
}

export async function createCustomer(businessId: string, input: CustomerInput, client: PosClient = db()) {
  return client.posCustomer.create({ data: { businessId, ...customerData(input) } });
}

export async function updateCustomer(businessId: string, customerId: string, input: CustomerInput, client: PosClient = db()) {
  return client.posCustomer.updateMany({ where: { businessId, id: customerId }, data: customerData(input) });
}

/**
 * Applies a signed balance change and writes the matching ledger row in one step (§30).
 *
 * The balance is never set from a number the caller read earlier: it moves by `deltaKES` inside
 * a single atomic `UPDATE … SET balanceKES = balanceKES + δ`, so two concurrent sales,
 * repayments or refunds cannot both read the same balance and one of them lose the other's
 * change. The ledger row carries the balance *after* this change, re-read in the same
 * transaction, so the ledger and the balance always agree (§30, §57).
 */
export async function applyBalanceChange(
  businessId: string,
  party: { partyType: "CUSTOMER" | "SUPPLIER"; partyId: string; partyName?: string | null },
  change: { deltaKES: number; direction: "DEBIT" | "CREDIT"; dueAt?: Date | null; saleId?: string | null; paymentId?: string | null; note?: string | null },
  client: PosClient = db(),
) {
  const delta = asInt(change.deltaKES);
  if (delta === 0) return null;
  const model = party.partyType === "SUPPLIER" ? client.posSupplier : client.posCustomer;

  // One statement, no read-modify-write window: the increment happens where the row lives.
  const moved = await model.updateMany({
    where: { businessId, id: party.partyId },
    data: { balanceKES: { increment: delta } },
  });
  if (!moved?.count) return null;

  const existing = await model.findFirst({ where: { businessId, id: party.partyId }, select: { balanceKES: true, name: true } });
  if (!existing) return null;
  const balanceAfterKES = asInt(existing.balanceKES);
  const entry = await client.posCreditEntry.create({
    data: {
      businessId,
      partyType: party.partyType,
      partyId: party.partyId,
      partyName: clampText(party.partyName ?? existing.name, 160),
      direction: change.direction,
      amountKES: Math.abs(delta),
      balanceAfterKES,
      dueAt: change.dueAt ?? null,
      saleId: change.saleId ?? null,
      paymentId: change.paymentId ?? null,
      note: clampText(change.note, 500),
      createdById: null,
    },
  });
  return { balanceKES: balanceAfterKES, entry };
}

/**
 * Takes a row lock on a ledger party for the duration of the caller's transaction (§30).
 *
 * On PostgreSQL this is `SELECT … FOR UPDATE`: a concurrent sale, refund or repayment for the
 * same customer waits here until the first transaction commits, so the decision (is this credit
 * allowed, does this repayment fit the balance?) and the atomic balance move in
 * `applyBalanceChange` run against the same, current number. On a client without raw SQL (the
 * in-memory test double) this is a no-op; the atomic increment still serializes the write.
 */
export async function lockPartyRow(client: PosClient, partyType: "CUSTOMER" | "SUPPLIER", businessId: string, partyId: string): Promise<void> {
  if (!client?.$queryRaw) return;
  // The table name is a fixed identifier chosen here (never user input), so it is spliced with
  // Prisma's raw-identifier helper; the ids are bound parameters. When the generated client is
  // not available (offline build), the helper is absent and the lock is a no-op — the atomic
  // balance increment still makes the write itself safe.
  const rawIdentifier = (prismaClientModule as { Prisma?: { raw?: (value: string) => unknown } }).Prisma?.raw;
  if (typeof rawIdentifier !== "function") return;
  // Quoted, and it has to be. Prisma's raw helper splices the string in verbatim, so an unquoted
  // PosCustomer is folded to lower case by PostgreSQL and matches nothing — the table is created
  // as "PosCustomer". The unquoted form failed with 42P01 ("relation \"poscustomer\" does not
  // exist") on every call, which the bare catch below used to hide while leaving the caller's
  // transaction aborted.
  const table = partyType === "SUPPLIER" ? '"PosSupplier"' : '"PosCustomer"';
  // No try/catch: see lockSaleRow. A failed statement aborts the transaction, and swallowing it
  // here let the credit decision and the balance move run on inside a dead transaction, where
  // the next statement failed with 25P02. The two capability guards above already cover a client
  // that genuinely cannot run raw SQL.
  await client.$queryRaw`SELECT 1 FROM ${rawIdentifier(table)} WHERE "id" = ${partyId} AND "businessId" = ${businessId} FOR UPDATE`;
}

/**
 * Takes a row lock on a sale for the duration of the caller's transaction (§54).
 *
 * A refund re-reads the sale, its lines and its payment rows under this lock, so two concurrent
 * refunds both see every change the other committed: the per-line returned quantity and the
 * cash/credit split can never be computed from the same stale snapshot twice. On a client
 * without raw SQL (the in-memory test double) this is a no-op; the atomic conditional updates
 * below still make each write individually safe.
 */
export async function lockSaleRow(client: PosClient, businessId: string, saleId: string): Promise<void> {
  if (!client?.$queryRaw) return;
  const rawIdentifier = (prismaClientModule as { Prisma?: { raw?: (value: string) => unknown } }).Prisma?.raw;
  if (typeof rawIdentifier !== "function") return;
  // No try/catch here, deliberately.
  //
  // A client that cannot run raw SQL is already handled by the two guards above, so the only
  // thing a catch would still swallow is a real database error — and on PostgreSQL a failed
  // statement aborts the whole transaction. Swallowing it here used to let the refund carry on
  // inside a dead transaction, where the very next read failed with 25P02 ("current transaction
  // is aborted") and surfaced as an opaque engine error instead of the retryable conflict it
  // actually was. A deadlock or a lock timeout has to reach the caller so the transaction rolls
  // back cleanly and the caller can say so.
  await client.$queryRaw`SELECT 1 FROM ${rawIdentifier('"PosSale"')} WHERE "id" = ${saleId} AND "businessId" = ${businessId} FOR UPDATE`;
}

export async function listCreditEntries(
  businessId: string,
  options: { partyType?: "CUSTOMER" | "SUPPLIER"; partyId?: string; take?: number } = {},
  client: PosClient = db(),
) {
  const where: Record<string, unknown> = { businessId };
  if (options.partyType) where.partyType = options.partyType;
  if (options.partyId) where.partyId = options.partyId;
  return client.posCreditEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(asInt(options.take, 100), 500) });
}

export async function addCustomerAsset(
  businessId: string,
  customerId: string,
  asset: { label: string; name: string; identifier?: string | null; detailsJson?: string | null },
  client: PosClient = db(),
) {
  const customer = await client.posCustomer.findFirst({ where: { businessId, id: customerId }, select: { id: true } });
  if (!customer) return null;
  return client.posCustomerAsset.create({
    data: {
      businessId,
      customerId,
      label: clampText(asset.label, 40) ?? "Item",
      name: clampText(asset.name, 160) ?? "Unnamed",
      identifier: clampText(asset.identifier, 80),
      detailsJson: clampText(asset.detailsJson, 4000),
    },
  });
}

export async function listCustomerAssets(businessId: string, customerId: string, client: PosClient = db()) {
  return client.posCustomerAsset.findMany({ where: { businessId, customerId }, orderBy: { createdAt: "desc" } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suppliers (§12)
// ─────────────────────────────────────────────────────────────────────────────

export async function listSuppliers(businessId: string, options: { take?: number } = {}, client: PosClient = db()) {
  return client.posSupplier.findMany({
    where: { businessId },
    orderBy: { name: "asc" },
    take: Math.min(asInt(options.take, 100), 500),
  });
}

export async function findSupplier(businessId: string, supplierId: string, client: PosClient = db()) {
  const id = clampText(supplierId, 64);
  if (!id) return null;
  return client.posSupplier.findFirst({ where: { businessId, id } });
}

export type SupplierInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  location?: string | null;
  termsDays?: number;
  creditEnabled?: boolean;
  notes?: string | null;
  isActive?: boolean;
};

function supplierData(input: SupplierInput): Record<string, unknown> {
  return {
    name: clampText(input.name, 160) ?? "Supplier",
    phone: clampText(input.phone, 32),
    email: clampText(input.email, 160),
    location: clampText(input.location, 160),
    termsDays: Math.max(0, asInt(input.termsDays)),
    creditEnabled: input.creditEnabled === true,
    notes: clampText(input.notes, 2000),
    isActive: input.isActive !== false,
  };
}

export async function createSupplier(businessId: string, input: SupplierInput, client: PosClient = db()) {
  return client.posSupplier.create({ data: { businessId, ...supplierData(input) } });
}

export async function updateSupplier(businessId: string, supplierId: string, input: SupplierInput, client: PosClient = db()) {
  return client.posSupplier.updateMany({ where: { businessId, id: supplierId }, data: supplierData(input) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff and branches (§15, §16)
// ─────────────────────────────────────────────────────────────────────────────

export async function listStaff(businessId: string, options: { activeOnly?: boolean } = {}, client: PosClient = db()) {
  const where: Record<string, unknown> = { businessId };
  if (options.activeOnly !== false) where.isActive = true;
  return client.posStaff.findMany({ where, orderBy: { name: "asc" } });
}

export async function findStaff(businessId: string, staffId: string, client: PosClient = db()) {
  const id = clampText(staffId, 64);
  if (!id) return null;
  return client.posStaff.findFirst({ where: { businessId, id } });
}

export type StaffInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  roleKey?: string;
  branchId?: string | null;
  commissionPercent?: number;
  isActive?: boolean;
};

export async function createStaff(businessId: string, input: StaffInput, client: PosClient = db()) {
  return client.posStaff.create({
    data: {
      businessId,
      name: clampText(input.name, 160) ?? "Staff member",
      phone: clampText(input.phone, 32),
      email: clampText(input.email, 160),
      roleKey: clampText(input.roleKey, 40) ?? "CASHIER",
      branchId: clampText(input.branchId, 64),
      commissionPercent: Math.min(100, Math.max(0, asInt(input.commissionPercent))),
      isActive: input.isActive !== false,
    },
  });
}

export async function updateStaff(businessId: string, staffId: string, input: StaffInput, client: PosClient = db()) {
  return client.posStaff.updateMany({
    where: { businessId, id: staffId },
    data: {
      name: clampText(input.name, 160) ?? undefined,
      phone: clampText(input.phone, 32),
      email: clampText(input.email, 160),
      roleKey: clampText(input.roleKey, 40) ?? undefined,
      branchId: clampText(input.branchId, 64),
      commissionPercent: Math.min(100, Math.max(0, asInt(input.commissionPercent))),
      isActive: input.isActive !== false,
    },
  });
}

export async function listBranches(businessId: string, client: PosClient = db(), options: { only?: string | null } = {}) {
  // `only` scopes the list to one location — a staff member bound to a location is shown their
  // own, never the others (§16, §75).
  const where: Record<string, unknown> = { businessId };
  if (options.only) where.id = options.only;
  return client.posBranch.findMany({ where, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] });
}

export async function createBranch(
  businessId: string,
  input: { name: string; code?: string | null; location?: string | null; phone?: string | null; isPrimary?: boolean },
  client: PosClient = db(),
) {
  return client.posBranch.create({
    data: {
      businessId,
      name: clampText(input.name, 120) ?? "Location",
      code: clampText(input.code, 24),
      location: clampText(input.location, 160),
      phone: clampText(input.phone, 32),
      isPrimary: input.isPrimary === true,
      isActive: true,
    },
  });
}

/**
 * Every business gets exactly one stock location so sales and stock always have a home, even
 * before the owner thinks about branches (§16, §61 — partial operation is allowed immediately).
 */
export async function ensurePrimaryBranch(businessId: string, businessName: string, client: PosClient = db()) {
  const existing = await client.posBranch.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return client.posBranch.create({
    data: { businessId, name: clampText(businessName, 120) ?? "Main", isPrimary: true, isActive: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory (§33) — stock only ever moves through a recorded movement
// ─────────────────────────────────────────────────────────────────────────────

export async function stockLevels(businessId: string, productIds: string[] = [], client: PosClient = db(), options: { branchId?: string | null } = {}) {
  const where: Record<string, unknown> = { businessId };
  if (productIds.length) where.productId = { in: productIds.slice(0, 500) };
  // A branch scope is an exact location, including "" for the business's own stock room.
  if (options.branchId != null) where.branchId = options.branchId;
  return client.posInventoryItem.findMany({ where });
}

export async function listMovements(
  businessId: string,
  options: { productId?: string; branchId?: string | null; reason?: string; range?: DateRange; take?: number } = {},
  client: PosClient = db(),
) {
  const where: Record<string, unknown> = { businessId, ...createdBetween(options.range) };
  if (options.productId) where.productId = options.productId;
  if (options.reason) where.reason = options.reason;
  if (options.branchId != null) where.branchId = options.branchId;
  return client.posInventoryMovement.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(asInt(options.take, 100), 500),
    include: { product: { select: { id: true, name: true, unitKey: true } } },
  });
}

export type MovementInput = {
  productId: string;
  reason: InventoryMovementReason | string;
  delta: number;
  quantity?: number;
  unitKey?: string | null;
  branchId?: string | null;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  createdById?: string | null;
};

/** Raised inside a transaction when a movement would drive stock negative (§33). */
export class StockShortage extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockShortage";
  }
}

/**
 * Writes the ledger row and moves the on-hand number together (§33). There is no code path in
 * the POS that edits `PosInventoryItem.quantity` without a movement: stock is an audit trail,
 * not a field.
 *
 * The on-hand move is a single atomic `UPDATE … SET quantity = quantity + δ` with the
 * not-negative check folded into the same statement's `WHERE` — no read-modify-write window,
 * so two concurrent sales can never both sell the last unit. When the statement matches no row
 * because stock would go negative, a `StockShortage` is raised and the caller's transaction
 * rolls back; when the location simply has no row yet, the row is created idempotently
 * (a concurrent creator of the same row can win without breaking the movement).
 *
 * `options.allowNegative` admits movements that may legitimately land below zero in the system
 * (a corrective count fixing an over-recorded stock); sales never set it.
 */
export async function recordMovement(
  businessId: string,
  input: MovementInput,
  client: PosClient = db(),
  options: { allowNegative?: boolean; configuration?: PosConfiguration | null } = {},
) {
  const scope = branchScope(input.branchId);
  const delta = asQuantity(input.delta);
  const product = await client.posProduct.findFirst({
    where: { businessId, id: input.productId },
    select: { id: true, trackInventory: true, unitKey: true },
  });
  if (!product) return null;

  const movement = await client.posInventoryMovement.create({
    data: {
      businessId,
      productId: product.id,
      branchId: scope || null,
      reason: String(input.reason),
      delta,
      quantity: Math.abs(asQuantity(input.quantity, delta)),
      unitKey: clampText(input.unitKey ?? product.unitKey, 24),
      refType: clampText(input.refType, 32),
      refId: clampText(input.refId, 64),
      note: clampText(input.note, 500),
      createdById: clampText(input.createdById, 64),
    },
  });

  if (product.trackInventory !== false && delta !== 0) {
    const where: Record<string, unknown> = { businessId, productId: product.id, branchId: scope };
    // The negative-stock rule is the configuration's, never the caller's guess: it is the same
    // rule `checkAvailability` applies before a sale is allowed, so a permitted sale can never
    // be refused here (§33, §47). A caller that names the configuration gets its rule; a caller
    // that passes nothing gets the strict rule, so silence never weakens stock protection.
    const allowNegative = options.allowNegative ?? (options.configuration ? negativeStockAllowed(options.configuration) : false);
    const forbidsNegative = delta < 0 && !allowNegative;
    if (forbidsNegative) where.quantity = { gte: Math.abs(delta) };

    const moved = await client.posInventoryItem.updateMany({
      where,
      data: { quantity: { increment: delta } },
    });
    if (!moved?.count) {
      if (forbidsNegative) {
        throw new StockShortage(`Only ${asQuantity(await stockAt(businessId, product.id, scope, client), 0)} ${product.unitKey ?? "units"} left at that location.`);
      }
      // First movement for this location: create the row, then apply the delta — the upsert's
      // update branch covers the race where a concurrent movement created the row first.
      await client.posInventoryItem.upsert({
        where: { productId_branchId: { productId: product.id, branchId: scope } },
        update: { quantity: { increment: delta } },
        create: { businessId, productId: product.id, branchId: scope, quantity: delta, reorderLevel: 0 },
      });
    }
  }

  return movement;
}

async function stockAt(businessId: string, productId: string, scope: string, client: PosClient): Promise<number> {
  const item = await client.posInventoryItem.findFirst({ where: { businessId, productId, branchId: scope }, select: { quantity: true } });
  return asQuantity(item?.quantity);
}

/** Items at or below their reorder level — the "low stock" card (§34). */
export async function lowStock(businessId: string, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  const items = await client.posInventoryItem.findMany({
    where: { businessId, ...(options.branchId != null ? { branchId: options.branchId } : {}) },
    include: { product: { select: { id: true, name: true, unitKey: true, reorderLevel: true, trackInventory: true } } },
  });
  return items.filter((item: any) => {
    const level = Math.max(asInt(item.reorderLevel), asInt(item.product?.reorderLevel));
    return asQuantity(item.quantity) <= level;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sales, items and payments (§27, §31, §54)
// ─────────────────────────────────────────────────────────────────────────────

export type SaleFilter = { range?: DateRange; status?: string; customerId?: string; branchId?: string | null; staffId?: string; channel?: string; take?: number; skip?: number };

export async function listSales(businessId: string, filter: SaleFilter = {}, client: PosClient = db()) {
  const where: Record<string, unknown> = { businessId, ...createdBetween(filter.range) };
  if (filter.status) where.status = filter.status;
  if (filter.customerId) where.customerId = filter.customerId;
  if (filter.staffId) where.staffId = filter.staffId;
  if (filter.channel) where.channel = filter.channel;
  if (filter.branchId != null) where.branchId = filter.branchId;
  return client.posSale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(asInt(filter.take, 50), 200),
    skip: Math.max(0, asInt(filter.skip)),
    include: { items: true, payments: true },
  });
}

export async function countSales(businessId: string, filter: SaleFilter = {}, client: PosClient = db()) {
  const where: Record<string, unknown> = { businessId, ...createdBetween(filter.range) };
  if (filter.status) where.status = filter.status;
  if (filter.customerId) where.customerId = filter.customerId;
  return client.posSale.count({ where });
}

export async function findSale(businessId: string, saleId: string, client: PosClient = db()) {
  const id = clampText(saleId, 64);
  if (!id) return null;
  return client.posSale.findFirst({ where: { businessId, id }, include: { items: true, payments: true } });
}

export async function findSaleByReceipt(businessId: string, receiptNumber: string, client: PosClient = db()) {
  const value = clampText(receiptNumber, 40);
  if (!value) return null;
  return client.posSale.findFirst({ where: { businessId, receiptNumber: value }, include: { items: true, payments: true } });
}

/**
 * Next receipt sequence for the business (§32). Receipt numbers are unique per business, so two
 * tenants can both be on #0007 without colliding — and one tenant can never read another's
 * sequence, because the row is scoped by the unique business id.
 *
 * The number is claimed with a single atomic upsert — `INSERT … ON CONFLICT DO UPDATE SET
 * nextValue = nextValue + 1` — so two concurrent sales always get two different numbers. The
 * old read-max-plus-one let two sales pick the same number and fail one of them; the number now
 * can only be lost if the sale transaction that claimed it rolls back, and even then it is a
 * skipped number, never a duplicate (§32).
 *
 * The row holds the number the *next* sale will take, and the claim returns the one before it.
 * That is what `previewSaleSequence` reads and what migration
 * `20261005020000_pos_sale_refund_integrity` backfills (`MAX("sequence") + 1`); keeping the two
 * in step is what stops a business that already sold from skipping a receipt number forever.
 * A row is created already advanced to 2 so the first sale takes number 1.
 */
export async function nextSaleSequence(businessId: string, client: PosClient = db()) {
  const row = await client.posReceiptSequence.upsert({
    where: { businessId },
    update: { nextValue: { increment: 1 } },
    create: { businessId, nextValue: 2 },
  });
  return asInt(row.nextValue) - 1;
}

/**
 * A read-only peek at the next receipt number for a screen's label. It must NOT consume a
 * number — the sell screen shows "next receipt" on every view, and only an actual sale inside
 * its transaction may advance the sequence.
 */
export async function previewSaleSequence(businessId: string, client: PosClient = db()): Promise<number> {
  const row = await client.posReceiptSequence.findUnique({ where: { businessId } });
  // No row yet means the first sale will take number one.
  return row ? asInt(row.nextValue) : 1;
}

export async function listPayments(
  businessId: string,
  options: { purpose?: string; range?: DateRange; take?: number; saleId?: string } = {},
  client: PosClient = db(),
) {
  const where: Record<string, unknown> = { businessId, ...createdBetween(options.range) };
  if (options.purpose) where.purpose = options.purpose;
  if (options.saleId) where.saleId = options.saleId;
  return client.posPayment.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(asInt(options.take, 100), 500) });
}

/** Totals used by the dashboard cards and reports (§34, §35) — computed in the database. */
export async function salesTotals(businessId: string, range: DateRange = {}, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  const where: Record<string, unknown> = { businessId, ...createdBetween(range) };
  if (options.branchId != null) where.branchId = options.branchId;
  const totals = await client.posSale.aggregate({
    where,
    _sum: { totalKES: true, paidKES: true, balanceKES: true, discountKES: true, refundedKES: true, costKES: true },
    _count: { _all: true },
  });
  return {
    count: asInt(totals?._count?._all),
    totalKES: asInt(totals?._sum?.totalKES),
    paidKES: asInt(totals?._sum?.paidKES),
    balanceKES: asInt(totals?._sum?.balanceKES),
    discountKES: asInt(totals?._sum?.discountKES),
    refundedKES: asInt(totals?._sum?.refundedKES),
    costKES: asInt(totals?._sum?.costKES),
  };
}

/** Best-selling items in a range, by unit quantity (§35). */
export async function topItems(businessId: string, range: DateRange = {}, limit = 10, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  const sales = await client.posSale.findMany({
    where: { businessId, ...createdBetween(range), ...(options.branchId != null ? { branchId: options.branchId } : {}) },
    select: { id: true },
    take: 2000,
  });
  const saleIds = sales.map((sale: any) => sale.id);
  if (!saleIds.length) return [];
  const items = await client.posSaleItem.findMany({
    where: { businessId, saleId: { in: saleIds } },
    select: { name: true, quantity: true, totalKES: true },
  });
  const grouped = new Map<string, { name: string; quantity: number; totalKES: number }>();
  for (const item of items) {
    const row = grouped.get(item.name) ?? { name: item.name, quantity: 0, totalKES: 0 };
    row.quantity += asQuantity(item.quantity);
    row.totalKES += asInt(item.totalKES);
    grouped.set(item.name, row);
  }
  return [...grouped.values()].sort((a, b) => b.quantity - a.quantity).slice(0, Math.min(asInt(limit, 10), 50));
}

/** Payment mix for a range — cash vs M-Pesa vs card vs credit (§31, §35). */
export async function paymentMix(businessId: string, range: DateRange = {}, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  const payments = await client.posPayment.findMany({
    where: { businessId, direction: "IN", status: "SETTLED", ...createdBetween(range), ...(options.branchId != null ? { branchId: options.branchId } : {}) },
    select: { method: true, amountKES: true },
  });
  const grouped = new Map<string, { method: string; count: number; amountKES: number }>();
  for (const payment of payments) {
    const row = grouped.get(payment.method) ?? { method: payment.method, count: 0, amountKES: 0 };
    row.count += 1;
    row.amountKES += asInt(payment.amountKES);
    grouped.set(payment.method, row);
  }
  return [...grouped.values()].sort((a, b) => b.amountKES - a.amountKES);
}

// ─────────────────────────────────────────────────────────────────────────────
// Expenses (§17)
// ─────────────────────────────────────────────────────────────────────────────

export async function listExpenses(
  businessId: string,
  options: { range?: DateRange; categoryKey?: string; branchId?: string | null; take?: number } = {},
  client: PosClient = db(),
) {
  const where: Record<string, unknown> = { businessId };
  const from = toDate(options.range?.from);
  const to = toDate(options.range?.to);
  if (from || to) {
    where.occurredAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  if (options.categoryKey) where.categoryKey = options.categoryKey;
  if (options.branchId != null) where.branchId = options.branchId;
  return client.posExpense.findMany({ where, orderBy: { occurredAt: "desc" }, take: Math.min(asInt(options.take, 100), 500) });
}

export async function expenseTotals(
  businessId: string,
  range: DateRange = {},
  client: PosClient = db(),
  options: { branchId?: string | null } = {},
) {
  // The total is the total of the rows this actor is allowed to read — a location's spend is
  // summed for the people who work that location, not for the whole business (§16, §75).
  const expenses = await listExpenses(businessId, { range, take: 500, branchId: options.branchId }, client);
  const byCategory = new Map<string, { categoryKey: string; amountKES: number }>();
  let amountKES = 0;
  for (const expense of expenses) {
    const value = asInt(expense.amountKES);
    amountKES += value;
    const row = byCategory.get(expense.categoryKey) ?? { categoryKey: expense.categoryKey, amountKES: 0 };
    row.amountKES += value;
    byCategory.set(expense.categoryKey, row);
  }
  return { amountKES, byCategory: [...byCategory.values()].sort((a, b) => b.amountKES - a.amountKES) };
}

export async function createExpense(
  businessId: string,
  input: { categoryKey: string; label?: string | null; amountKES: number; method?: string; reference?: string | null; occurredAt?: Date | string | null; notes?: string | null; branchId?: string | null; createdById?: string | null },
  client: PosClient = db(),
) {
  const occurredAt = toDate(input.occurredAt) ?? new Date();
  return client.posExpense.create({
    data: {
      businessId,
      branchId: clampText(input.branchId, 64),
      categoryKey: clampText(input.categoryKey, 40) ?? "other",
      label: clampText(input.label, 120),
      amountKES: Math.max(0, asInt(input.amountKES)),
      method: clampText(input.method, 32) ?? "cash",
      reference: clampText(input.reference, 80),
      occurredAt,
      notes: clampText(input.notes, 1000),
      createdById: clampText(input.createdById, 64),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchases and receiving (§12, §33)
// ─────────────────────────────────────────────────────────────────────────────

export async function listPurchases(
  businessId: string,
  options: { status?: string; take?: number; branchId?: string | null } = {},
  client: PosClient = db(),
) {
  const where: Record<string, unknown> = { businessId };
  if (options.status) where.status = options.status;
  // Stock is bought in at one location, so the record belongs to that location (§16, §75): a
  // clerk bound to one shop reads that shop's deliveries, not the group's.
  if (options.branchId != null) where.branchId = options.branchId;
  return client.posPurchase.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(asInt(options.take, 50), 200),
    include: { items: true },
  });
}

export async function findPurchase(businessId: string, purchaseId: string, client: PosClient = db()) {
  const id = clampText(purchaseId, 64);
  if (!id) return null;
  return client.posPurchase.findFirst({ where: { businessId, id }, include: { items: true } });
}

export type PurchaseItemInput = { productId?: string | null; name: string; unitKey?: string | null; quantity: number; unitCostKES?: number };

export async function nextPurchaseReference(businessId: string, client: PosClient = db()) {
  const latest = await client.posPurchase.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" }, select: { reference: true } });
  const match = /(\d+)$/.exec(String(latest?.reference ?? ""));
  const next = match ? asInt(match[1]) + 1 : 1;
  return `PO-${String(next).padStart(4, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders (§28, §29)
// ─────────────────────────────────────────────────────────────────────────────

export async function listOrders(
  businessId: string,
  options: { stateKey?: string; workflowKey?: string; channel?: string; range?: DateRange; branchId?: string | null; take?: number } = {},
  client: PosClient = db(),
) {
  const where: Record<string, unknown> = { businessId, ...createdBetween(options.range) };
  if (options.stateKey) where.stateKey = options.stateKey;
  if (options.workflowKey) where.workflowKey = options.workflowKey;
  if (options.channel) where.channel = options.channel;
  if (options.branchId != null) where.branchId = options.branchId;
  return client.posOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(asInt(options.take, 50), 200),
    include: { items: true },
  });
}

export async function findOrder(businessId: string, orderId: string, client: PosClient = db()) {
  const id = clampText(orderId, 64);
  if (!id) return null;
  return client.posOrder.findFirst({ where: { businessId, id }, include: { items: true, events: { orderBy: { createdAt: "asc" } } } });
}

export async function findOrderByReference(businessId: string, reference: string, client: PosClient = db()) {
  const value = clampText(reference, 40);
  if (!value) return null;
  return client.posOrder.findFirst({ where: { businessId, reference: value }, include: { items: true, events: true } });
}

export async function nextOrderReference(businessId: string, prefix: string, client: PosClient = db()) {
  const latest = await client.posOrder.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" }, select: { reference: true } });
  const match = /(\d+)$/.exec(String(latest?.reference ?? ""));
  const next = match ? asInt(match[1]) + 1 : 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

export async function orderStateCounts(businessId: string, workflowKey?: string, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  const where: Record<string, unknown> = { businessId };
  if (workflowKey) where.workflowKey = workflowKey;
  if (options.branchId != null) where.branchId = options.branchId;
  const orders = await client.posOrder.findMany({ where, select: { stateKey: true } });
  const counts = new Map<string, number>();
  for (const order of orders) counts.set(order.stateKey, asInt(counts.get(order.stateKey)) + 1);
  return [...counts.entries()].map(([stateKey, count]) => ({ stateKey, count }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency (§27, §32, §54) — a till that sends the same sale twice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What an idempotency key may be spent on. One key space per action, so a key minted for a sale
 * can never be reused to guard something else.
 */
export const IDEMPOTENCY_SCOPES = { saleCreate: "sale.create" } as const;

export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPES)[keyof typeof IDEMPOTENCY_SCOPES];

export type IdempotencyClaim = {
  businessId: string;
  actorId: string | null;
  scope: IdempotencyScope | string;
  key: string;
  requestHash: string;
};

export type IdempotencyRecord = {
  id: string;
  businessId: string;
  actorId: string;
  scope: string;
  key: string;
  requestHash: string;
  saleId: string | null;
  createdAt: Date | null;
};

/** A client key is bounded and trimmed; anything longer or blank is not a key. */
export function normalizeIdempotencyKey(value: unknown): string | null {
  const key = String(value ?? "").trim();
  if (!key || key.length > 128) return null;
  return key;
}

/**
 * The record a key already bought, or null if the key has not been spent (§27, §32).
 *
 * Read inside the tenant *and* the actor: one cashier's key can never answer for another's
 * request, and the same key in two different shops is two different requests (§5, §54).
 */
export async function findIdempotencyRecord(claim: IdempotencyClaim, client: PosClient = db()): Promise<IdempotencyRecord | null> {
  if (!claim.key || !claim.actorId) return null;
  const row = await client.posIdempotencyRecord.findFirst({
    where: {
      businessId: claim.businessId,
      actorId: claim.actorId,
      scope: claim.scope,
      key: claim.key,
    },
  });
  return (row as IdempotencyRecord | null) ?? null;
}

/**
 * Spend a key inside the caller's own transaction, before anything else is written (§27, §54).
 *
 * This is the whole point of the table: the insert shares the sale's transaction, so a duplicate
 * that arrives while the first request is still open violates the unique index and PostgreSQL
 * rolls the second attempt back with it. There is no window in which two sales can both be
 * created under one key, and a request that was refused (no stock, no permission) never burns
 * its key, because the refusal either happens before this line or rolls the transaction back.
 */
export async function claimIdempotencyKey(claim: IdempotencyClaim, client: PosClient): Promise<void> {
  await client.posIdempotencyRecord.create({
    data: {
      businessId: claim.businessId,
      actorId: claim.actorId ?? "",
      scope: claim.scope,
      key: claim.key,
      requestHash: claim.requestHash,
      saleId: null,
    },
  });
}

/**
 * Record which sale the claimed key bought (§27, §54).
 *
 * Called at the end of the same transaction, so the row only ever carries the id of a sale that
 * actually committed. A duplicate that loses the insert race can therefore always be answered
 * with a real receipt rather than a promise.
 */
export async function completeIdempotencyKey(claim: IdempotencyClaim, saleId: string, client: PosClient): Promise<void> {
  await client.posIdempotencyRecord.updateMany({
    where: {
      businessId: claim.businessId,
      actorId: claim.actorId ?? "",
      scope: claim.scope,
      key: claim.key,
    },
    data: { saleId },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace counts (§34, §61) — the setup checklist and empty states
// ─────────────────────────────────────────────────────────────────────────────

export async function posCounts(businessId: string, client: PosClient = db()) {
  const [products, customers, suppliers, staff, sales, orders, expenses, movements] = await Promise.all([
    client.posProduct.count({ where: { businessId } }),
    client.posCustomer.count({ where: { businessId } }),
    client.posSupplier.count({ where: { businessId } }),
    client.posStaff.count({ where: { businessId } }),
    client.posSale.count({ where: { businessId } }),
    client.posOrder.count({ where: { businessId } }),
    client.posExpense.count({ where: { businessId } }),
    client.posInventoryMovement.count({ where: { businessId } }),
  ]);
  return {
    products: asInt(products),
    customers: asInt(customers),
    suppliers: asInt(suppliers),
    staff: asInt(staff),
    sales: asInt(sales),
    orders: asInt(orders),
    expenses: asInt(expenses),
    movements: asInt(movements),
  };
}

export type PosCounts = Awaited<ReturnType<typeof posCounts>>;

/** Records added since a moment — the "new customers" card (§34). */
export async function countNewCustomers(businessId: string, since: Date, client: PosClient = db()) {
  return client.posCustomer.count({ where: { businessId, createdAt: { gte: since } } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Report reads (§35) — wider windows than the screens, still tenant-scoped
// ─────────────────────────────────────────────────────────────────────────────

export const REPORT_ROW_LIMIT = 5000;

export async function salesForReport(businessId: string, range: DateRange = {}, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  return client.posSale.findMany({
    where: { businessId, ...createdBetween(range), ...(options.branchId != null ? { branchId: options.branchId } : {}) },
    orderBy: { createdAt: "asc" },
    take: REPORT_ROW_LIMIT,
    include: { items: { select: { name: true, quantity: true, totalKES: true, costKES: true } }, payments: { select: { method: true, amountKES: true, direction: true } } },
  });
}

export async function expensesForReport(businessId: string, range: DateRange = {}, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  const from = toDate(range.from);
  const to = toDate(range.to);
  return client.posExpense.findMany({
    where: { businessId, ...(options.branchId != null ? { branchId: options.branchId } : {}), ...((from || to) ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    orderBy: { occurredAt: "asc" },
    take: REPORT_ROW_LIMIT,
    select: { id: true, createdAt: true, occurredAt: true, categoryKey: true, amountKES: true, method: true, branchId: true },
  });
}

/**
 * The cash ledger for a range (§35, §57): every settled money movement the till recorded —
 * sales and repayments in, refunds, supplier payments and expenses out. This is the only
 * source the daily closing uses for "what the drawer should hold", so the figure can never
 * disagree with the ledger it was counted from.
 */
export async function paymentsForReport(businessId: string, range: DateRange = {}, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  return client.posPayment.findMany({
    where: { businessId, status: "SETTLED", ...createdBetween(range), ...(options.branchId != null ? { branchId: options.branchId } : {}) },
    orderBy: { createdAt: "asc" },
    take: REPORT_ROW_LIMIT,
    select: { id: true, createdAt: true, direction: true, purpose: true, method: true, amountKES: true, branchId: true },
  });
}

export async function movementsForReport(businessId: string, range: DateRange = {}, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  return client.posInventoryMovement.findMany({
    where: { businessId, ...createdBetween(range), ...(options.branchId != null ? { branchId: options.branchId } : {}) },
    orderBy: { createdAt: "asc" },
    take: REPORT_ROW_LIMIT,
    include: { product: { select: { id: true, name: true, unitKey: true, costKES: true } } },
  });
}

export async function ordersForReport(businessId: string, range: DateRange = {}, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  return client.posOrder.findMany({
    where: { businessId, ...createdBetween(range), ...(options.branchId != null ? { branchId: options.branchId } : {}) },
    orderBy: { createdAt: "asc" },
    take: REPORT_ROW_LIMIT,
    include: { items: true },
  });
}

/** Stock with the product's cost price, for valuation (§35 — calculated, never guessed). */
export async function stockWithProducts(businessId: string, client: PosClient = db(), options: { branchId?: string | null } = {}) {
  return client.posInventoryItem.findMany({
    where: { businessId, ...(options.branchId != null ? { branchId: options.branchId } : {}) },
    include: { product: { select: { id: true, name: true, unitKey: true, costKES: true, priceKES: true, trackInventory: true } } },
  });
}

/** Debtors and creditors with their oldest open entry, for ageing (§30). */
export async function partiesWithBalances(
  businessId: string,
  partyType: "CUSTOMER" | "SUPPLIER",
  client: PosClient = db(),
) {
  const rows = partyType === "SUPPLIER"
    ? await client.posSupplier.findMany({ where: { businessId }, select: { id: true, name: true, balanceKES: true, termsDays: true, phone: true } })
    : await client.posCustomer.findMany({
        where: { businessId, creditEnabled: true },
        select: { id: true, name: true, balanceKES: true, creditLimitKES: true, phone: true },
      });
  const entries = await client.posCreditEntry.findMany({
    where: { businessId, partyType, direction: "DEBIT" },
    select: { partyId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: REPORT_ROW_LIMIT,
  });
  const oldest = new Map<string, Date>();
  for (const entry of entries) {
    if (!oldest.has(entry.partyId)) oldest.set(entry.partyId, entry.createdAt);
  }
  return rows.map((row: any) => ({ ...row, oldestEntryAt: oldest.get(row.id) ?? null }));
}
