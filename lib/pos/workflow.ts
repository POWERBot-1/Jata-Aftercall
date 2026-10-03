/**
 * Order lifecycle engine (§29, §52)
 *
 * Business-specific states without duplicating the application. A workflow is a list of
 * states plus the moves allowed between them; the POS screens render whatever the
 * configuration says, and the server refuses any move the workflow does not allow.
 */

import type { PosConfiguration } from "./types";

export type WorkflowState = {
  key: string;
  label: string;
  /** What the state means to the business, in one line. */
  hint?: string;
  tone?: "neutral" | "info" | "warn" | "success" | "danger";
  terminal?: boolean;
};

export type OrderWorkflow = {
  key: string;
  label: string;
  /** Which kinds of business this workflow is offered to (§18). */
  fits: string[];
  states: WorkflowState[];
  /** state → states it may move to. Anything absent is refused. */
  transitions: Record<string, string[]>;
};

const GENERIC: OrderWorkflow = {
  key: "generic",
  label: "Standard order",
  fits: ["retail", "wholesale", "online_seller", "other"],
  states: [
    { key: "NEW", label: "New", hint: "Taken but not confirmed yet.", tone: "info" },
    { key: "CONFIRMED", label: "Confirmed", tone: "info" },
    { key: "PROCESSING", label: "Processing", tone: "warn" },
    { key: "READY", label: "Ready", hint: "Ready for collection or dispatch.", tone: "success" },
    { key: "COMPLETED", label: "Completed", tone: "success", terminal: true },
    { key: "CANCELLED", label: "Cancelled", tone: "danger", terminal: true },
  ],
  transitions: {
    NEW: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["PROCESSING", "READY", "CANCELLED"],
    PROCESSING: ["READY", "CANCELLED"],
    READY: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  },
};

const RESTAURANT: OrderWorkflow = {
  key: "restaurant",
  label: "Restaurant service",
  fits: ["restaurant", "cafe", "bar", "bakery", "catering", "hotel"],
  states: [
    { key: "ORDERED", label: "Ordered", tone: "info" },
    { key: "ACCEPTED", label: "Accepted", tone: "info" },
    { key: "KITCHEN", label: "In the kitchen", hint: "Kitchen is preparing it.", tone: "warn" },
    { key: "READY", label: "Ready", tone: "success" },
    { key: "SERVED", label: "Served", tone: "success", terminal: true },
    { key: "CANCELLED", label: "Cancelled", tone: "danger", terminal: true },
  ],
  transitions: {
    ORDERED: ["ACCEPTED", "CANCELLED"],
    ACCEPTED: ["KITCHEN", "CANCELLED"],
    KITCHEN: ["READY", "CANCELLED"],
    READY: ["SERVED", "CANCELLED"],
    SERVED: [],
    CANCELLED: [],
  },
};

const DELIVERY: OrderWorkflow = {
  key: "delivery",
  label: "Delivery",
  fits: ["retail", "wholesale", "restaurant", "online_seller", "courier", "pharmacy", "grocery"],
  states: [
    { key: "ORDERED", label: "Ordered", tone: "info" },
    { key: "CONFIRMED", label: "Confirmed", tone: "info" },
    { key: "PACKED", label: "Packed", tone: "warn" },
    { key: "DISPATCHED", label: "Dispatched", hint: "Out for delivery.", tone: "warn" },
    { key: "DELIVERED", label: "Delivered", tone: "success", terminal: true },
    { key: "CANCELLED", label: "Cancelled", tone: "danger", terminal: true },
  ],
  transitions: {
    ORDERED: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["PACKED", "CANCELLED"],
    PACKED: ["DISPATCHED", "CANCELLED"],
    DISPATCHED: ["DELIVERED", "CANCELLED"],
    DELIVERED: [],
    CANCELLED: [],
  },
};

const GARAGE: OrderWorkflow = {
  key: "garage",
  label: "Service job",
  fits: ["garage", "auto_repair", "car_wash", "workshop", "technical"],
  states: [
    { key: "JOB_CREATED", label: "Job created", tone: "info" },
    { key: "INSPECTION", label: "Inspection", tone: "warn" },
    { key: "APPROVED", label: "Approved", hint: "Customer agreed the estimate.", tone: "info" },
    { key: "REPAIR", label: "In repair", tone: "warn" },
    { key: "READY", label: "Ready", tone: "success" },
    { key: "COLLECTED", label: "Collected", tone: "success", terminal: true },
    { key: "CANCELLED", label: "Cancelled", tone: "danger", terminal: true },
  ],
  transitions: {
    JOB_CREATED: ["INSPECTION", "CANCELLED"],
    INSPECTION: ["APPROVED", "CANCELLED"],
    APPROVED: ["REPAIR", "CANCELLED"],
    REPAIR: ["READY", "CANCELLED"],
    READY: ["COLLECTED", "CANCELLED"],
    COLLECTED: [],
    CANCELLED: [],
  },
};

const APPOINTMENT: OrderWorkflow = {
  key: "appointment",
  label: "Appointment",
  fits: ["salon", "barber", "spa", "clinic", "dental", "veterinary", "photography", "laundry"],
  states: [
    { key: "BOOKED", label: "Booked", tone: "info" },
    { key: "CONFIRMED", label: "Confirmed", tone: "info" },
    { key: "IN_SERVICE", label: "In service", tone: "warn" },
    { key: "COMPLETED", label: "Completed", tone: "success", terminal: true },
    { key: "NO_SHOW", label: "No show", tone: "danger", terminal: true },
    { key: "CANCELLED", label: "Cancelled", tone: "danger", terminal: true },
  ],
  transitions: {
    BOOKED: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
    CONFIRMED: ["IN_SERVICE", "CANCELLED", "NO_SHOW"],
    IN_SERVICE: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    NO_SHOW: [],
    CANCELLED: [],
  },
};

const PROJECT: OrderWorkflow = {
  key: "project",
  label: "Project",
  fits: ["professional_services", "consultancy", "agency", "construction", "events", "printing", "manufacturing", "real_estate"],
  states: [
    { key: "ENQUIRY", label: "Enquiry", tone: "neutral" },
    { key: "QUOTED", label: "Quoted", tone: "info" },
    { key: "APPROVED", label: "Approved", hint: "Deposit or agreement received.", tone: "info" },
    { key: "IN_PROGRESS", label: "In progress", tone: "warn" },
    { key: "REVIEW", label: "Review", tone: "warn" },
    { key: "DELIVERED", label: "Delivered", tone: "success", terminal: true },
    { key: "CANCELLED", label: "Cancelled", tone: "danger", terminal: true },
  ],
  transitions: {
    ENQUIRY: ["QUOTED", "CANCELLED"],
    QUOTED: ["APPROVED", "CANCELLED"],
    APPROVED: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["REVIEW", "DELIVERED", "CANCELLED"],
    REVIEW: ["IN_PROGRESS", "DELIVERED", "CANCELLED"],
    DELIVERED: [],
    CANCELLED: [],
  },
};

const PRODUCTION: OrderWorkflow = {
  key: "production",
  label: "Production run",
  fits: ["manufacturing", "farm", "agribusiness", "printing"],
  states: [
    { key: "PLANNED", label: "Planned", tone: "info" },
    { key: "MATERIALS_READY", label: "Materials ready", tone: "info" },
    { key: "IN_PRODUCTION", label: "In production", tone: "warn" },
    { key: "QUALITY_CHECK", label: "Quality check", tone: "warn" },
    { key: "STORED", label: "Stored", hint: "Finished goods in stock.", tone: "success", terminal: true },
    { key: "CANCELLED", label: "Cancelled", tone: "danger", terminal: true },
  ],
  transitions: {
    PLANNED: ["MATERIALS_READY", "CANCELLED"],
    MATERIALS_READY: ["IN_PRODUCTION", "CANCELLED"],
    IN_PRODUCTION: ["QUALITY_CHECK", "CANCELLED"],
    QUALITY_CHECK: ["IN_PRODUCTION", "STORED", "CANCELLED"],
    STORED: [],
    CANCELLED: [],
  },
};

const LAUNDRY: OrderWorkflow = {
  key: "laundry",
  label: "Laundry order",
  fits: ["laundry", "cleaning_service"],
  states: [
    { key: "RECEIVED", label: "Received", tone: "info" },
    { key: "SORTED", label: "Sorted", tone: "info" },
    { key: "WASHING", label: "Washing", tone: "warn" },
    { key: "DRYING", label: "Drying / pressing", tone: "warn" },
    { key: "READY", label: "Ready", tone: "success" },
    { key: "COLLECTED", label: "Collected", tone: "success", terminal: true },
    { key: "CANCELLED", label: "Cancelled", tone: "danger", terminal: true },
  ],
  transitions: {
    RECEIVED: ["SORTED", "CANCELLED"],
    SORTED: ["WASHING", "CANCELLED"],
    WASHING: ["DRYING", "CANCELLED"],
    DRYING: ["READY", "CANCELLED"],
    READY: ["COLLECTED", "CANCELLED"],
    COLLECTED: [],
    CANCELLED: [],
  },
};

export const ORDER_WORKFLOWS: OrderWorkflow[] = [GENERIC, RESTAURANT, DELIVERY, GARAGE, APPOINTMENT, PROJECT, PRODUCTION, LAUNDRY];

const WORKFLOW_BY_KEY = new Map(ORDER_WORKFLOWS.map((workflow) => [workflow.key, workflow]));

export function getWorkflow(key: string | null | undefined): OrderWorkflow {
  return WORKFLOW_BY_KEY.get(key ?? "") ?? GENERIC;
}

export function isWorkflowKey(key: unknown): key is string {
  return typeof key === "string" && WORKFLOW_BY_KEY.has(key);
}

export function workflowStates(key: string | null | undefined): WorkflowState[] {
  return getWorkflow(key).states;
}

export function workflowState(key: string | null | undefined, stateKey: string): WorkflowState | undefined {
  return getWorkflow(key).states.find((state) => state.key === stateKey);
}

export function stateLabel(key: string | null | undefined, stateKey: string): string {
  return workflowState(key, stateKey)?.label ?? stateKey;
}

/**
 * The states this business actually uses. A configuration may trim a workflow (a takeaway
 * that never serves at tables does not need SERVED), but it may not invent states that the
 * workflow does not know — that keeps historical orders interpretable (§48).
 */
export function resolveStates(config: Pick<PosConfiguration, "orders"> | null | undefined): WorkflowState[] {
  const workflow = getWorkflow(config?.orders?.workflowKey);
  const configured = config?.orders?.states;
  if (!Array.isArray(configured) || configured.length === 0) return workflow.states;
  const allowed = new Set(workflow.states.map((state) => state.key));
  const chosen = configured.filter((key): key is string => typeof key === "string" && allowed.has(key));
  if (!chosen.length) return workflow.states;
  // Terminal and cancelled states are always kept so an order can always be closed.
  for (const state of workflow.states) {
    if ((state.terminal || state.key === "CANCELLED") && !chosen.includes(state.key)) chosen.push(state.key);
  }
  return workflow.states.filter((state) => chosen.includes(state.key));
}

export function canTransition(workflowKey: string | null | undefined, from: string, to: string): boolean {
  if (from === to) return false;
  const workflow = getWorkflow(workflowKey);
  return (workflow.transitions[from] ?? []).includes(to);
}

export function nextStates(workflowKey: string | null | undefined, from: string): WorkflowState[] {
  const workflow = getWorkflow(workflowKey);
  const allowed = workflow.transitions[from] ?? [];
  return workflow.states.filter((state) => allowed.includes(state.key));
}

export function isTerminal(workflowKey: string | null | undefined, stateKey: string): boolean {
  return Boolean(workflowState(workflowKey, stateKey)?.terminal);
}

export function initialState(workflowKey: string | null | undefined): string {
  return getWorkflow(workflowKey).states[0]?.key ?? "NEW";
}

/** Which workflows to offer for a business type (§18) — the questionnaire never lists all eight. */
export function workflowsForBusinessType(typeKey: string, industryCapabilities: string[] = []): OrderWorkflow[] {
  const matches = ORDER_WORKFLOWS.filter((workflow) => workflow.fits.includes(typeKey));
  const offered = matches.length ? matches : [GENERIC];
  if (industryCapabilities.includes("kitchen_orders") && !offered.some((workflow) => workflow.key === "restaurant")) {
    offered.push(RESTAURANT);
  }
  if (industryCapabilities.includes("job_cards") && !offered.some((workflow) => workflow.key === "garage")) {
    offered.push(GARAGE);
  }
  if (industryCapabilities.includes("manufacturing") && !offered.some((workflow) => workflow.key === "production")) {
    offered.push(PRODUCTION);
  }
  if (!offered.some((workflow) => workflow.key === "generic")) offered.push(GENERIC);
  return offered;
}
