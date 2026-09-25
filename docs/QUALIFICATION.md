# Qualification

Qualification must run Python compile checks, Direct Mode, property/invariant tests, adversarial evidence and semantic tests, `genvm-lint check`, `validate`, `schema`, and strict `typecheck`, frontend tests/typecheck/lint/build, source hash checks, deployment-manifest schema validation, secret scan, and network guard.

Studio/Studionet qualification is a separate explicit stage. It must use stable Studionet chain `61999` and the exact source manifest produced by the final local commit. It must not be inferred from Direct Mode or from an accepted-but-unsuccessful transaction.

## CURRENT ACTIVE QUALIFICATION: V8

| Field | Current verified value |
| --- | --- |
| Network | Studionet (`61999`) |
| Core | `0x1540cEa5d3Df622068B2d3A22aac8Bcb31B900f4` |
| Vault | `0xac43A164AB9e82d7Af387059c04579FE48050fce` |
| Core SHA-256 | `1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60` |
| Vault SHA-256 | `f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c` |
| Authorization | `pavel-authorization-v2`, canonical `AUTHORIZED` |
| Fulfillment | `pavel-fulfillment-v2`, canonical `FULFILLED` |
| Settlement | `RELEASE_PENDING` |
| Accounting | Conserved |
| External settlement | `UNCONFIRMED` |
| Challenge proof | `QUALIFYING` -> `CHALLENGE_BLOCKED` -> `EXPIRED` |
| Fulfillment gate | Sequence-one authenticated before assessment |
| Application | <https://pavel-nine.vercel.app> |
| Repository | <https://github.com/GIFTEDLOV/pavel> |

The V8 hosted lifecycle passed source parity, bidirectional binding,
authorization, reservation, complete fulfillment evidence, deterministic
fulfillment checks, semantic fulfillment, challenge qualification/blocking,
contract-enforced expiry, and Core-directed settlement readback.
`RELEASE_PENDING` is not described as external payment completion. The full
sanitized proof is under `deployments/studionet/qualification-v8/`.

The sections below are the **HISTORICAL QUALIFICATION RECORD** for V1–V6.
They preserve failed transactions, source findings, and migration boundaries;
they are not the active deployment configuration.

### HISTORICAL — Phase 2A live constructor finding

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

### HISTORICAL — Qualification-v2 corrected Core

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

### HISTORICAL — qualification-v2 empty-string calldata finding

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

The apparent correction using the explicit `--args=` token was then tested
live and failed as well. Transaction
`0x7eb6175aab8a0cfdfc820a7e3a17f4769655e7d170feb3adce1b26b4622dd6f1`
(nonce `176`) finalized with `ERROR` and rollback payload
`parent mandate id must be text`. The pinned CLI's actual calldata was
`[Address(qualification-agent), 0]`: its `parseScalar("")` path applies
`Number("")`, producing numeric zero. This second failure also mutated no
state. Both failed transactions remain permanent qualification-v2 evidence.

The pinned CLI 0.39.2 is therefore abandoned for this root-Mandate call; no
further CLI quoting trial is safe. The supported fallback is the pinned
`genlayer-js` 1.1.8 SDK call with `args: [CalldataAddress(agent), ""]`.
The production helper
`scripts/qualification/create-root-mandate.ts` checks Studionet, source
hashes, the zero Mandate count, and the signer address, prints the typed
calldata, asks for explicit confirmation, decrypts the existing encrypted
keystore only in memory, submits once, and persists the returned hash without
polling or retrying. Its offline proof uses the SDK's actual
`abi.calldata.encode/decode` implementation and round-trips an exact empty
UTF-8 string.

The deployed contract source hash remains unchanged for the historical
qualification. The local compatibility fix is tracked separately below; the
next network write is blocked until that fix is explicitly deployed.

### HISTORICAL — qualification-v2 root transaction reconciliation

The autonomous runner submitted the pinned SDK root call exactly once as
transaction
`0x18259af48075b6a1a308b3407dd84fce2d3f871ca16e4930d4c4ef50259df962`.
Studionet reports `status=FINALIZED` and consensus `MAJORITY_AGREE`; those are
consensus fields, not execution success. The full leader receipt reports
`rollback` with `malformed transaction timezone`, and finalized Core readback
still reports `get_mandate_count() == 0`, `get_mandate("M-1") == ""`, and no
history entry. The nonce reconciliation is `latest=0xb2`, `pending=0xb2`.
The transaction is preserved as an execution error and was not rebroadcast.

The deployed Core/Vault timestamp parser accepted `Z` and `+HH:MM` but not the
backend-supplied ISO-8601 timezone form. The raw timestamp is not exposed in
the receipt; the rollback payload is the exact observable error. The local fix accepts
`+HHMM`, `+HH:MM`, and `+HH:MM:SS` with bounded offsets in both contracts, with
Direct Mode regression coverage. Because the deployed bytecode still has the
old source hash, the qualification-v2 deployment is historical until the
fixed source is explicitly deployed and source-verified. No redeployment was
performed automatically. The local fixed-source hashes are Core
`eede6b06cc3c52b9aaa02b56acf4f3ca52475b749b9039fde2fadfd069fbaf7f` and
Vault `02c1bc58273736b463518ac2859edbe9fc5af732efcce8c8d9dad4b9582edc8c`;
the deployed manifest intentionally retains the old deployed hashes.

The same audit covered optional empty-string inputs on `define_evidence` and
`define_challenge_evidence`: an empty precommitted hash is valid only with a
zero committed byte length, and an empty recovery authority defaults to the
sealed source authority. Required textual fields and recovery URLs remain
non-empty. The audit is recorded in
`artifacts/studionet/qualification-v2/empty-string-boundary-audit.json`.

### HISTORICAL — qualification-v2 address-bound keystore resolution and runner

The local GenLayer configuration currently marks `agentpact-requester` on
`studio-dev` as active. That profile is not the qualification signer. The
encrypted profile `meritround-v2-studionet` has metadata address
`0xcb5a845638cbc1f95d7f8343278685682c3ba13f`, so the qualification tooling now
selects encrypted keystores by normalized metadata address rather than by the
active profile. It never reads or prints credential material during metadata
selection.

`scripts/qualification/run-v2.ts` performs one read-only preflight and then,
after one explicit plan confirmation, loads the selected encrypted keystore in
memory and executes the remaining qualification lifecycle sequentially. Every
write uses the pinned `genlayer-js` typed-argument path, persists its hash
before polling, reconciles the same hash to `FINALIZED`, separates consensus
from execution, falls back to an exact finalized-state transition when
execution metadata is unavailable, and performs an authoritative readback.
The `--resume` path refuses to rebroadcast a recorded root transaction and
starts only after finalized `M-1` state is present. The current preflight
artifact records zero Mandates, zero Intents, zero Counterparty `C-1`, and
conserved zero Vault accounting; secure password entry is not requested while
the deployed source mismatch remains unresolved.
