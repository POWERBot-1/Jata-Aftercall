# TAWA route inventory (mechanical, incomplete coverage analysis)

Source: `b86b70a5b46654159e6afb823dedc5f55186ba8f`. Extracted from route declarations; not proof of behavior, authorization, database access, or test coverage. Dynamic registrations and indirect calls may be omitted. Database tables and test coverage are **not audited**.

| Source route file | Declared routes | Direct module imports | Database and test coverage |
|---|---:|---|---|
| `server/routes/admin.js` | 10 | `ledger.js` | Not audited |
| `server/routes/catalog.js` | 11 | `ai.js` | Not audited |
| `server/routes/comms.js` | 21 | `payments.js` | Not audited |
| `server/routes/files.js` | 7 | — | Not audited |
| `server/routes/identity.js` | 14 | — | Not audited |
| `server/routes/intel.js` | 11 | `ai.js`, `ledger.js` | Not audited |
| `server/routes/inventory.js` | 10 | `inventory.js` | Not audited |
| `server/routes/keys.js` | 4 | — | Not audited |
| `server/routes/logistics.js` | 6 | — | Not audited |
| `server/routes/money.js` | 13 | `ledger.js`, `payments.js`, `payouts.js` | Not audited |
| `server/routes/payments.js` | 12 | `payments.js` | Not audited |
| `server/routes/procurement.js` | 14 | `documents.js`, `inventory.js`, `ledger.js`, `payments.js`, `payouts.js` | Not audited |
| `server/routes/relationships.js` | 20 | `ledger.js`, `payments.js` | Not audited |
| `server/routes/sales.js` | 19 | `documents.js`, `ledger.js`, `payments.js`, `sales.js` | Not audited |
| `server/routes/settings.js` | 17 | — | Not audited |
| `server/routes/workforce.js` | 12 | `ledger.js`, `payments.js`, `payouts.js` | Not audited |

## Declared routes

### `server/routes/admin.js`

- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/tenants`
- `POST /api/v1/admin/tenants/:id/plan`
- `POST /api/v1/admin/tenants/:id/status`
- `POST /api/v1/admin/tenants`
- `GET /api/v1/admin/audit`
- `GET /api/v1/admin/integrity`
- `GET /api/v1/admin/usage`
- `GET /api/v1/admin/events`
- `GET /api/v1/admin/events/dlq`

### `server/routes/catalog.js`

- `GET /api/v1/units`
- `GET /api/v1/categories`
- `POST /api/v1/categories`
- `GET /api/v1/products`
- `GET /api/v1/products/:id`
- `POST /api/v1/products`
- `PATCH /api/v1/products/:id`
- `GET /api/v1/products/:id/relations`
- `POST /api/v1/products/:id/relations`
- `GET /api/v1/synonyms`
- `POST /api/v1/synonyms`

### `server/routes/comms.js`

- `GET /api/v1/notifications`
- `POST /api/v1/notifications/:id/read`
- `GET /api/v1/notifications/outbound`
- `GET /api/v1/alerts/rules`
- `POST /api/v1/alerts/rules`
- `PATCH /api/v1/alerts/rules/:id`
- `GET /api/v1/automation/rules`
- `POST /api/v1/automation/rules`
- `GET /api/v1/marketing/campaigns`
- `POST /api/v1/marketing/campaigns`
- `POST /api/v1/marketing/campaigns/:id/approve`
- `POST /api/v1/marketing/campaigns/:id/send`
- `GET /api/v1/marketing/promotions`
- `POST /api/v1/marketing/promotions`
- `POST /api/v1/marketing/promotions/evaluate`
- `GET /api/v1/marketing/loyalty`
- `GET /api/v1/autopay/rules`
- `POST /api/v1/autopay/rules`
- `POST /api/v1/autopay/rules/:id/toggle`
- `GET /api/v1/notification-config`
- `PUT /api/v1/notification-config`

### `server/routes/files.js`

- `POST /api/v1/files`
- `POST /api/v1/files/logo`
- `GET /api/v1/files`
- `GET /api/v1/files/:id/raw`
- `GET /api/v1/files/:id/info`
- `GET /api/v1/files/:id`
- `DELETE /api/v1/files/:id`

### `server/routes/identity.js`

- `GET /api/v1/brand`
- `GET /api/v1/public/tenants`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/change-password`
- `GET /api/v1/users`
- `POST /api/v1/users`
- `PATCH /api/v1/users/:id`
- `GET /api/v1/roles`
- `GET /api/v1/public/plans`
- `POST /api/v1/public/signup`
- `GET /api/v1/onboarding`
- `PUT /api/v1/onboarding`

### `server/routes/intel.js`

- `GET /api/v1/dashboard`
- `GET /api/v1/ai/insights`
- `POST /api/v1/ai/ask`
- `GET /api/v1/ai/reorder`
- `GET /api/v1/ai/log`
- `GET /api/v1/analytics/overview`
- `GET /api/v1/ai/status`
- `GET /api/v1/ai/status/outcomes`
- `GET /api/v1/reports/:name`
- `GET /api/v1/search/tenant-scope`
- `GET /api/v1/search`

### `server/routes/inventory.js`

- `GET /api/v1/branches`
- `POST /api/v1/branches`
- `GET /api/v1/warehouses`
- `POST /api/v1/warehouses`
- `GET /api/v1/inventory/levels`
- `GET /api/v1/inventory/valuation`
- `GET /api/v1/inventory/movements`
- `POST /api/v1/inventory/receive`
- `POST /api/v1/inventory/adjust`
- `POST /api/v1/inventory/transfer`

### `server/routes/keys.js`

- `GET /api/v1/api-keys`
- `POST /api/v1/api-keys`
- `POST /api/v1/api-keys/:id/revoke`
- `DELETE /api/v1/api-keys/:id`

### `server/routes/logistics.js`

- `GET /api/v1/deliveries`
- `POST /api/v1/deliveries`
- `POST /api/v1/deliveries/:id/assign`
- `POST /api/v1/deliveries/:id/advance`
- `POST /api/v1/deliveries/:id/complete`
- `POST /api/v1/deliveries/:id/send-otp`

### `server/routes/money.js`

- `GET /api/v1/expenses`
- `POST /api/v1/expenses`
- `POST /api/v1/expenses/:id/approve`
- `POST /api/v1/expenses/:id/reject`
- `POST /api/v1/expenses/:id/pay`
- `GET /api/v1/accounting/accounts`
- `GET /api/v1/accounting/journal`
- `GET /api/v1/accounting/trial-balance`
- `GET /api/v1/accounting/pnl`
- `GET /api/v1/accounting/balance-sheet`
- `GET /api/v1/accounting/integrity`
- `GET /api/v1/accounting/journal.csv`
- `GET /api/v1/accounting/reconcile`

### `server/routes/payments.js`

- `GET /api/v1/payments/intents`
- `POST /api/v1/payments/intents`
- `POST /api/v1/payments/intents/:id/initiate`
- `POST /api/v1/payments/intents/:id/verify`
- `POST /api/v1/payments/intents/:id/confirm-cash`
- `POST /api/v1/payments/intents/:id/confirm-bank`
- `GET /api/v1/payments`
- `POST /api/v1/payments/:id/refund`
- `GET /api/v1/payments/reconcile`
- `GET /api/v1/payments/providers`
- `POST /api/v1/webhooks/payments/:provider`
- `POST /api/v1/sandbox/mpesa/outcome`

### `server/routes/procurement.js`

- `GET /api/v1/procurement/requisitions`
- `POST /api/v1/procurement/requisitions`
- `POST /api/v1/procurement/requisitions/:id/approve`
- `POST /api/v1/procurement/requisitions/:id/reject`
- `GET /api/v1/procurement/pos`
- `GET /api/v1/procurement/pos/:id`
- `POST /api/v1/procurement/pos`
- `POST /api/v1/procurement/pos/:id/approve`
- `POST /api/v1/procurement/pos/:id/send`
- `POST /api/v1/procurement/pos/:id/receive`
- `GET /api/v1/procurement/pos/:id/document`
- `GET /api/v1/procurement/invoices`
- `POST /api/v1/procurement/invoices`
- `POST /api/v1/procurement/invoices/:id/pay`

### `server/routes/relationships.js`

- `GET /api/v1/customers`
- `GET /api/v1/customers/segments`
- `GET /api/v1/customers/:id`
- `POST /api/v1/customers`
- `PATCH /api/v1/customers/:id`
- `GET /api/v1/customers/segment/:name/export`
- `GET /api/v1/credit/accounts`
- `GET /api/v1/credit/accounts/:customerId`
- `POST /api/v1/credit/accounts`
- `POST /api/v1/credit/accounts/:customerId/pay`
- `GET /api/v1/suppliers`
- `GET /api/v1/suppliers/:id`
- `POST /api/v1/suppliers`
- `GET /api/v1/brokers`
- `POST /api/v1/brokers`
- `GET /api/v1/brokers/:id`
- `POST /api/v1/brokers/:id/leads`
- `POST /api/v1/leads/:id/convert`
- `POST /api/v1/commissions/:id/approve`
- `POST /api/v1/commissions/:id/pay`

### `server/routes/sales.js`

- `GET /api/v1/quotes`
- `GET /api/v1/quotes/:id`
- `POST /api/v1/quotes`
- `POST /api/v1/quotes/:id/send`
- `POST /api/v1/quotes/:id/accept`
- `POST /api/v1/quotes/:id/reject`
- `POST /api/v1/quotes/:id/convert`
- `GET /api/v1/quotes/:id/document`
- `GET /api/v1/orders`
- `GET /api/v1/orders/:id`
- `POST /api/v1/orders`
- `POST /api/v1/orders/:id/fulfil`
- `POST /api/v1/orders/:id/cancel`
- `GET /api/v1/orders/:id/invoice`
- `POST /api/v1/pos/sale`
- `POST /api/v1/pos/complete`
- `GET /api/v1/receipts/:paymentId`
- `GET /api/v1/deliveries/:id/note`
- `GET /api/v1/sales/today`

### `server/routes/settings.js`

- `GET /api/v1/settings/branding`
- `PUT /api/v1/settings/branding`
- `GET /api/v1/settings/flags`
- `PUT /api/v1/settings/flags`
- `GET /api/v1/billing/subscription`
- `GET /api/v1/billing/matrix`
- `POST /api/v1/billing/change-plan`
- `GET /api/v1/integrations`
- `GET /api/v1/audit`
- `GET /api/v1/settings/tenant`
- `PATCH /api/v1/settings/tenant`
- `POST /api/v1/settings/domains`
- `GET /api/v1/settings/payment-config`
- `PUT /api/v1/settings/payment-config/:provider`
- `POST /api/v1/settings/payment-config/:provider/test`
- `GET /api/v1/settings/export`
- `GET /api/v1/settings/backup`

### `server/routes/workforce.js`

- `GET /api/v1/workers`
- `POST /api/v1/workers`
- `GET /api/v1/workers/:id/performance`
- `POST /api/v1/workers/:id/attendance`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks`
- `POST /api/v1/tasks/:id/transition`
- `GET /api/v1/payroll/runs`
- `POST /api/v1/payroll/calculate`
- `POST /api/v1/payroll/runs/:id/review`
- `POST /api/v1/payroll/runs/:id/approve`
- `POST /api/v1/payroll/runs/:id/execute`
