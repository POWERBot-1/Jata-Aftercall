# Local test environment and Prisma client

Use Node 22.22.3 and the committed npm lockfile. Prisma CLI and `@prisma/client` are pinned to exactly 5.22.0 and must remain on the same release. In a clean checkout, run `npm ci`; the root postinstall runs the shared Prisma generation wrapper and fails installation if native engine acquisition or generation fails.

`scripts/lib/prisma-generate.sh` uses the repository-local Prisma CLI (never an implicit `npx` download), checks CLI/client version parity, supplies loopback-only placeholder datasource URLs when no database URLs are configured, and runs `prisma generate`. Generation downloads the platform-specific engine from Prisma's official distribution and does not connect to PostgreSQL. Network-restricted environments must not fake or silently skip this step; run it on a runner with outbound access to the Prisma engine distribution.

The build gate always performs native client generation and verifies generated model metadata before Next.js compilation. It never runs database migrations. Run approved migrations through the separate migration workflow; never point tests or migrations at production without explicit authorization.

`npm test` checks that generated client metadata can be loaded before starting the suite. This detects missing generation, not database readiness. Database integration tests require an isolated migrated PostgreSQL instance; a no-database suite cannot certify them.

The GitHub Actions workflow performs clean `npm ci`, native Prisma generation, generated-client preflight, the full no-database suite, and a separate Next.js production build on GitHub-hosted Linux with Node 22.22.3. An unavailable native engine remains an explicit blocker until the hosted run proves successful acquisition and generation.
