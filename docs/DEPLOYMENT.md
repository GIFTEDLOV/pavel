# Deployment

No deployment is authorized or attempted in Phase 1.

The intended order after qualification is:

1. deploy `PavelCore`;
2. deploy `PavelVault(core_address)`;
3. call `Vault.bind_core()` from the recorded binding admin;
4. call `Core.set_vault_address(vault_address)` from the Core owner;
5. read both addresses back and verify chain/RPC/source manifest;
6. only then fund a Mandate and run a controlled qualification flow.

No canonical address, transaction hash, or live proof is stored in this repository.
