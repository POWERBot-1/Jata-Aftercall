-- Payment Wallet hardening: persist the provider-issued receipt for M-PESA STK.
--
-- Additive and rerunnable: existing transaction identities and payment history are untouched.
-- providerTransactionId deliberately remains the CheckoutRequestID correlation handle.
ALTER TABLE "PaymentTransaction"
    ADD COLUMN IF NOT EXISTS "providerReceipt" TEXT;

-- Supports authenticated asynchronous provider-result correlation without a table scan.
CREATE INDEX IF NOT EXISTS "Refund_provider_providerReference_idx"
    ON "Refund"("provider", "providerReference");
