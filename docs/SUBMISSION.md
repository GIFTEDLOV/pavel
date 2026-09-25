# PAVEL submission

PAVEL is a GenLayer application for policy-bounded agent authority,
authenticated evidence, deterministic GEN custody, and settlement-aware
fulfillment.

- Repository: <https://github.com/GIFTEDLOV/pavel>
- Live application: <https://pavel-nine.vercel.app>
- Network: Studionet (`61999`)
- RPC: <https://studio.genlayer.com/api>
- Core: `0xBA2356FfE5062506FA938da4715c03a2BE7929bF`
- Vault: `0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD`
- Explorer: <https://explorer-studio.genlayer.com>

## Verified V7 lifecycle

The source-verified V7 pair completed a clean hosted lifecycle through
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

## Remediation status

The submission addresses and lifecycle above describe deployed V7. The local
steward remediation is source-only and pending deployment: Core now requires
authenticated sequence-one fulfillment evidence before assessment, and the
frontend contains the complete canonical challenge workflow. The corrected
Core SHA-256 is
`1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60`; the
deployed V7 Core still has SHA-256
`4acc04c4b684b35058b793973eec75569af9e981eb84d33167198615255b785a`.
No active address, deployment manifest, or hosted claim is changed by this
local pass. A fresh Core/Vault qualification is required before release.
