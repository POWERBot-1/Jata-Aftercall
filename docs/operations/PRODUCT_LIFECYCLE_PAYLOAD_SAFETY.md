# Lifecycle payload safety guard

## Scope
This guard is an additional denylist-based minimisation layer for lifecycle task payloads. It is not a complete PII detector, a schema allowlist, or a substitute for data classification. Callers must still provide only operational metadata required to explain an observation.

## Enforced checks
- Rejects common credential, authentication, contact, address, transcript, message and raw-provider-response field names.
- Rejects email-shaped values, phone-like values and common payment/API credential prefixes.
- Limits nesting depth, visited node count, object fields, array length and string length.
- Rejects unsupported values, non-finite numbers, non-plain objects, prototype-sensitive keys and circular structures.
- Applies the same guard to task payloads, event metadata, run cursors and run summaries before persistence.

The guard is applied to task payloads, event metadata, run cursors and run summaries before persistence. These checks are still denylist-based and do not replace task-specific allowlists before worker activation.

## Limitations
Pattern matching cannot prove that arbitrary text contains no personal data or secret. False positives are possible, and sensitive content can be represented in unrecognised formats or under innocuous field names. The current implementation therefore reduces risk but does not establish a complete privacy guarantee.

## Activation gate
- Keep the worker and scheduler disabled.
- Do not treat this guard as authorization to persist customer messages, contact details, provider responses, payment data or credentials.
- Before worker activation, replace or supplement this denylist with product/task-specific payload schemas and explicit allowlists, then validate against representative fixtures in isolated CI/staging.
- No production migration, deployment, customer-access mutation or provider integration is part of this change.
