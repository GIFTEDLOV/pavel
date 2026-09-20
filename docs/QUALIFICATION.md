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
