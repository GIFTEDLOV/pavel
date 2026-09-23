# PAVEL V7 Studionet deployment

This directory records the active, source-verified PAVEL V7 deployment. V1–V6
qualification records remain under their versioned historical directories and
are not runtime configuration.

| Field | Verified value |
| --- | --- |
| Network | Studionet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Core | `0xBA2356FfE5062506FA938da4715c03a2BE7929bF` |
| Vault | `0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD` |
| Core SHA-256 | `4acc04c4b684b35058b793973eec75569af9e981eb84d33167198615255b785a` |
| Vault SHA-256 | `f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c` |
| Source parity | PASS |
| Core/Vault binding | PASS, bidirectional |
| Authorization | `pavel-authorization-v2`, canonical `AUTHORIZED` |
| Fulfillment | `pavel-fulfillment-v2`, canonical `FULFILLED` |
| Settlement | `RELEASE_PENDING` |
| Accounting | Conserved |
| External settlement | `UNCONFIRMED` |

The deployment manifest is the machine-readable summary. Detailed lifecycle
evidence and historical qualification failures are preserved in
[`docs/QUALIFICATION.md`](../../docs/QUALIFICATION.md) and
[`PROVENANCE.md`](../../PROVENANCE.md).
