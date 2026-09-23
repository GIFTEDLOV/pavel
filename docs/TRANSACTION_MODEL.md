# Transaction model

PAVEL writes follow:

`PRECONDITION READ → NETWORK CHECK → FEE HANDLING → BROADCAST ONCE → RECEIVE TRANSACTION ID → PERSIST ID → TRACK SAME ID → WAIT FINALIZATION → VERIFY EXECUTION SUCCESS → AUTHORITATIVE READBACK`

The frontend uses stable `genlayer-js` `1.1.8`, persists the ID returned by `writeContract`, and reads the same ID with `getTransaction`. In this installed stable SDK, the receipt exposes separate `statusName`, `resultName`, and `txExecutionResultName` fields; PAVEL's local success predicate requires `FINALIZED`, `SUCCESS`, and `FINISHED_WITH_RETURN`. `FINALIZED` and successful execution are separate conditions. Polling failure is `AMBIGUOUS`, not submission failure, and never authorizes a second broadcast.

The active V7 frontend uses this transaction model for the verified Studionet
application. Fee estimation remains an SDK/tooling concern; a finalized parent
transaction is never treated as proof that an external recipient was credited.

## HISTORICAL — Empty-string argument transport

Qualification-v2 demonstrated two independent pinned-CLI hazards. A
standalone empty PowerShell/native argv token disappeared before invocation in
nonce-175 transaction
`0xcc4d6551d0f76df05bc8c0eefdef5e1e2a593433ede6979fd208a4220f5f64b0`.
The explicit `--args=` token reached Commander but the CLI's `parseScalar("")`
coerced it to numeric zero in nonce-176 transaction
`0x7eb6175aab8a0cfdfc820a7e3a17f4769655e7d170feb3adce1b26b4622dd6f1`.
Both finalized with execution errors and no state mutation. The pinned CLI is
not an acceptable empty-string transport and must not be trial-and-error
replayed.

The safe path is the pinned `genlayer-js` 1.1.8 SDK's
`writeContract({args: [agent, ""]})`, exercised by the one-off helper and its
actual `abi.calldata.encode/decode` round-trip. The helper prints the exact
typed calldata before explicit confirmation, persists the returned hash once,
and never retries. An empty parent ID is a real text value, not a sentinel.
