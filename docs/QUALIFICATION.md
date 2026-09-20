# Qualification

Qualification must run Python compile checks, Direct Mode, property/invariant tests, adversarial evidence and semantic tests, `genvm-lint check`, `validate`, `schema`, and strict `typecheck`, frontend tests/typecheck/lint/build, source hash checks, deployment-manifest schema validation, secret scan, and network guard.

Studio/Studionet qualification is a separate explicit stage. It must use stable Studionet chain `61999` and the exact source manifest produced by the final local commit. It must not be inferred from Direct Mode or from an accepted-but-unsuccessful transaction.
