# Acceptance evidence and next integrations

## This prototype can demonstrate

- Purchase-time descriptions and policies frozen into a SHA-256 snapshot.
- Buyer identity checked against local fixture purchase owner.
- Store response offers two candidates; code checks USB4 suitability.
- Explicitly **manual fixture** eligibility decision with exact evidence quote.
- Atomic single-unit stock reservation with expiration and release.
- Warehouse return matching before replacement.
- One durable replacement record, unique per case; fault injection rolls back cleanly.
- HTTP tests cover buyer authorization, final-unit competition, readback, failure retry, and return mismatch.

## Still missing before a 9/10 rating

- WooCommerce sandbox credentials, actual order import, real stock sync and order-creation readback.
- Robust external idempotency/reconciliation across API timeout after a successful remote write.
- Wallet proof of purchase and secure role mapping; current headers are demo-only.
- GenLayer adjudication deployed, verified and linked to the case digest.
- Real shipment/return authorization, tax/price/shipping edge cases, public UI E2E, and pilot users.

Do not confuse local product quantity changes with actual WooCommerce inventory.
