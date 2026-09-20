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

The v1 failure is preserved in `artifacts/studionet/qualification-v1/` and is
not sanitized. The v2 artifacts are separate and currently record a finalized
Core with Vault deployment pending manual signing. The canonical deployment
manifest remains undeployed.
