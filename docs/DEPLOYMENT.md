# Deployment

The V7 chain qualification deployment is source-verified and is the current
runtime configuration target. Public frontend hosting is tracked separately
because this repository has no configured Git remote or identifiable PAVEL
hosting project.

## V6 migration boundary

V6 changes Core's consensus schema to `pavel-authorization-v2`; it therefore
requires a new Core deployment. Vault's `core_address` is constructor-set and
`bind_core()` is one-shot, while Core's `set_vault_address()` is also one-shot.
The existing V5 Vault cannot be safely rebound to V6, and the repository has no
deposit-transfer or Core-state import method. A V6 qualification therefore
requires a new Vault, fresh Core-side principal/agent/counterparty and Mandate
records, and a new deposit. V5 addresses, state, and evidence remain preserved
for audit; no migration is attempted in the local redesign pass.

The intended order after qualification is:

1. deploy `PavelCore`;
2. deploy `PavelVault(core_address)`;
3. call `Vault.bind_core()` from the recorded binding admin;
4. call `Core.set_vault_address(vault_address)` from the Core owner;
5. read both addresses back and verify chain/RPC/source manifest;
6. only then fund a Mandate and run a controlled qualification flow.

The corrected qualification-v2 Core is already finalized and source-verified
at `0xBb5e144F1b93F5E7b1A5B3fE07ccf677B29b16EA`. The corrected Vault command is
kept in the manual-signing continuation packet; it must receive the same Core
address through the stable CLI address-calldata path. The Vault account is
locked, so no deployment command is executed by automation without a secure
existing signing session.

## V7 live qualification

The current source-verified V7 qualification pair is on stable Studionet
(chain 61999):

- Core: `0xBA2356FfE5062506FA938da4715c03a2BE7929bF`
- Vault: `0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD`
- Core SHA-256: `4acc04c4b684b35058b793973eec75569af9e981eb84d33167198615255b785a`
- Vault SHA-256: `f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c`

The fresh V7 lifecycle was reconciled through canonical authorization,
reservation, full-content fulfillment, and `RELEASE_PENDING`. The Vault
settlement record correctly remains `UNCONFIRMED` until an external
observation exists. V5/V6 reservations remain historical and are not counted
or migrated into V7.

The repository has no configured Git remote or identifiable PAVEL production
hosting project, so no public repository or hosted frontend URL is claimed.

## V6 fulfillment loss boundary

The preserved V6 qualification records I-2 and I-3 as `AUTHORIZED` with a
canonical `RESERVED` one-unit reservation each, followed by unresolved
fulfillment assessment. The combined V6 qualification exposure is therefore 2
GEN reserved test funds. V7 does not count, migrate, or attempt to recover
those reservations; recovery is a V7 contract capability to be used only by a
fresh Core/Vault pair after a separate deployment approval.
