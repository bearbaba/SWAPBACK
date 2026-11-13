# WooCommerce adapter — limited integration boundary

`integrations/woocommerce.mjs` provides authenticated HTTPS WooCommerce REST API v3 order and product reads, stock preflight, one on-hold replacement order POST and immediate remote readback by created ID. The documented endpoint is `/wp-json/wc/v3/orders`.

This adapter is intentionally **not called by the local fixture server**. It requires a WooCommerce sandbox and must be called only after authenticated buyer authorization, finalized GenLayer verification, suitable SKU proof, accepted warehouse return and a durable operation journal.

**Important:** WooCommerce's ordinary order API does not guarantee exactly-once order creation for repeated HTTP POSTs, nor does a product GET atomically reserve the final unit. On timeout after send, the adapter returns `UNCERTAIN_REMOTE_WRITE` and refuses automatic retries. Before real use, implement a server-side unique-key endpoint/plugin or durable outbox reconciliation and stock reservation locking on the WooCommerce store. Test two simultaneous buyers and external API timeout against a sandbox before enabling writes. Do not present local SQLite stock as real WooCommerce inventory.
