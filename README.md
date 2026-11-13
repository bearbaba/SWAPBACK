# SWAPBACK

Runnable **local SQLite exchange pilot**: buyer claim → store reply → purchase-time evidence freeze → **manual fixture decision** → buyer-selected compatible SKU → atomic hold → matching return → one replacement order → readback.

**Status (2026-11-13):** Actual source, dashboard and HTTP tests are now committed. The previous README described files that were absent from `main`; those claims are corrected. This is **not yet** a live WooCommerce or GenLayer integration.

## Run

Node.js 24+, no third-party runtime packages:

```bash
npm run demo
npm test
```

Open http://127.0.0.1:4200. Loopback only. Persistent demo DB: `data/swapback.sqlite`. Demo role and buyer headers are *not authentication*; non-demo mode fails closed.

## Evidence walkthrough

- **O100** belongs to alice; **O101** belongs to bob. Both bought DOCK-OLD advertised with USB4.
- Warehouse offers DOCK-LITE (no USB4) and DOCK-PRO (USB4, only one available).
- Buyer chooses a compatible SKU only after a frozen record and manually selected ELIGIBLE verdict.
- Two competing claims for the final DOCK-PRO can only hold one item. Warehouse verifies returned goods before creating replacement.
- Inject `simulateFailure:true` into fulfillment, retry, and observe exactly one replacement row; repeated success returns the same order.
- Reservation expires after 15 minutes; read `/api/state` to trigger automatic release.

API: `GET /api/state`, `POST /api/cases`, `GET /api/cases/:id`, `POST /api/cases/:id/respond|freeze|decide|choose|receive|fulfill`.

Read [acceptance and remaining gaps](docs/ACCEPTANCE.md). Real WooCommerce and GenLayer execution remains an explicit milestone, not a completed feature.

## Contract source

A non-deployed GenLayer Intelligent Contract source draft is included at [contracts/ExchangeCourt.py](contracts/ExchangeCourt.py). It requires GenVM validation, deployment, independent consensus and API wiring. See [contract verification notes](docs/GENLAYER.md).
