# GenLayer Studio smoke test for SWAPBACK

**Network:** Studionet (https://studio.genlayer.com), chain ID 61999.

1. Open **Contracts**, create a new Python Intelligent Contract, and paste the complete `contracts/ExchangeCourt.py` from GitHub. Deploy from your selected funded Studio account.
2. Wait for finalized deployment with successful execution, then copy contract address. The deployer is the only permitted caller for `open_case` and `adjudicate`.
3. Invoke `open_case` (write) using the EXACT four arguments below. **This digest is SHA-256 of the synthetic public brief for smoke testing only, not a real persisted case snapshot.** 
4. After successful finalization, invoke `adjudicate` (write) with the same `case_id`. LLM validators independently assess the outcome.
5. Invoke `get_case` (view) with the same `case_id`. Check returned `snapshot_sha256` and the JSON `final` field. The expected outcome is **ELIGIBLE**, but this is **not guaranteed**: LLM consensus can vary; inspect result and execution logs.

## Test arguments

`case_id`
```text
SWAP-STUDIO-001
```

`snapshot_sha256`
```text
67c9569c22a314e819928c011d8efddf74a9374f080c8386a949b21a185b2e2e
```

`public_brief`
```text
Order O100: The dock advertised USB4 video compatibility at purchase. Buyer reports that the delivered dock cannot output USB4 video. Merchant confirms the advertised USB4 feature was absent in delivered model.
```

`rubric`
```text
R1: If the delivered dock lacks a feature promised in the purchase-time description and the merchant confirms the mismatch, the buyer is eligible for exchange.
```

The public brief contains no personal data. Do NOT put real private appeals, shipping details or sensitive merchant records on-chain.

## Important limits

- `adjudicate` is a nondeterministic consensus transaction and can fail/revert; inspect logs before retrying.
- The contract verifies citation substrings, but semantic quality is only as strong as the validator prompt and evidence.
- The demo Node server is not wired to read these on-chain results yet. An on-chain verdict alone does not unhide a Discourse post or create a WooCommerce order.
- For a **real** case, hash the exact frozen case snapshot from the backend and supply only a reviewed redacted public brief, then verify the digest equality when executing an external action.
- Do not call the same write twice blindly after network timeout; first read case state and check transaction outcome.
