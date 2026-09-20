# Qualification

Qualification must run Python compile checks, Direct Mode, property/invariant tests, adversarial evidence and semantic tests, `genvm-lint check`, `validate`, `schema`, and strict `typecheck`, frontend tests/typecheck/lint/build, source hash checks, deployment-manifest schema validation, secret scan, and network guard.

Studio/Studionet qualification is a separate explicit stage. It must use stable Studionet chain `61999` and the exact source manifest produced by the final local commit. It must not be inferred from Direct Mode or from an accepted-but-unsuccessful transaction.

## Phase 2A live constructor finding

The first qualification PavelVault deployment was not successful. Transaction
`0x2ec844f28396971ea0d8f1eb3f47414dead3ec618c02eb8c307d1753b7f73861` reached
`FINALIZED` with an execution error before Core/Vault binding. Stable CLI
calldata represented the Core constructor argument as `addr#...`, which the
GenVM decoded to an already-instantiated `Address`. The previous constructor
called `Address(core_address)` and therefore attempted `Address(Address(...))`.
The deterministic error was `TypeError: cannot convert 'Address' object to
bytes` at `contract.py:65`.

The failed receipt, nonce, provisional address, validator votes, and exact
trace are retained in `artifacts/studionet/qualification-v1/`; the provisional
Vault address is not bindable and is not treated as a deployment. The Vault
constructor now preserves an existing runtime `Address` and only normalizes a
bounded legacy string/bytes representation. Address-boundary regression tests
exercise the stable v0.2.16 runtime type, including zero-address rejection and
the Core address parameters. No replacement deployment or Core binding was
performed after the failure.

## Qualification-v2 corrected Core

The corrected source was committed at `e48e851398a11af2f5bf2a9b820003148afd315c`.
The user-signed Core deployment was:

- transaction: `0x7267525ae6e0e08780850c4a8316c163447ba47dd208aecb73f74bc8cda16840`;
- nonce: `169`;
- address: `0xBb5e144F1b93F5E7b1A5B3fE07ccf677B29b16EA`;
- status: `FINALIZED`;
- consensus: `MAJORITY_AGREE`;
- leader execution: `SUCCESS`;
- local/deployed source SHA-256: `d3ad610319a175041b5d993826a1845e04a3feb4e59082be819859967b858259`;
- source retrieval: stable `gen_getContractCode`, 95,533 bytes, exact byte match.

Readback proved the corrected Core owner is the qualification deployer and
`get_vault_address()` is the zero address. The deployed schema has no
`get_vault_bound` method; an attempted call was rejected as an undefined
method, so the zero-address read is the authoritative unbound indicator.

The corrected Vault is now finalized successfully at
`0x14d101A283cE2C51E0A4306178BdB5353cD84922` from transaction
`0xadf4ad220c4e87bdfe76fe76eca9695b8217b80b3c832e836f8602533d94b7cc`, nonce
`170`, with five agreeing validators. Finalized-state `gen_getContractCode`
retrieval produced 18,808 bytes with exact SHA-256
`29fd8a384813617b7d37226438b5bb31429ad6e12e81a3ada210429cebf7a794`.
`get_core_address()` returned the corrected Core exactly, proving the live
Address-calldata constructor regression.

The Vault-side binding then finalized successfully in transaction
`0x4cff26c3356d2481a5ab731a995ed7ebe78ded2ec3314883c9c9345b00578be7`, nonce
`171`, with `MAJORITY_AGREE` and successful execution. The Vault readback
returned the corrected Core, and history item zero recorded `CORE_BOUND`.
Before the second binding, Core returned the zero Vault address. The Core-side
binding then finalized successfully in transaction
`0xe9f17f1ca529616682ea4f40605182460580a30d553ad6efd3e966663a410cb1`, nonce
`172`, with five agreeing validators and successful execution. Core history
recorded `VAULT_BOUND`; the pair is now bidirectionally bound.

The first lifecycle write, `register_principal`, finalized successfully at
nonce `173` in transaction
`0x62ecaa10b2f11914ebfb3819334a4edcbe96954010b64a3cabb9cf24b76df7c7`.
The deployed schema exposes no principal getter and this method does not append
history, so the strongest available proof is the finalized contract-state
snapshot: it contains the sender-address map entry and the true marker for the
declared `principals: TreeMap[Address,bool]` field. The active account is
locked; no credential was requested or inspected.

Agent registration then finalized at nonce `174` in transaction
`0xb34afbd1f7809f892169f892bf3cd7b291c36bbb985bbc28ddd33d35705ce511`.
The finalized state snapshot added the exact agent address and active marker
for the declared agent registry. The deployed source requires no separate
authority registration or delegation before a root Mandate; counterparty
registration is required later by `create_intent`. The prepared fixture is
stored in `artifacts/studionet/qualification-v2/qualification-fixture.json`.
No canonical production deployment is authorized by this evidence.

## qualification-v2 empty-string calldata finding

The first root-Mandate attempt was intentionally preserved rather than
replayed. Transaction
`0xcc4d6551d0f76df05bc8c0eefdef5e1e2a593433ede6979fd208a4220f5f64b0`
(nonce `175`) finalized with consensus `MAJORITY_AGREE`, but every observed
execution receipt was `ERROR` with:

`TypeError: PavelCore.create_mandate() missing 1 required positional argument: 'parent_mandate_id'`.

The submitted semantic calldata contained only the Address argument even
though the intended second argument was the empty UTF-8 string. The pinned
CLI `0.39.2` uses Commander `--args <args...>` parsing; a standalone empty
PowerShell/native argv token was absent before Commander parsed it. This is a
live integration defect, not a Core source defect. The finalized contract
state hash is identical to the preceding agent-registration state, so no
Mandate was created.

The corrected stable-CLI path is:

```powershell
pnpm exec genlayer write --rpc https://studio.genlayer.com/api 0xBb5e144F1b93F5E7b1A5B3fE07ccf677B29b16EA create_mandate --args 0xCb5a845638Cbc1f95D7f8343278685682c3bA13F --args=
```

`--args=` is deliberately a non-empty argv token whose parsed value is the
exact empty string. The local regression `node
scripts/qualification-call-data.mjs` proves two arguments, an Address first
argument, and a string-empty second argument. No contract source hash changed.
The corrected write has not been broadcast by this remediation pass; the
account remains subject to secure interactive signing.

The same audit covered optional empty-string inputs on `define_evidence` and
`define_challenge_evidence`: an empty precommitted hash is valid only with a
zero committed byte length, and an empty recovery authority defaults to the
sealed source authority. Required textual fields and recovery URLs remain
non-empty. The audit is recorded in
`artifacts/studionet/qualification-v2/empty-string-boundary-audit.json`.
