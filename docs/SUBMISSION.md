# PAVEL submission

PAVEL is a GenLayer application for policy-bounded agent authority,
authenticated evidence, deterministic GEN custody, and settlement-aware
fulfillment.

- Repository: <https://github.com/GIFTEDLOV/pavel>
- Live application: <https://pavel-nine.vercel.app>
- Network: Studionet (`61999`)
- RPC: <https://studio.genlayer.com/api>
- Core: `0x1540cEa5d3Df622068B2d3A22aac8Bcb31B900f4`
- Vault: `0xac43A164AB9e82d7Af387059c04579FE48050fce`
- Explorer: <https://explorer-studio.genlayer.com>

## Verified V8 lifecycle

The source-verified V8 pair completed a clean hosted lifecycle through
canonical authorization, reservation, full-content fulfillment, and a
Core-directed release request. The current canonical state is:

```text
Mandate: SEALED
Authorization: AUTHORIZED
Reservation: RESERVED → released to RELEASE_PENDING
Fulfillment: FULFILLED
Settlement: RELEASE_PENDING
Accounting: CONSERVED
External transfer: UNCONFIRMED
```

`RELEASE_PENDING` is not presented as external payment completion. V1–V6
qualification failures remain preserved as historical provenance.

## V8 steward proof

The V8 Core requires authenticated sequence-one fulfillment evidence before
assessment. The live qualification records a qualifying challenge changing the
canonical settlement instruction to `CHALLENGE_BLOCKED` with an empty
direction, followed by contract-enforced expiry and a release request after
the blocker was removed. The sanitized machine-readable proof is under
`deployments/studionet/qualification-v8/`. V1-V7 addresses and failures remain
historical provenance.
