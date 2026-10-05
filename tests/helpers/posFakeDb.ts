/**
 * An in-memory stand-in for Prisma, used by the POS security and journey tests.
 *
 * It implements just enough of the client for the POS data layer to run: tenant-scoped `where`
 * matching (including `in`, `gte`/`lte`, `contains`, `OR`), the compound-key updates the store
 * relies on, relations via `include`, and `$transaction` as a pass-through. Because it is a real
 * filter rather than a stub, a test can prove that a foreign record id simply matches nothing.
 *
 * Load it from inside a `vi.mock("@/lib/db", …)` factory (the factory runs before imports):
 *
 *   vi.mock("@/lib/db", async () => {
 *     const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
 *     const fake = createFakeDb(standardSeed());
 *     (globalThis as any).__posFake = fake;
 *     return { default: fake.db };
 *   });
 */

export type Row = Record<string, any>;

export function rowMatches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === "OR") {
      if (!(condition as Row[]).some((clause) => rowMatches(row, clause))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(condition as Row[]).every((clause) => rowMatches(row, clause))) return false;
      continue;
    }
    const value = row[key];
    if (condition && typeof condition === "object" && !Array.isArray(condition) && !(condition instanceof Date)) {
      const filter = condition as Row;
      const known = ["in", "notIn", "gte", "lte", "gt", "lt", "contains", "startsWith", "equals", "not"];
      if (known.some((operator) => operator in filter)) {
        if ("in" in filter && !filter.in.includes(value)) return false;
        if ("notIn" in filter && filter.notIn.includes(value)) return false;
        if ("gte" in filter && !(value >= filter.gte)) return false;
        if ("lte" in filter && !(value <= filter.lte)) return false;
        if ("gt" in filter && !(value > filter.gt)) return false;
        if ("lt" in filter && !(value < filter.lt)) return false;
        if ("contains" in filter && !String(value ?? "").toLowerCase().includes(String(filter.contains).toLowerCase())) return false;
        if ("equals" in filter && value !== filter.equals) return false;
        continue;
      }
      // Prisma compound-unique input: `{ productId_branchId: { productId, branchId } }` — the
      // key is the underlying fields joined by underscores. It matches when every named field
      // of the pair matches this row (and fails when the pair is given but nothing matches).
      if (Object.keys(filter).length === 1 && key.includes("_")) {
        const compoundKey = Object.keys(filter)[0];
        const compound = filter[compoundKey];
        if (compound && typeof compound === "object" && !Array.isArray(compound)) {
          const entries = Object.entries(compound as Row);
          const parts = compoundKey.split("_");
          if (entries.length > 0 && parts.length >= entries.length) {
            const fields = parts.slice(0, entries.length);
            const matched = entries.every(([field, wanted]) => row[field] === wanted);
            if (matched) continue;
          }
          return false;
        }
        continue; // any other single-key object is a relation filter: not modelled
      }
      continue; // relation filter: not modelled
    }
    if (value !== condition) return false;
  }
  return true;
}

/**
 * Applies a Prisma update payload to a row: plain values assign, and the atomic operators
 * (`increment`, `decrement`, `multiply`, `divide`) change the existing value in place — the
 * in-memory equivalent of the single-statement `SET column = column + δ` the real client sends.
 */
export function applyUpdateData(row: Row, data: Row | undefined): void {
  if (!data) return;
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      const operator = value as Row;
      const current = Number(row[key] ?? 0);
      if ("increment" in operator) row[key] = current + Number(operator.increment);
      else if ("decrement" in operator) row[key] = current - Number(operator.decrement);
      else if ("multiply" in operator) row[key] = current * Number(operator.multiply);
      else if ("divide" in operator) row[key] = Number(operator.divide) ? current / Number(operator.divide) : current;
      else row[key] = value;
      continue;
    }
    row[key] = value;
  }
}

/**
 * `include` shapes the real client uses. A relation may resolve against more than one model:
 * `items` means sale lines on a sale (§27) and purchase lines on a purchase order (§12), exactly
 * as it does in Prisma, where each model has its own `items` field.
 */
const RELATIONS: Record<string, { field: string; key: string }[]> = {
  inventory: [{ field: "posInventoryItem", key: "productId" }],
  items: [{ field: "posSaleItem", key: "saleId" }, { field: "posPurchaseItem", key: "purchaseId" }],
  payments: [{ field: "posPayment", key: "saleId" }],
  product: [{ field: "posProduct", key: "productId" }],
  assets: [{ field: "posCustomerAsset", key: "customerId" }],
  events: [{ field: "posOrderEvent", key: "orderId" }],
};

export type FakeDb = {
  db: any;
  state: Record<string, Row[]>;
  rows: (model: string) => Row[];
  reset: (seed?: Record<string, Row[]>) => void;
  calls: (model: string, method: string) => any[][];
};

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const state: Record<string, Row[]> = {};
  const models: Record<string, any> = {};
  let counter = 0;

  function ensure(name: string): Row[] {
    if (!state[name]) state[name] = [];
    return state[name];
  }

  function decorate(row: Row, include: Row | undefined): Row {
    if (!include) return row;
    const copy = { ...row };
    for (const [relation, candidates] of Object.entries(RELATIONS)) {
      if (!include[relation]) continue;
      if (relation === "product") {
        copy.product = ensure("posProduct").find((product) => product.id === row.productId) ?? null;
        continue;
      }
      // The first candidate model that actually holds lines for this row wins; the others are
      // empty, which is what Prisma would return for a relation of that name on this model.
      const related = candidates
        .map((config) => ensure(config.field).filter((entry) => entry[config.key] === row.id || entry[config.key] === row[config.key]))
        .find((matches) => matches.length > 0) ?? [];
      copy[relation] = related;
    }
    return copy;
  }

  function buildModel(name: string) {
    const rows = ensure(name);
    return {
      findMany: vi_fn(async ({ where, include }: any = {}) => rows.filter((row) => rowMatches(row, where)).map((row) => decorate(row, include))),
      findFirst: vi_fn(async ({ where, include }: any = {}) => {
        const row = rows.find((entry) => rowMatches(entry, where));
        return row ? decorate(row, include) : null;
      }),
      findUnique: vi_fn(async ({ where, include }: any = {}) => {
        const row = rows.find((entry) => rowMatches(entry, where));
        return row ? decorate(row, include) : null;
      }),
      count: vi_fn(async ({ where }: any = {}) => rows.filter((row) => rowMatches(row, where)).length),
      aggregate: vi_fn(async ({ where, _sum }: any = {}) => {
        const scoped = rows.filter((row) => rowMatches(row, where));
        const sum: Row = {};
        for (const key of Object.keys(_sum ?? {})) sum[key] = scoped.reduce((total, row) => total + Number(row[key] ?? 0), 0);
        return { _sum: sum, _count: { _all: scoped.length } };
      }),
      create: vi_fn(async ({ data }: any) => {
        const row = { id: data.id ?? `${name}_${++counter}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      createMany: vi_fn(async ({ data }: any) => {
        const list = Array.isArray(data) ? data : [data];
        for (const entry of list) rows.push({ id: `${name}_${++counter}`, ...entry });
        return { count: list.length };
      }),
      update: vi_fn(async ({ where, data }: any) => {
        const row = rows.find((entry) => rowMatches(entry, where));
        if (!row) throw Object.assign(new Error("Record to update does not exist."), { code: "P2025" });
        applyUpdateData(row, data);
        return row;
      }),
      updateMany: vi_fn(async ({ where, data }: any) => {
        const scoped = rows.filter((row) => rowMatches(row, where));
        for (const row of scoped) applyUpdateData(row, data);
        return { count: scoped.length };
      }),
      upsert: vi_fn(async ({ where, create, update }: any) => {
        const row = rows.find((entry) => rowMatches(entry, where));
        if (row) {
          applyUpdateData(row, update);
          return row;
        }
        const created = { id: `${name}_${++counter}`, ...create };
        rows.push(created);
        return created;
      }),
      delete: vi_fn(async ({ where }: any) => {
        const index = rows.findIndex((row) => rowMatches(row, where));
        if (index < 0) throw Object.assign(new Error("Record to delete does not exist."), { code: "P2025" });
        return rows.splice(index, 1)[0];
      }),
      deleteMany: vi_fn(async ({ where }: any) => {
        const scoped = rows.filter((row) => rowMatches(row, where));
        for (const row of scoped) rows.splice(rows.indexOf(row), 1);
        return { count: scoped.length };
      }),
    };
  }

  const db = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === "$transaction") {
          // Pass-through. It is deliberately NOT a snapshot/rollback: undoing a failed
          // transaction by restoring an entry-time snapshot would also erase changes committed
          // by a concurrent transaction between the snapshot and the failure — the opposite of
          // what PostgreSQL does. Failed-write visibility is therefore asserted only where the
          // engine guarantees it without rollback (the compare-and-set caps), and true
          // transactional rollback is exercised by the DATABASE_URL-backed suites.
          return async (work: any) => (typeof work === "function" ? work(db) : Promise.all(work));
        }
        // The fake lets non-concurrency unit tests reach refund logic. PostgreSQL locking semantics
        // are exercised only by the dedicated DATABASE_URL-backed refund integration suite.
        if (property === "$queryRaw") return async () => [];
        if (property === "$connect" || property === "$disconnect") return async () => undefined;
        if (typeof property !== "string") return undefined;
        ensure(property);
        if (!models[property]) models[property] = buildModel(property);
        return models[property];
      },
    },
  );

  function reset(next: Record<string, Row[]> = seed) {
    for (const key of Object.keys(state)) state[key].length = 0;
    for (const [key, rows] of Object.entries(next)) {
      // Copy every row: a test that updates a record must not mutate the fixture itself, or the
      // next test would start from the previous test's numbers.
      ensure(key).push(...rows.map((row) => ({ ...row })));
    }
  }

  reset(seed);

  return {
    db,
    state,
    rows: (name: string) => ensure(name),
    reset,
    calls: (name: string, method: string) => (models[name]?.[method]?.mock?.calls ?? []),
  };
}

/** Minimal `vi.fn` clone so this helper has no vitest import of its own. */
function vi_fn<T extends (...args: any[]) => any>(implementation: T) {
  const calls: any[][] = [];
  const wrapped = (async (...args: any[]) => {
    calls.push(args);
    return implementation(...(args as Parameters<T>));
  }) as T & { mock: { calls: any[][] } };
  wrapped.mock = { calls };
  return wrapped;
}

/** Two tenants, one configuration each, and enough records to trade with. */
export function standardSeed(): Record<string, Row[]> {
  return {
    business: [
      { id: "bizA", ownerId: "userA", name: "Nyumbani Kitchen", slug: "nyumbani", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null },
      { id: "bizB", ownerId: "userB", name: "Mwangi Hardware", slug: "mwangi", phone: "0723000000", whatsapp: null, location: "Kisumu", logoUrl: null, email: null },
      // A second business owned by the same person: the legitimate target of a copied setup (§25).
      { id: "bizA2", ownerId: "userA", name: "Nyumbani Catering", slug: "nyumbani-catering", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null },
    ],
    businessMember: [{ id: "mem_a", businessId: "bizA", userId: "cashierA", role: "STAFF" }],
    user: [
      { id: "userA", name: "Owner A", email: "a@example.com" },
      { id: "userB", name: "Owner B", email: "b@example.com" },
      { id: "cashierA", name: "Mary Cashier", email: "mary@example.com" },
    ],
    posConfiguration: [],
    posConfigurationVersion: [],
    posSubscription: [],
    posEntitlement: [],
    posReceiptSequence: [],
    posBranch: [{ id: "br_a1", businessId: "bizA", name: "Nyumbani Kitchen", isPrimary: true, isActive: true }],
    posStaff: [{ id: "st_a1", businessId: "bizA", userId: "cashierA", name: "Mary Cashier", roleKey: "CASHIER", isActive: true, branchId: null, commissionPercent: 0 }],
    posProduct: [
      { id: "p_a1", businessId: "bizA", name: "Chapati", kind: "PRODUCT", priceKES: 50, costKES: 20, unitKey: "piece", trackInventory: true, isActive: true, reorderLevel: 5, sortOrder: 0 },
      { id: "p_a2", businessId: "bizA", name: "Pilau", kind: "PRODUCT", priceKES: 250, costKES: 120, unitKey: "plate", trackInventory: true, isActive: true, reorderLevel: 0, sortOrder: 1 },
      { id: "p_a3", businessId: "bizA", name: "Delivery", kind: "SERVICE", priceKES: 100, unitKey: "visit", trackInventory: false, isActive: true, reorderLevel: 0, sortOrder: 2 },
      { id: "p_b1", businessId: "bizB", name: "Cement 50kg", kind: "PRODUCT", priceKES: 900, costKES: 700, unitKey: "bag", trackInventory: true, isActive: true, reorderLevel: 10, sortOrder: 0 },
    ],
    posCustomer: [
      { id: "c_a1", businessId: "bizA", name: "Jane Wanjiku", phone: "0712111111", balanceKES: 0, creditEnabled: true, creditLimitKES: 2000 },
      { id: "c_b1", businessId: "bizB", name: "Peter Otieno", phone: "0723111111", balanceKES: 0, creditEnabled: false, creditLimitKES: 0 },
    ],
    posCustomerAsset: [],
    posSupplier: [{ id: "s_a1", businessId: "bizA", name: "Millers Ltd", balanceKES: 0, termsDays: 30, creditEnabled: true }],
    posInventoryItem: [
      { id: "inv_a1", businessId: "bizA", productId: "p_a1", branchId: "", quantity: 40, reorderLevel: 5 },
      { id: "inv_a2", businessId: "bizA", productId: "p_a2", branchId: "", quantity: 10, reorderLevel: 0 },
    ],
    posInventoryMovement: [],
    posSale: [],
    posSaleItem: [],
    posPayment: [],
    posCreditEntry: [],
    posExpense: [],
    posPurchase: [],
    posPurchaseItem: [],
    posOrder: [],
    posOrderItem: [],
    posOrderEvent: [],
    posAuditEvent: [],
    posTemplate: [],
    payment: [],
    processedWebhook: [],
    planConfig: [{ id: "plan_pos", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS", priceKES: 499, durationDays: 30, isActive: true }],
  };
}
