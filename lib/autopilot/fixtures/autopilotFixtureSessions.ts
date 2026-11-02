/**
 * Server-held FICTIONAL fixture sessions (development and test only).
 *
 * The fixture state (including the simulated platform kill switch, tenant pause and
 * approvals) lives on the server, keyed by an opaque session id. The browser sends only a
 * session id and an action, never state, so a client cannot edit the kill switch or any other
 * control by changing request bodies. Starting a new session is the only "reset".
 *
 * In-memory and bounded. Nothing is persisted. Not imported by any client module.
 */
import { randomUUID } from "node:crypto";
import {
  createFixtureState,
  type FixtureRole,
  type FixtureScenarioId,
  type FixtureState,
} from "./autopilotFixtureModel";

const MAX_SESSIONS = 200;
const sessions = new Map<string, FixtureState>();

export function createFixtureSession(opts: {
  scenario?: FixtureScenarioId;
  role?: FixtureRole;
  tenant?: "a" | "b";
}): { id: string; state: FixtureState } {
  const id = randomUUID();
  const state = createFixtureState(opts.scenario ?? "ready", { role: opts.role, tenant: opts.tenant });
  sessions.set(id, state);
  if (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }
  return { id, state };
}

export function getFixtureSession(id: unknown): FixtureState | undefined {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return undefined;
  return sessions.get(id);
}

export function saveFixtureSession(id: string, state: FixtureState): void {
  if (sessions.has(id)) sessions.set(id, state);
}
