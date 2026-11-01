type SeedEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    "NODE_ENV" | "VERCEL_ENV" | "JATA_ALLOW_FIXTURE_SEED" | "DEMO_FIXTURE_PASSWORD" | "ADMIN_EMAILS" | "ADMIN_INITIAL_PASSWORD"
  >
>;

/**
 * The application seed contains fictional business/payment fixtures and must never run in
 * production or without an explicit non-production opt-in and ephemeral fixture password.
 * Production account state is not changed by this guard; any existing seeded accounts require
 * separate owner review and rotation.
 */
export function validateSeedEnvironment(env: SeedEnvironment): {
  demoFixturePassword: string;
  adminEmail?: string;
  adminInitialPassword?: string;
} {
  if ([env.NODE_ENV, env.VERCEL_ENV].some((value) => value?.trim().toLowerCase() === "production")) {
    throw new Error("Refusing to run the fixture seed in a production environment.");
  }
  if (env.JATA_ALLOW_FIXTURE_SEED !== "true") {
    throw new Error("Fixture seeding requires the explicit JATA_ALLOW_FIXTURE_SEED=true opt-in.");
  }

  const demoFixturePassword = env.DEMO_FIXTURE_PASSWORD || "";
  if (demoFixturePassword.length < 32) {
    throw new Error("DEMO_FIXTURE_PASSWORD must be an ephemeral value of at least 32 characters.");
  }

  const adminEmail = (env.ADMIN_EMAILS || "").split(",")[0].trim().toLowerCase();
  const adminInitialPassword = env.ADMIN_INITIAL_PASSWORD || "";
  if (Boolean(adminEmail) !== Boolean(adminInitialPassword)) {
    throw new Error("Admin fixture creation requires both ADMIN_EMAILS and ADMIN_INITIAL_PASSWORD.");
  }
  if (adminInitialPassword && adminInitialPassword.length < 32) {
    throw new Error("ADMIN_INITIAL_PASSWORD must be an ephemeral value of at least 32 characters.");
  }

  return {
    demoFixturePassword,
    ...(adminEmail ? { adminEmail, adminInitialPassword } : {}),
  };
}
