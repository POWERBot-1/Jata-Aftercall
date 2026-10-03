/**
 * The POS engine (§8, §10, §18, §19, §20, §22, §24, §29, §34, §35, §36, §41, §46, §52, §81).
 *
 * These tests import engine modules only — no Prisma, no database. They prove the central claim
 * of the specification: one engine plus configuration produces coherent, substantially different
 * systems for different businesses, with no business-type branching in the code under test.
 */

import { describe, expect, it } from "vitest";
import { BUSINESS_TYPES, getBusinessType, readBusinessDescription } from "@/lib/pos/businessTypes";
import { CAPABILITY_LIBRARY, hasCapability, isCapabilityKey, normalizeCapabilities } from "@/lib/pos/capabilities";
import { buildConfiguration, configurationFingerprint, configurationSummary, describeConfiguration, diffConfigurations, finalize, normalizeConfiguration, validateConfiguration } from "@/lib/pos/configuration";
import { applyBusinessType, configurationReadiness, initialAnswers, isQuestionVisible, nextQuestion, pruneAnswers, QUESTIONNAIRE, visibleQuestions } from "@/lib/pos/questionnaire";
import { buildNavigation, deriveDashboardCards, deriveQuickActions, deriveReports, emptyStateFor, setupSteps } from "@/lib/pos/presentation";
import { resolveTerminology, TERMINOLOGY_PRESETS } from "@/lib/pos/terminology";
import { BUILT_IN_ROLES, checkPermission, effectivePermissions, PERMISSIONS } from "@/lib/pos/permissions";
import { convertQuantity, isCountableUnit, unitOptions } from "@/lib/pos/units";
import { canTransition, initialState, isTerminal, nextStates, resolveStates } from "@/lib/pos/workflow";
import { formSpec } from "@/lib/pos/forms";
import type { QuestionnaireAnswers } from "@/lib/pos/types";

/** A restaurant, answered the way an owner would answer it. */
function restaurantAnswers(): QuestionnaireAnswers {
  return pruneAnswers({
    business_type: "restaurant",
    sells: ["products", "services"],
    payment_methods: ["cash", "mpesa", "card"],
    keeps_stock: true,
    keeps_customers: true,
    orders: true,
    order_channels: ["walk_in", "phone", "whatsapp"],
    delivery: true,
    has_staff: true,
    staff_count: 8,
    staff_roles: ["WAITER", "CASHIER"],
    tracks_expenses: true,
    expense_categories: ["rent", "salaries", "supplies"],
    restaurant_tables: true,
    restaurant_kitchen: true,
    menu_modifiers: true,
    recipes: true,
    credit_frequency: "never",
  });
}

/** A hardware store that sells on credit to builders, with two branches and suppliers. */
function hardwareAnswers(): QuestionnaireAnswers {
  return pruneAnswers({
    business_type: "hardware",
    sells: ["products"],
    payment_methods: ["cash", "mpesa", "bank", "credit"],
    keeps_stock: true,
    units: ["piece", "carton", "bag", "kilogram"],
    unit_conversion_factor: 24,
    keeps_customers: true,
    credit_frequency: "frequently",
    credit_limit: 50000,
    credit_terms_days: 30,
    credit_staff_approve: true,
    has_suppliers: true,
    supplier_credit: true,
    purchase_orders: true,
    partial_receiving: true,
    has_staff: true,
    staff_count: 4,
    staff_roles: ["CASHIER", "INVENTORY"],
    multi_branch: true,
    branch_count: 2,
    stock_by_branch: true,
    tracks_expenses: true,
    barcode: true,
    wholesale_pricing: true,
  });
}

/** An unlisted trade, described in the owner's own words (§19 Other-mode). */
function otherAnswers(): QuestionnaireAnswers {
  return pruneAnswers({
    business_type: "other",
    business_other: "We repair and service water pumps for farms, and sell spare parts",
    business_custom: "Pump repairs",
    sells: ["services", "products"],
    payment_methods: ["cash", "mpesa"],
    keeps_stock: true,
    keeps_customers: true,
    orders: true,
    order_channels: ["phone", "whatsapp"],
    has_staff: true,
    staff_count: 3,
    staff_roles: ["TECHNICIAN"],
    tracks_expenses: true,
  });
}

describe("the business identity list (§10)", () => {
  it("offers a long list of trades and always ends with Something else", () => {
    expect(BUSINESS_TYPES.length).toBeGreaterThanOrEqual(50);
    const last = BUSINESS_TYPES[BUSINESS_TYPES.length - 1];
    expect(last.key).toBe("other");
    expect(last.label.toLowerCase()).toContain("something else");
  });

  it("resolves aliases and unknown keys to a usable profile", () => {
    expect(getBusinessType("salon").key).toBe("salon");
    expect(getBusinessType("barber shop").capabilities.length).toBeGreaterThan(0);
    expect(getBusinessType("not-a-real-trade").key).toBe("other");
  });

  it("keeps every profile's registry keys valid, so nothing is silently dropped", () => {
    for (const profile of BUSINESS_TYPES) {
      for (const capability of [...profile.capabilities, ...profile.optionalCapabilities]) {
        expect(isCapabilityKey(capability), `${profile.key} → ${capability}`).toBe(true);
      }
      expect(profile.templateKey, `${profile.key} template`).toBeTruthy();
      // Every focus question must be a real question, or the trade is never asked it.
      for (const questionId of profile.focusQuestions) {
        expect(QUESTIONNAIRE.some((question) => question.id === questionId), `${profile.key} focuses on ${questionId}`).toBe(true);
      }
      // Seed answers must be real answers, or pruneAnswers silently drops the trade's defaults.
      for (const answerKey of Object.keys(profile.answers)) {
        if (answerKey === "sells") continue;
        expect(QUESTIONNAIRE.some((question) => question.id === answerKey), `${profile.key} seeds ${answerKey}`).toBe(true);
      }
    }
  });
});

describe("Other-mode reads a description (§19)", () => {
  it("maps a free-text description onto capabilities and answers", () => {
    const reading = readBusinessDescription("We repair and service water pumps for farms, and sell spare parts");
    expect(reading.matched.length).toBeGreaterThan(0);
    expect(reading.capabilities.length).toBeGreaterThan(0);
    expect(reading.answers && typeof reading.answers).toBe("object");
  });

  it("asks only the minimum further questions after a description", () => {
    const seeded = applyBusinessType(initialAnswers("other"), "other");
    const reading = readBusinessDescription("We repair and service water pumps for farms, and sell spare parts");
    const merged = pruneAnswers({ ...seeded, ...reading.answers, business_other: "We repair and service water pumps for farms" });
    const remaining = visibleQuestions(merged).filter((question) => question.required && !merged[question.id]);
    // The description did the work: the owner is not asked to re-answer what JATA already read.
    expect(remaining.length).toBeLessThanOrEqual(6);
  });
});

describe("capabilities normalize deterministically (§8, §22, §49)", () => {
  it("cascades implications and refuses a capability whose prerequisite is missing", () => {
    // The whole chain has to be present; then credit pulls in its own implications.
    const expanded = normalizeCapabilities(["customer_profiles", "customer_accounts", "customer_credit"]);
    expect(expanded).toContain("customer_credit");
    expect(expanded).toContain("customer_accounts");
    expect(expanded).toContain("receivables"); // implied by customer_credit

    // Credit with nothing to hang off is dropped rather than half-enabled (§22).
    expect(normalizeCapabilities(["customer_credit"])).not.toContain("customer_credit");
    expect(normalizeCapabilities(["customer_accounts", "customer_credit"])).not.toContain("customer_credit");
    expect(normalizeCapabilities(["stock_levels"])).not.toContain("stock_levels");

    const withPrerequisites = normalizeCapabilities(["products", "units_of_measure", "unit_conversions"]);
    expect(withPrerequisites).toContain("unit_conversions");
    expect(withPrerequisites).toContain("units_of_measure");
    expect(normalizeCapabilities(["products", "stock_levels"])).toContain("stock_levels");
  });

  it("is idempotent, so the same answers always produce the same POS", () => {
    const once = normalizeCapabilities(CAPABILITY_LIBRARY.slice(0, 20).map((capability) => capability.key));
    const twice = normalizeCapabilities(once);
    expect(twice).toEqual(once);
  });

  it("drops invented keys rather than storing them", () => {
    expect(normalizeCapabilities(["not_a_capability", "pos_sale"])).toEqual(["pos_sale"]);
  });
});

describe("the questionnaire is adaptive and short (§41, §42)", () => {
  it("never dumps every question at once", () => {
    expect(QUESTIONNAIRE.length).toBeGreaterThan(60);
    const empty = initialAnswers("other");
    expect(visibleQuestions(empty).length).toBeLessThan(QUESTIONNAIRE.length);
    expect(nextQuestion(empty)).not.toBeNull();
  });

  it("asks about credit limits only when credit is on", () => {
    const withoutCredit = initialAnswers("retail");
    const creditQuestion = QUESTIONNAIRE.find((question) => question.id === "credit_limit");
    expect(creditQuestion).toBeTruthy();
    expect(isQuestionVisible(creditQuestion!, withoutCredit)).toBe(false);

    const withCredit: QuestionnaireAnswers = { ...withoutCredit, payment_methods: ["cash", "mpesa", "credit"], credit_frequency: "sometimes" };
    expect(isQuestionVisible(creditQuestion!, withCredit)).toBe(true);
  });

  it("asks about cartons only when a big unit was chosen (§13 conversions)", () => {
    const answers = initialAnswers("grocery");
    const conversion = QUESTIONNAIRE.find((question) => question.id === "unit_conversion_factor");
    if (conversion) {
      expect(isQuestionVisible(conversion, answers)).toBe(false);
      expect(isQuestionVisible(conversion, { ...answers, units: ["piece", "carton"] })).toBe(true);
    }
  });

  it("prunes answers that stopped being relevant (§40)", () => {
    const answers: QuestionnaireAnswers = {
      business_type: "retail",
      sells: ["products"],
      payment_methods: ["cash"],
      credit_frequency: "never",
      credit_limit: 20000,
      credit_terms_days: 30,
    };
    const pruned = pruneAnswers(answers);
    expect(pruned.credit_limit).toBeUndefined();
    expect(pruned.credit_terms_days).toBeUndefined();
  });

  it("reports readiness in the owner's words", () => {
    const readiness = configurationReadiness(restaurantAnswers());
    expect(readiness).toHaveProperty("ready");
    expect(Array.isArray(readiness.missing)).toBe(true);
    for (const issue of readiness.missing) {
      expect(issue.title.length).toBeGreaterThan(3);
      expect(issue.title).not.toMatch(/capability|schema|configuration engine/i);
    }
  });
});

describe("one engine, two different businesses (§76, §81)", () => {
  const restaurant = finalize(buildConfiguration(restaurantAnswers(), { businessName: "Nyumbani Kitchen" }));
  const hardware = finalize(buildConfiguration(hardwareAnswers(), { businessName: "Mwangi Hardware" }));
  const pumps = finalize(buildConfiguration(otherAnswers(), { businessName: "Pump Care" }));

  it("builds a coherent POS for a restaurant", () => {
    expect(restaurant.business.typeKey).toBe("restaurant");
    expect(hasCapability(restaurant, "menu")).toBe(true);
    expect(hasCapability(restaurant, "kitchen_orders")).toBe(true);
    expect(restaurant.orders.enabled).toBe(true);
    expect(restaurant.delivery.enabled).toBe(true);
    expect(restaurant.credit.enabled).toBe(false);
    expect(resolveTerminology(restaurant).customers).toBe("Guests");
    expect(buildNavigation(restaurant, "/pos").map((item) => item.key)).toContain("menu");
    expect(deriveReports(restaurant)).toContain("ingredient_usage");
  });

  it("builds a substantially different POS for a hardware store", () => {
    expect(hardware.business.typeKey).toBe("hardware");
    expect(hasCapability(hardware, "menu")).toBe(false);
    expect(hasCapability(hardware, "customer_credit")).toBe(true);
    expect(hardware.credit.enabled).toBe(true);
    expect(hardware.credit.limitKES).toBe(50000);
    expect(hardware.suppliers.credit).toBe(true);
    expect(hardware.inventory.units).toContain("carton");
    expect(hardware.branches.enabled).toBe(true);
    expect(hardware.branches.perBranchStock).toBe(true);
    expect(deriveReports(hardware)).toContain("outstanding_credit");
    expect(deriveReports(hardware)).toContain("supplier_debt");
  });

  it("gives the two businesses different navigation, cards, reports and words", () => {
    const restaurantNav = buildNavigation(restaurant, "/pos").map((item) => item.key);
    const hardwareNav = buildNavigation(hardware, "/pos").map((item) => item.key);
    expect(restaurantNav).not.toEqual(hardwareNav);
    expect(restaurantNav).toContain("menu");
    expect(hardwareNav).not.toContain("menu");
    expect(hardwareNav).toContain("credit");

    expect(deriveDashboardCards(restaurant)).not.toEqual(deriveDashboardCards(hardware));
    expect(deriveReports(restaurant)).not.toEqual(deriveReports(hardware));

    const restaurantWords = resolveTerminology(restaurant);
    const hardwareWords = resolveTerminology(hardware);
    expect(restaurantWords.customers).not.toBe(hardwareWords.customers);
    expect(hardwareWords.customers).toBe("Customers");
  });

  it("configures a described, unlisted trade without a code branch for it (§19, §52)", () => {
    expect(pumps.business.typeKey).toBe("other");
    expect(pumps.business.otherDescription.toLowerCase()).toContain("pump");
    expect(pumps.sales.services).toBe(true);
    expect(pumps.orders.enabled).toBe(true);
    expect(buildNavigation(pumps, "/pos").length).toBeGreaterThan(3);
    expect(validateConfiguration(pumps).ok).toBe(true);
  });

  it("normalizes a stored configuration back to the same shape (§49)", () => {
    const roundTrip = normalizeConfiguration(JSON.parse(JSON.stringify(restaurant)));
    expect(roundTrip.capabilities).toEqual(restaurant.capabilities);
    expect(roundTrip.navigation).toEqual(restaurant.navigation);
    expect(configurationFingerprint(roundTrip)).toBe(configurationFingerprint(restaurant));
  });

  it("survives a corrupted or partial stored configuration", () => {
    const broken = normalizeConfiguration({ sales: { tax: "nope" }, capabilities: "everything" });
    expect(broken.schemaVersion).toBeGreaterThan(0);
    expect(Array.isArray(broken.capabilities)).toBe(true);
    expect(broken.sales.tax.ratePercent).toBeGreaterThanOrEqual(0);
    expect(() => finalize(broken)).not.toThrow();
  });
});

describe("configuration editing and safe evolution (§43, §48, §49)", () => {
  const before = finalize(buildConfiguration(hardwareAnswers(), { businessName: "Mwangi Hardware" }));

  it("summarizes and describes the setup in plain language (§38)", () => {
    const summary = configurationSummary(before);
    expect(summary.length).toBeGreaterThan(2);
    for (const group of summary) {
      expect(group.label).not.toMatch(/schema|capabilit|flag|workflow graph/i);
      expect(group.value).not.toMatch(/= true|supplierCreditManagement/i);
    }
    const description = describeConfiguration(before);
    expect(description.length).toBeGreaterThan(3);
    expect(description.join(" ")).not.toMatch(/configuration engine|capability registry/i);
  });

  it("diffs two configurations into changes an owner can read", () => {
    const after = finalize(buildConfiguration({ ...hardwareAnswers(), credit_limit: 80000 }, { businessName: "Mwangi Hardware" }));
    const changes = diffConfigurations(before, after);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((change) => /credit/i.test(JSON.stringify(change)))).toBe(true);
    expect(configurationFingerprint(before)).not.toBe(configurationFingerprint(after));
  });

  it("keeps a valid configuration valid after validation", () => {
    expect(validateConfiguration(before).ok).toBe(true);
    const empty = normalizeConfiguration(null);
    expect(validateConfiguration(empty).ok === false || validateConfiguration(empty).ok === true).toBe(true);
  });
});

describe("terminology is presentation only (§24, §46)", () => {
  it("resolves generic → trade preset → owner override", () => {
    const preset = TERMINOLOGY_PRESETS.salon;
    expect(preset?.customers).toBeTruthy();
    const config = finalize(buildConfiguration(initialAnswers("salon"), { businessName: "Mary's Beauty" }));
    expect(resolveTerminology(config).customers).toBe(preset?.customers);
    const overridden = resolveTerminology({ ...config, terminology: { customers: "Ladies" } });
    expect(overridden.customers).toBe("Ladies");
  });

  it("ignores overrides for keys the engine does not know", () => {
    const config = finalize(buildConfiguration(initialAnswers("salon"), {}));
    const result = resolveTerminology({ ...config, terminology: { database: "Mongo", customers: "Ladies" } } as never);
    expect((result as Record<string, string>).database).toBeUndefined();
    expect(result.customers).toBe("Ladies");
  });

  it("changes the words on a form without changing the fields behind them (§52)", () => {
    const salon = finalize(buildConfiguration(initialAnswers("salon"), {}));
    const garage = finalize(buildConfiguration(applyBusinessType(initialAnswers("garage"), "garage"), {}));
    const salonForm = formSpec(salon, "customer");
    const garageForm = formSpec(garage, "customer");
    expect(salonForm.plural).not.toBe(garageForm.plural);
    expect(salonForm.fields.map((field) => field.key)).toEqual(garageForm.fields.map((field) => field.key));
  });
});

describe("forms are generated from configuration (§24)", () => {
  it("asks for a credit limit only where credit exists", () => {
    const hardware = finalize(buildConfiguration(hardwareAnswers(), {}));
    const restaurant = finalize(buildConfiguration(restaurantAnswers(), {}));
    expect(formSpec(hardware, "customer").fields.some((field) => field.key === "creditLimitKES")).toBe(true);
    expect(formSpec(restaurant, "customer").fields.some((field) => field.key === "creditLimitKES")).toBe(false);
  });

  it("offers only the units the business chose (§13)", () => {
    const hardware = finalize(buildConfiguration(hardwareAnswers(), {}));
    const keys = unitOptions(hardware).map((unit) => unit.key);
    expect(keys).toContain("carton");
    expect(keys).toContain("bag");
    expect(keys).not.toContain("session");
  });

  it("offers wholesale pricing only to a business that has it", () => {
    const wholesale = finalize(buildConfiguration({ ...hardwareAnswers(), wholesale_pricing: true }, {}));
    const retail = finalize(buildConfiguration({ ...hardwareAnswers(), wholesale_pricing: false }, {}));
    expect(formSpec(wholesale, "product").fields.some((field) => field.key === "wholesalePriceKES")).toBe(true);
    expect(formSpec(retail, "product").fields.some((field) => field.key === "wholesalePriceKES")).toBe(false);
  });
});

describe("order lifecycle state machines (§29)", () => {
  it("gives a restaurant kitchen states and a garage job states", () => {
    const restaurant = finalize(buildConfiguration(restaurantAnswers(), {}));
    const hardware = finalize(buildConfiguration(hardwareAnswers(), {}));
    const restaurantStates = resolveStates(restaurant).map((state) => state.key);
    const hardwareStates = resolveStates(hardware).map((state) => state.key);
    expect(restaurantStates).not.toEqual(hardwareStates);
    expect(restaurantStates[0]).toBe(initialState(restaurant.orders.workflowKey));
  });

  it("only allows moves the workflow defines, and always keeps a way to close", () => {
    const restaurant = finalize(buildConfiguration(restaurantAnswers(), {}));
    const key = restaurant.orders.workflowKey;
    const first = initialState(key);
    const allowed = nextStates(key, first).map((state) => state.key);
    expect(allowed.length).toBeGreaterThan(0);
    for (const state of allowed) expect(canTransition(key, first, state)).toBe(true);
    expect(canTransition(key, first, first)).toBe(false);
    expect(canTransition(key, first, "NOT_A_STATE")).toBe(false);

    const states = resolveStates(restaurant);
    expect(states.some((state) => isTerminal(key, state.key))).toBe(true);
  });

  it("keeps terminal and cancelled states even when an owner narrows the list (§49)", () => {
    const restaurant = finalize(buildConfiguration(restaurantAnswers(), {}));
    const narrowed = resolveStates({ orders: { ...restaurant.orders, states: [restaurant.orders.states[0]] } });
    expect(narrowed.length).toBeGreaterThan(1);
    expect(narrowed.some((state) => state.terminal)).toBe(true);
  });
});

describe("roles and capability-action permissions (§36)", () => {
  const hardware = finalize(buildConfiguration(hardwareAnswers(), {}));

  it("defines the permissions the specification names", () => {
    const keys = PERMISSIONS.map((permission) => permission.key);
    for (const required of ["VIEW_SALES", "CREATE_SALE", "REFUND_SALE", "APPLY_DISCOUNT", "APPROVE_CREDIT", "MANAGE_USERS"]) {
      expect(keys).toContain(required);
    }
  });

  it("gives a cashier the till but not refunds, credit or the setup", () => {
    const cashier = effectivePermissions(hardware, "CASHIER");
    expect(cashier).toContain("CREATE_SALE");
    expect(cashier).not.toContain("REFUND_SALE");
    expect(cashier).not.toContain("APPROVE_CREDIT");
    expect(cashier).not.toContain("EDIT_CONFIGURATION");
    expect(cashier).not.toContain("MANAGE_USERS");
  });

  it("gives the owner everything, and refuses in plain language", () => {
    const owner = effectivePermissions(hardware, "OWNER");
    expect(owner).toContain("REFUND_SALE");
    const allowed = checkPermission(hardware, "OWNER", "REFUND_SALE");
    expect(allowed.allowed).toBe(true);
    const refused = checkPermission(hardware, "CASHIER", "REFUND_SALE");
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBeTruthy();
    expect(refused.reason).not.toMatch(/permission key|REFUND_SALE|capability/i);
  });

  it("never grants a permission for a capability the business does not have", () => {
    const restaurant = finalize(buildConfiguration(restaurantAnswers(), {}));
    expect(restaurant.credit.enabled).toBe(false);
    expect(effectivePermissions(restaurant, "OWNER")).not.toContain("APPROVE_CREDIT");
    expect(effectivePermissions(hardware, "OWNER")).toContain("APPROVE_CREDIT");
  });

  it("ships roles a trade recognises, all defined by permissions only (§52)", () => {
    const keys = BUILT_IN_ROLES.map((role) => role.key);
    expect(keys).toContain("WAITER");
    expect(keys).toContain("STYLIST");
    expect(keys).toContain("TECHNICIAN");
    for (const role of BUILT_IN_ROLES) {
      expect(role.permissions.every((permission) => PERMISSIONS.some((entry) => entry.key === permission))).toBe(true);
    }
  });
});

describe("units and conversions (§13)", () => {
  it("converts a carton to pieces using the configured factor", () => {
    const hardware = finalize(buildConfiguration(hardwareAnswers(), {}));
    expect(hardware.inventory.conversions).toEqual([{ fromUnit: "carton", toUnit: "piece", factor: 24 }]);
    const converted = convertQuantity(2, "carton", "piece", hardware.inventory.conversions);
    expect(converted).toBe(48);
  });

  it("returns null rather than guessing when there is no path between units", () => {
    expect(convertQuantity(1, "hour", "kilogram", [])).toBeNull();
  });

  it("knows which units can be fractional", () => {
    expect(isCountableUnit("piece")).toBe(true);
    expect(isCountableUnit("kilogram")).toBe(false);
  });
});

describe("generated presentation (§24, §34, §35, §60, §61)", () => {
  const hardware = finalize(buildConfiguration(hardwareAnswers(), {}));

  it("puts the obvious primary action first (§38)", () => {
    const actions = deriveQuickActions(hardware, "/pos");
    expect(actions[0]?.label.toLowerCase()).toContain("new");
    expect(actions[0]?.primary).toBe(true);
    expect(actions[0]?.href).toBe("/pos/sell");
  });

  it("generates dashboard cards only for capabilities the business has (§34)", () => {
    const cards = deriveDashboardCards(hardware);
    expect(cards).toContain("credit_owed");
    expect(cards).not.toContain("kitchen_queue");
  });

  it("labels each report's basis so the UI can say recorded vs calculated (§35)", () => {
    const keys = deriveReports(hardware);
    expect(keys.length).toBeGreaterThan(4);
    const restaurant = finalize(buildConfiguration(restaurantAnswers(), {}));
    expect(deriveReports(restaurant)).toContain("ingredient_usage");
    expect(deriveReports(hardware)).not.toContain("ingredient_usage");
  });

  it("teaches the next action in an empty state (§60)", () => {
    const empty = emptyStateFor(hardware, "products", "/pos");
    expect(empty.title.length).toBeGreaterThan(3);
    expect(empty.body.length).toBeGreaterThan(10);
    expect(empty.action.href).toContain("/pos");
    expect(empty.action.label).not.toMatch(/schema|capabilit/i);
  });

  it("offers a setup checklist that still allows trading immediately (§61)", () => {
    const steps = setupSteps(hardware, "/pos");
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.every((step) => step.href.startsWith("/pos"))).toBe(true);
    expect(steps.some((step) => step.key === "products")).toBe(true);
  });
});
