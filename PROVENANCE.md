# Provenance

Primary technical authority: [GenLayer full documentation](https://docs.genlayer.com/full-documentation.txt), reviewed 2026-09-20.

Secondary engineering references were inspected locally without copying product behavior:

- `GIFTEDLOV/sentinelx` — evidence identity, retryable capture, source/deployment provenance, state-machine hardening.
- `GIFTEDLOV/uphold` — trust boundaries, immutable snapshots, pending external settlement, frontend transaction honesty.
- `ometere123/aevum` — Core/Vault split, one-time binding, accounting separation, transaction persistence, network guards.

PAVEL is a distinct protocol. No live deployment addresses, transaction hashes, faucet state, or consensus proof are imported from those repositories.

## Local source and qualification history

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
agent registration; remaining lifecycle writes await secure manual signing.
The canonical deployment manifest remains undeployed.

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
automatic retry. No contract source changed and no third create-Mandate write
was broadcast during this audit.
