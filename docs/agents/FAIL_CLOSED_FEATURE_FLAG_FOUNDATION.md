# Fail-closed feature-flag foundation

## Implemented policy

- The registry is an explicit allowlist; unknown keys always resolve disabled.
- The global kill switch is active unless `JATA_GLOBAL_KILL_SWITCH=false` is explicitly supplied.
- Individual flags require the exact value `JATA_FEATURE_<KEY>=true`; truthy aliases, whitespace and case variants are rejected.
- A global kill switch overrides every individual flag.
- The resolver is pure and receives an explicit environment map. It does not read secrets, process state, databases, or provider APIs.
- Financial commission accrual, payouts, TAPNET provider activation, Telnyx live calls and Control mutations have independent flags. Enabling one does not enable another.

## Important boundary

This is a policy primitive and test foundation, not a complete operator workflow, distributed kill switch, deployment configuration, health monitor, or proof that product routes consume the registry. No flag is enabled by this change. Existing product behavior must not be considered gated until each server-side entry point is explicitly integrated and tested.

## Required next steps

1. Inventory every existing environment toggle and action entry point; map each to one registered key or document why it is not a feature flag.
2. Integrate the resolver at server-side execution boundaries, not only in UI components.
3. Add an authenticated, audited, owner-authorized operator workflow. The current all-DENY Control policy remains in force; no Control grant is implied.
4. Add last-success timestamps and truthful health states for flag source/configuration and dependent workers. Missing probes must report UNAVAILABLE.
5. Add integration tests proving the kill switch blocks each sensitive action, including queued/retried work.
6. Add independent review and deployment-environment verification before any operational flag can be enabled.

No production configuration, deployment, payment, provider activation, or database mutation was performed.
