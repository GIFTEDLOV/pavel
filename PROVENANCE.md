# Provenance

Primary technical authority: [GenLayer full documentation](https://docs.genlayer.com/full-documentation.txt), reviewed 2026-09-20.

## 2026-09 local steward remediation

This entry records a source-only remediation after the deployed V7 baseline.
No Studionet write, deployment, GitHub push, PR, or Vercel deployment was
performed. The deployed V7 Core remains at
`0xBA2356FfE5062506FA938da4715c03a2BE7929bF` with source hash
`4acc04c4b684b35058b793973eec75569af9e981eb84d33167198615255b785a`.

The corrected local Core hash is
`1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60`.
Vault source is unchanged at
`f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c`.
The Core assessment gate, challenge read/command surface, frontend gating,
and local tests were updated on branch
`fix/steward-challenge-fulfillment`. Core/Vault binding is one-shot, so the
existing V7 Vault is not reusable with the corrected Core; a fresh pair and
qualification are pending. Historical V1-V7 provenance remains intact.

Secondary engineering references were inspected locally without copying product behavior:

- `GIFTEDLOV/sentinelx` — evidence identity, retryable capture, source/deployment provenance, state-machine hardening.
- `GIFTEDLOV/uphold` — trust boundaries, immutable snapshots, pending external settlement, frontend transaction honesty.
- `ometere123/aevum` — Core/Vault split, one-time binding, accounting separation, transaction persistence, network guards.

PAVEL is a distinct protocol. No live deployment addresses, transaction hashes, faucet state, or consensus proof are imported from those repositories.

## Deployed V7 contract source

This identity is frozen and is not changed by the documentation or frontend
cleanup in this pass.

| Field | Verified value |
| --- | --- |
| Network | Studionet (`61999`) |
| Core | `0xBA2356FfE5062506FA938da4715c03a2BE7929bF` |
| Vault | `0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD` |
| Core SHA-256 | `4acc04c4b684b35058b793973eec75569af9e981eb84d33167198615255b785a` |
| Vault SHA-256 | `f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c` |
| Authorization schema | `pavel-authorization-v2` |
| Fulfillment schema | `pavel-fulfillment-v2` |
| Canonical qualification state | `FULFILLED / RELEASE_PENDING` |
| External settlement | `UNCONFIRMED` |

## Current repository release

The repository release is the final Git commit after this V7.0.1 hardening
pass, not the historical source baseline below. The source and proof commit
that was verified before this provenance metadata update is recorded
explicitly below.

| Provenance field | Verified value |
| --- | --- |
| `REPOSITORY_RELEASE_HEAD` | `b45dd5e4c57f94b2eabd615c5371f2966a853eff` |
| `PRODUCTION_BUILD_HEAD` | `b45dd5e4c57f94b2eabd615c5371f2966a853eff` |
| `PRODUCTION_DEPLOYMENT_ID` | `dpl_9MMMKLk79L47wsVnUpgCcihSEXap` |
| Production deployment state | `READY` / production |

The deployment above was queried from Vercel's deployment API and its
`githubCommitSha` matched `PRODUCTION_BUILD_HEAD` exactly. This metadata
commit is documentation-only. Because the Vercel Git integration can create a
new production deployment for this provenance commit, the final deployment
whose `githubCommitSha` equals the final repository `HEAD` is the
release-authoritative record and is recorded in the PAVEL V7.0.1 GitHub
Release metadata. The provenance process deliberately stops there rather than
creating a recursive deployment/documentation loop.

| Field | Verified value |
| --- | --- |
| Repository | <https://github.com/GIFTEDLOV/pavel> |
| Release tag | `v7.0.1` (final repository HEAD) |
| Production alias | <https://pavel-nine.vercel.app> |
| Vercel deployment | See `PRODUCTION_DEPLOYMENT_ID` above and the final V7.0.1 GitHub Release record |
| Frontend release | Current `frontend/` source deployed by the Vercel deployment above |
| External settlement | `UNCONFIRMED` |

The historical source baseline commit `8e59a99b1b7a83f28716549694df2f6d45ec025e`
is retained only as audit history; it is not presented as the current frontend
release or repository HEAD.

## HISTORICAL — Local source and qualification history

- Phase 1/Phase 2A source head: `e48e851398a11af2f5bf2a9b820003148afd315c`.
- Corrected Core SHA-256: `d3ad610319a175041b5d993826a1845e04a3feb4e59082be819859967b858259`.
- Corrected Vault SHA-256: `29fd8a384813617b7d37226438b5bb31429ad6e12e81a3ada210429cebf7a794`.
- qualification-v1 Core: `0x572773E2Ab38AA5a546bcFC50bE25F209fB19159`, tx `0xb61770d4f9faebe9644bac5bbfc3625325d49446912e228322ef7dc6a7ff5766`, finalized successfully but historical and not reusable.
- qualification-v1 failed Vault: `0x93541666268fCC02a2087b9275731Aabeb78826F`, tx `0x2ec844f28396971ea0d8f1eb3f47414dead3ec618c02eb8c307d1753b7f73861`, execution error from `Address(Address(...))`.
- qualification-v2 corrected Core: `0xBb5e144F1b93F5E7b1A5B3fE07ccf677B29b16EA`, tx `0x7267525ae6e0e08780850c4a8316c163447ba47dd208aecb73f74bc8cda16840`, finalized and source-verified.
- qualification-v2 corrected Vault: `0x14d101A283cE2C51E0A4306178BdB5353cD84922`, tx `0xadf4ad220c4e87bdfe76fe76eca9695b8217b80b3c832e836f8602533d94b7cc`, nonce `170`, finalized with successful execution and source-verified.
- qualification-v2 Vault binding: tx `0x4cff26c3356d2481a5ab731a995ed7ebe78ded2ec3314883c9c9345b00578be7`, nonce `171`, finalized with successful execution; Vault history records `CORE_BOUND`.
- qualification-v2 Core binding: tx `0xe9f17f1ca529616682ea4f40605182460580a30d553ad6efd3e966663a410cb1`, nonce `172`, finalized with successful execution; Core history records `VAULT_BOUND`.
- qualification-v2 principal registration: tx `0x62ecaa10b2f11914ebfb3819334a4edcbe96954010b64a3cabb9cf24b76df7c7`, nonce `173`, finalized with successful execution; finalized state snapshot records the principal map mutation.
- qualification-v2 agent registration: tx `0xb34afbd1f7809f892169f892bf3cd7b291c36bbb985bbc28ddd33d35705ce511`, nonce `174`, finalized with successful execution; finalized state snapshot records the exact agent address and active marker.

The v1 failure is preserved in `artifacts/studionet/qualification-v1/` and is
not sanitized. The v2 artifacts are separate and currently record a finalized
Core, a finalized Vault, bidirectional binding, principal registration, and
agent registration; remaining lifecycle writes await explicit fixed-source
deployment followed by secure manual signing.
The historical qualification-v2 manifest remained undeployed by design; the
active V7 manifest is the current runtime record.

The qualification-v2 root-Mandate integration failures are both preserved.
Transaction `0xcc4d6551d0f76df05bc8c0eefdef5e1e2a593433ede6979fd208a4220f5f64b0`
(nonce `175`) finalized with `ERROR` despite `MAJORITY_AGREE` because the
standalone empty argument was omitted before invocation. The second transaction
`0x7eb6175aab8a0cfdfc820a7e3a17f4769655e7d170feb3adce1b26b4622dd6f1`
(nonce `176`) also finalized with `ERROR`; the pinned CLI encoded its explicit
`--args=` value as numeric `0`, producing `parent mandate id must be text`.
Both had no state mutation. The earlier local regression had false confidence
because it modeled a custom parser instead of executing the installed CLI's
`parseScalar/parseArg` implementation. The updated regression extracts the
actual pinned bundle parser and uses the actual pinned SDK codec for the
positive path.

The pinned CLI exact-empty-string capability is recorded as unavailable. The
safe replacement is the pinned `genlayer-js` 1.1.8 SDK helper
`scripts/qualification/create-root-mandate.ts`, which reuses the existing
encrypted keystore via secure interactive decryption, constructs
`[CalldataAddress(agent), ""]`, prints and round-trips the typed calldata,
requires explicit confirmation, submits once, and persists the hash without
automatic retry. No third create-Mandate write was broadcast during this
audit.

The subsequent autonomous-runner preparation found that the CLI active profile
was `agentpact-requester` on `studio-dev`, while the expected qualification
address is stored in the encrypted `meritround-v2-studionet` profile. This is
an account-metadata selection issue, not a contract or network defect. The
runner now resolves the expected profile by address, records metadata-only
preflight evidence, and leaves encrypted-keystore decryption behind one
explicit confirmation and the secure local password prompt. At this checkpoint
no new transaction has been submitted.

The subsequent root transaction
`0x18259af48075b6a1a308b3407dd84fce2d3f871ca16e4930d4c4ef50259df962`
(nonce `177`) is preserved as finalized consensus `MAJORITY_AGREE` with
execution error `malformed transaction timezone`. The leader receipt is the
execution-result source; Core finalized state proves no Mandate mutation
(`get_mandate_count() == 0`, `M-1 == ""`). Latest and pending signer nonce
both reconcile to `0xb2`. The local parser compatibility fix is committed,
but the deployed bytecode remains the old source and therefore qualification-v2
is historical until an explicitly authorized redeployment and source audit.

## V7 live qualification

The V7 source-verified pair is deployed on Studionet 61999:

- Core `0xBA2356FfE5062506FA938da4715c03a2BE7929bF`, SHA-256
  `4acc04c4b684b35058b793973eec75569af9e981eb84d33167198615255b785a`.
- Vault `0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD`, SHA-256
  `f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c`.

The clean V7 lifecycle reached canonical `FULFILLED` and a Vault
`RELEASE_PENDING` settlement request with external observation
`UNCONFIRMED`. This is a truthful qualification result, not confirmation of an
external transfer. The V7 release runner uses the pinned GenLayer CLI OS
keychain cache without exposing or persisting signing material.
