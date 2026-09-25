# Fee policy note

PAVEL V8 targets stable GenLayer Studionet (`chainId` `61999`) and pins the
stable `genlayer-js` `1.1.8` release family. The exact installed package was
inspected from `frontend/node_modules/genlayer-js/package.json` and its
`1.1.8` declaration bundle. It exposes legacy `estimateTransactionGas` and the
wallet/provider transaction path, but does not expose:

- `getCurrentFeePolicy`;
- `estimateTransactionFees`; or
- `estimateTransactionFeesForWrite` / `TransactionFeeOptions`.

Those fee-profile, distribution, and `feeValue` APIs belong to the coherent
v0.6 RC family (`genlayer-js` v2 RC, `genlayer-py` v0.19 RC, GenLayer CLI
v0.40 RC, and Studio-dev `61997`). PAVEL does not mix that family into the
frozen stable Studionet deployment. A future v0.6 migration must move the
network, SDK, CLI, test tooling, and fee-profile stack together.

The stable UI keeps three values separate:

- application value: the exact payable GEN amount encoded as raw smallest
  units in the transaction request;
- protocol/network fee: selected or estimated through the stable client and
  wallet gas path; and
- total wallet requirement: application value plus the separately selected
  protocol/network fee.

The wallet is authoritative for the transaction it signs under this stable
client path. A Vault deposit is application value only; it is never relabeled
as, or added to, a protocol fee.
