# Programme blocker classification (34 non-PASS records)

Source: `docs/agents/PROGRAMME_READINESS.json` at the head that contains this file. Classification is
by what is needed to close each record, not by its current label. No record is changed here. The
ledger's `status` values are unchanged, because no record meets every criterion with recorded evidence.

Categories: IMPLEMENTATION REQUIRED · OWNER DECISION REQUIRED · EXTERNAL EVIDENCE REQUIRED ·
BLOCKED BY PROVIDER · NOT TESTED · DEPENDENT (closes only when its dependencies close) ·
COMPLETED WITH EVIDENCE (none in this set).

| ID | Current | Classification | What is actually missing |
| --- | --- | --- | --- |
| ADMIN-002 | BLOCKED | DEPENDENT | Per-criterion evidence on one final candidate. Closes only when the other records close. |
| ADMIN-003 | BLOCKED | IMPLEMENTATION REQUIRED | Deny paths pass. Explicit authorised-role allow paths, forged-role, CSRF and revocation tests across `/control` are not all recorded. |
| ADMIN-004 | BLOCKED | IMPLEMENTATION REQUIRED | Horizontal and vertical escalation tests, MFA on sensitive actions, and immutable audit are not implemented end to end. |
| ADMIN-005 | BLOCKED | EXTERNAL EVIDENCE REQUIRED | Authoritative-source and isolation tests, plus independent six-viewport review. Independent review is outside this sandbox. |
| ADMIN-006 | BLOCKED | OWNER DECISION REQUIRED | Approved commission rates, qualifying events and reversal terms. None are in the repository, and none may be invented. |
| ADMIN-007 | BLOCKED | OWNER DECISION REQUIRED | Owner-approved provider configuration and health checks. Kill-switch scope needs the owner's confirmation. |
| ADMIN-008 | BLOCKED | BLOCKED BY PROVIDER | Provider-authorised delivery, callback authentication and dead-letter recovery need a live provider. No real messages may be sent. |
| ADMIN-009 | BLOCKED | EXTERNAL EVIDENCE REQUIRED | Authoritative HOSTAFRICA zone export, live HTTPS and canonical redirect checks, mail records. No DNS change is permitted. |
| ADMIN-010 | BLOCKED | IMPLEMENTATION REQUIRED | Full console with real data across all modules, audited changes, and independent six-viewport review. |
| MOTION-001 | BLOCKED | IMPLEMENTATION REQUIRED | App-wide keyboard, reduced-motion, responsive and layout-shift evidence. Only selected surfaces are covered. |
| MOTION-002 | BLOCKED | IMPLEMENTATION REQUIRED | Generate, preview and publish for every Studio family. Durable media acceptance also depends on a provider. |
| MOTION-003 | NOT TESTED | NOT TESTED | Complete live route and control inventory, and independently reviewed baselines. |
| ADMIN-012 | BLOCKED | IMPLEMENTATION REQUIRED | `/control` exact-key, scope and MFA implementation, revocation race, reasoned transitions, audit display. |
| ADMIN-013 | BLOCKED | OWNER DECISION REQUIRED | End-to-end phone → eligibility → verified payment → accrual → reversal needs approved financial terms and a payment path. |
| ADMIN-014 | BLOCKED | EXTERNAL EVIDENCE REQUIRED | Restore and recovery validation on the production Neon project. This is owner-verified and recorded in `docs/NEON-RECOVERY-READINESS.md`. |
| ADMIN-015 | BLOCKED | IMPLEMENTATION REQUIRED | Authenticated six-view evidence for `/control` and each applicable surface. Depends on ADMIN-012. |
| MOTION-004 | NOT TESTED | IMPLEMENTATION REQUIRED | Behaviour and inheritance for every surface and template family. Financial-state acceptance needs an owner decision. |
| ADMIN-022 | BLOCKED | OWNER DECISION REQUIRED | Approval policy for the scheduler and reports, and integration of all workstreams. The scheduler stays default-off. |
| MOTION-005 | NOT TESTED | NOT TESTED | Keyboard, mobile and desktop interaction inspection of the workspace and status surfaces. |
| ADMIN-023 | PASS | — (closed on 59a8bed, 2 Nov 2026) | §028 journey, DB suite and migration rehearsal green on 59a8bed. Owner visual review recorded as owner attestation only; the agent did not open the screenshots. The 50,000 production cap and the production migration remain owner decisions. |
| MOTION-006 | BLOCKED | IMPLEMENTATION REQUIRED | Authenticated before-and-after recordings, six viewports and reduced-motion interaction across all surfaces. |
| MOTION-007 | BLOCKED | OWNER DECISION REQUIRED | Umbrella criterion. The provenance of the "detailed spec" is ambiguous and must be confirmed by the owner before it can close. |
| MOTION-008 | BLOCKED | OWNER DECISION REQUIRED | Sections 12–15 of the owner specification span all modules. The owner must confirm the release scope. |
| MOTION-009 | NOT TESTED | IMPLEMENTATION REQUIRED | Real queue saturation, ordering, re-entry and route disposal in the application. Unit tests do not cover these. |
| MOTION-010 | NOT TESTED | IMPLEMENTATION REQUIRED | Real preview and publication for every supported route, classic fallback and family, plus independent six-viewport review. |
| MOTION-011 | BLOCKED | EXTERNAL EVIDENCE REQUIRED | Real browser coverage of every family and route, and an independent six-viewport review. |
| MOTION-012 | BLOCKED | IMPLEMENTATION REQUIRED | Full route and family matrix through generation and publishing, with before-and-after recordings. |
| MOTION-013 | BLOCKED | EXTERNAL EVIDENCE REQUIRED | Independently inspectable visual review across every real generation and publishing route. |
| MOTION-014 | BLOCKED | EXTERNAL EVIDENCE REQUIRED | Independently inspected baseline and after captures across families, routes and states, plus queue and accessibility checks. |
| MOTION-015 | BLOCKED | IMPLEMENTATION REQUIRED | Route and behaviour evidence, historical baselines, published AI and commerce journeys, and artifact inspection. |
| MOTION-016 | BLOCKED | IMPLEMENTATION REQUIRED | Six acceptance areas: queue, history, routes, AI, commerce, and independent visual review. |
| MOTION-017 | BLOCKED | DEPENDENT | Requires all preceding criteria, independent artifact inspection and the strict gate on the integrated head. |
| MOTION-018 | BLOCKED | DEPENDENT | Requires all owner criteria. Also needs the Prisma engine download, which the sandbox egress policy blocks. |
| RELEASE-001 | BLOCKED | IMPLEMENTATION REQUIRED | Root-cause trace and appropriate independent evidence for each remediation ID. |

## Summary (counted from the table above: 34 rows, of which 1 is closed and 33 are open)

- **Implementation required:** 15 records. Repository work can progress these. None has been implemented in this pass.
- **Owner decision required:** 6 records (ADMIN-006, ADMIN-007, ADMIN-013, ADMIN-022, MOTION-007, MOTION-008).
- **External evidence required:** 6 records (ADMIN-005, ADMIN-009, ADMIN-014, MOTION-011, MOTION-013, MOTION-014). Independent visual review, live DNS and the production restore.
- **Blocked by provider:** 1 record (ADMIN-008).
- **Not tested:** 2 records (MOTION-003, MOTION-005).
- **Dependent:** 3 records (ADMIN-002, MOTION-017, MOTION-018).
- **Closed:** 1 record (ADMIN-023, PASS on 59a8bed).

No record in this set is closed by fixtures, documentation or green CI alone.
