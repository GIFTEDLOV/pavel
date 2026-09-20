# Deployment

No canonical production deployment is authorized or attempted. Qualification
deployments live in versioned artifact directories and are not promoted to
runtime configuration.

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

No canonical address, transaction hash, or live proof is stored in this repository.
