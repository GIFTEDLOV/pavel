# PAVEL V8 Studionet deployment

This directory records the active, source-verified PAVEL V8 deployment. V1–V7
qualification records remain under their versioned historical directories and
are not runtime configuration.

| Field | Verified value |
| --- | --- |
| Network | Studionet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Core | `0x1540cEa5d3Df622068B2d3A22aac8Bcb31B900f4` |
| Vault | `0xac43A164AB9e82d7Af387059c04579FE48050fce` |
| Core SHA-256 | `1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60` |
| Vault SHA-256 | `f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c` |
| Source parity | PASS |
| Core/Vault binding | PASS, bidirectional |
| Authorization | `pavel-authorization-v2`, canonical `AUTHORIZED` |
| Fulfillment | `pavel-fulfillment-v2`, canonical `FULFILLED` |
| Settlement | `RELEASE_PENDING` |
| Accounting | Conserved |
| External settlement | `UNCONFIRMED` |

The live V8 proof package records the complete challenge path: `SUBMITTED`
did not block, authenticated evidence reached `QUALIFYING`, the canonical
settlement readback became `CHALLENGE_BLOCKED` with an empty direction, and
contract-enforced expiry removed the blocker. The fulfillment-gate proof
records authenticated sequence-one evidence before assessment.

Machine-readable proof is under
[`qualification-v8/`](qualification-v8/), including deployment, lifecycle,
fulfillment-gate, challenge-flow, source-parity, and final-accounting records.

The deployment manifest is the machine-readable summary. Detailed lifecycle
evidence and historical qualification failures are preserved in
[`docs/QUALIFICATION.md`](../../docs/QUALIFICATION.md) and
[`PROVENANCE.md`](../../PROVENANCE.md).
