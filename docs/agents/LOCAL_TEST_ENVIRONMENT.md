# Local test environment and Prisma client

Use Node 22.22.3 and the committed npm lockfile. Prisma CLI and `@prisma/client` are pinned to exactly 5.22.0 and must remain on the same release. In a clean checkout, run `npm ci` followed by `npm test`; the root postinstall now runs the shared Prisma generation wrapper and fails the install if native engine download or generation fails.

`scripts/lib/prisma-generate.sh` uses the repository-local Prisma CLI (never an implicit `npx` download), checks CLI/client version parity, supplies loopback-only placeholder datasource URLs when the environment has no database URLs, and runs `prisma generate`. Generation downloads the platform-specific engine from Prisma's official distribution (or the explicitly configured `PRISMA_ENGINES_MIRROR`) and does not connect to PostgreSQL. A network-restricted sandbox must not fake or silently skip this step: run the same command in the repository's GitHub Actions runner or another build runner with outbound access to the configured Prisma engine distribution.

The build gate always performs native client generation and checks that generated model metadata can be loaded before Next.js compilation. It does not continue with a stale or stub client if generation fails. Production migrations remain separate: `scripts/migrate.sh` and its direct-URL guard still control database migration, and no loopback placeholder is used to migrate.

`npm test` checks that the generated client and model metadata can be loaded before starting the suite. This detects missing generation, not database readiness. Database integration tests require an isolated migrated PostgreSQL instance; a no-database suite cannot certify them. Never point tests at production.

The CI workflow `.github/workflows/full-local-suite.yml` performs `npm ci`, native Prisma generation, and the full no-database suite on GitHub-hosted Linux with the same Node 22.22.3 runtime. An unavailable local engine remains an explicit blocker until the hosted run proves the native download and generation succeed.
