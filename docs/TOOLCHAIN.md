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
