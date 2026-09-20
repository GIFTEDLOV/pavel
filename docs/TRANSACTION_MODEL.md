# Transaction model

PAVEL writes follow:

`PRECONDITION READ → NETWORK CHECK → FEE HANDLING → BROADCAST ONCE → RECEIVE TRANSACTION ID → PERSIST ID → TRACK SAME ID → WAIT FINALIZATION → VERIFY EXECUTION SUCCESS → AUTHORITATIVE READBACK`

The frontend uses stable `genlayer-js` `1.1.8`, persists the ID returned by `writeContract`, and reads the same ID with `getTransaction`. In this installed stable SDK, the receipt exposes separate `statusName`, `resultName`, and `txExecutionResultName` fields; PAVEL's local success predicate requires `FINALIZED`, `SUCCESS`, and `FINISHED_WITH_RETURN`. `FINALIZED` and successful execution are separate conditions. Polling failure is `AMBIGUOUS`, not submission failure, and never authorizes a second broadcast.

Phase 1 includes the client abstraction and transaction persistence. Development fee estimation is supported by the SDK surface, but no live fee profile or production submission occurs in this local run. Production UX should use a measured fee profile/Transaction Kit after qualification.

## Empty-string argument transport

The qualification-v2 root-Mandate attempt demonstrated that a standalone empty
PowerShell argument is not a reliable transport for the pinned CLI's variadic
`--args <args...>` option. The corrected command uses the explicit non-empty
token `--args=`; Commander passes its value as `""`. The call-data regression
also covers the documented SDK shape `writeContract({ args: [agent, ""] })`.
This is an integration-layer safeguard, not a contract sentinel: the root
Mandate still receives the actual empty parent ID.
