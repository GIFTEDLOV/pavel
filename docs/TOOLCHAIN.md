# Toolchain

Verified on 2026-09-20, Windows, Node `v24.14.0`, npm `11.9.0`, pnpm `11.0.9`, Python `3.14.3`.

Selected stable Studionet family:

- GenLayer CLI: `0.39.2` (the global machine CLI was `0.40.0-rc.3`; it is not used for this build).
- `genlayer-js`: `1.1.8`.
- `genlayer-py`: `0.18.0`.
- `genlayer-test`: `0.29.2` from the official `genlayer-testing-suite` `v0.29.2` source tag, because the published wheel metadata incorrectly advertises an older `genlayer-py` range; the official tag’s `pyproject.toml` pins `>=0.18.0,<0.19.0`.
- `genvm-linter`: `0.11.0`.
- Pyright: `1.1.414` (used by `genvm-lint typecheck`).
- Direct runner cache: stable GenVM `v0.2.16` bundle; the contract dependency header is the official stable `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` header used by the current stable boilerplate.
- Next.js: `16.3.5`.
- React / React DOM: `19.3.0`.
- TypeScript: `6.0.3` (pinned for the stable ESLint/typescript-eslint compatibility used by this frontend).
- ESLint: `9.39.5`.
- Zod: `4.6.5`.

The stable header and Direct Mode runner are not mixed with Consensus v0.6 RC tooling. Stable hosted Studionet is `https://studio.genlayer.com/api`, chain ID `61999`; `studio-dev`/`61997` is forbidden by the network guard.

## Phase 1.5 cache repair

The corrupted artifact was exactly:

`C:\Users\DELL\.cache\gltest-direct\genvm-universal-v0.2.16.tar.xz`

Only that file was removed with the following narrowly scoped command:

```powershell
.\.venv\Scripts\python.exe -c "from pathlib import Path; p=Path(r'C:\Users\DELL\.cache\gltest-direct\genvm-universal-v0.2.16.tar.xz'); assert p.is_file(); p.unlink(); print('deleted', p); print('exists', p.exists())"
```

The stable `v0.2.16` archive was then redownloaded by Direct Mode and verified
as an XZ tar archive with 25 members. Its SHA-256 is
`4F0B358EC98EC148BE9B95CDFB0F0E1A6CBE64DA0194FDFAC3FFFC6F5D1D93E2` and its
size is 216,630,904 bytes. The extracted contract runner is
`py-genlayer/1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`; its runner
manifest depends on `py-lib-genlayer-std:11rhn002yfajawsz7fai6mykznbxkxs6l91iskj5cm82c92qhy3v`,
`py-lib-cloudpickle:1dlk6mnfabi0z7r39635amyfzw8xb6rm8bv4pmgv6ji1bfx9hghd`, and
`cpython:1bk9g3zgym0rrpd9lk584cxfaa4rg0cz36w6xhzkqdj1m2p4xa9n`. A serial
deterministic smoke test passed before the full suite:

```powershell
$env:GENVM_VERSION='v0.2.16'; .\.venv\Scripts\python.exe -m pytest -q -s tests/direct/test_core_lifecycle.py::test_mandate_seals_and_becomes_immutable
```
