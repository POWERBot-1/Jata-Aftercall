# Transient visual evidence (not product code)

Real-Chrome screenshots produced by `.github/workflows/premium-screenshots.yml` on a
disposable PostgreSQL database with the fictional seeded demo user. This directory is
committed only while the PR carries the `visual-evidence` label and is removed from the
branch after review; the workflow never re-publishes on top of its own evidence commit.
The durable evidence channel is the workflow artifact (`premium-screenshots-*`).
