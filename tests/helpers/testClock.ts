/**
 * Clock fixtures for tests that need a *currently valid* business state.
 *
 * ## Why this exists
 *
 * Two Autopilot suites began failing on 2026-11-15 with no code change. The cause was not a
 * defect in `lib/autopilot`: their fixtures hardcoded an absolute subscription window
 * (`startAt: 2026-10-10`, `expiresAt: 2026-11-10`, `graceUntil: 2026-11-13`). Once the wall clock
 * passed `graceUntil`, `deriveAutopilotEntitlement` correctly reported "not entitled", the policy
 * engine correctly refused `ENTITLEMENT_REQUIRED`, and the tests failed — while asserting
 * behaviour that was never about dates.
 *
 * A test that silently expires is worse than a failing one: it trains people to re-run until
 * green, and it hides the moment a real entitlement bug is introduced. These helpers make the
 * *intent* ("an active subscription") explicit instead of encoding a calendar date that rots.
 *
 * ## Rules for using this
 *
 * - Use these ONLY for fixtures whose meaning is "a currently valid subscription". The assertion
 *   under test must not be about time.
 * - If a test asserts something *about* time — expiry, grace, quiet hours, TTL, retry backoff —
 *   it MUST pass an explicit `now` to the function under test and build its fixture dates
 *   relative to that same `now`. Never let a real clock leak into a time assertion.
 * - Do not use these to paper over a genuine entitlement defect. If a test asserts "ACTIVE
 *   subscription is entitled" and fails, the bug is in entitlement logic, not in the fixture.
 */

const DAY_MS = 86_400_000;

/** A `Date` `days` in the future (negative for the past), relative to the real clock. */
export function daysFromNow(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export type SubscriptionWindow = {
  startAt: Date;
  expiresAt: Date;
  graceUntil: Date;
};

/**
 * A subscription window that is ACTIVE right now, preserving the 31-day period and 3-day grace
 * shape the production plan catalogue uses (`PlanConfig.durationDays = 30` plus grace).
 *
 * Defaults place the subscription at day 10 of its period, so it is unambiguously active and
 * stays that way for the remainder of any realistic test run.
 */
export function activeSubscriptionWindow(options: {
  /** Days since the period started. Must be < `daysUntilExpiry + 3`. */
  daysSinceStart?: number;
  /** Days from now until `expiresAt`. */
  daysUntilExpiry?: number;
  /** Days from `expiresAt` to `graceUntil`. */
  graceDays?: number;
  from?: Date;
} = {}): SubscriptionWindow {
  const {
    daysSinceStart = 10,
    daysUntilExpiry = 20,
    graceDays = 3,
    from = new Date(),
  } = options;
  if (daysUntilExpiry + graceDays <= 0) {
    throw new Error(
      "activeSubscriptionWindow: a window entirely in the past is not active — " +
        "use daysFromNow() with an explicit `now` if you are asserting expiry behaviour.",
    );
  }
  return {
    startAt: daysFromNow(-daysSinceStart, from),
    expiresAt: daysFromNow(daysUntilExpiry, from),
    graceUntil: daysFromNow(daysUntilExpiry + graceDays, from),
  };
}
