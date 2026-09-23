# Fee policy note

PAVEL uses the pinned stable `genlayer-js` `1.1.8` client on Studionet. The
installed client exposes `writeContract`, `estimateTransactionGas`, and the
wallet/provider path used by `eth_sendTransaction`; it does not expose a
separate fee-distribution or `estimateTransactionFeesForWrite` helper.

For that reason the UI keeps three values separate:

- application value: the exact payable GEN amount encoded as raw smallest
  units in the transaction request;
- protocol/network fee: selected or estimated by the stable client and wallet
  from gas estimation and gas price capabilities; and
- total wallet requirement: application value plus the separately selected
  protocol/network fee.

The Vault deposit amount is application value. It is never relabeled as, or
added to, a protocol fee. A wallet review remains authoritative for the fee
requirement, and PAVEL does not upgrade to an RC SDK to obtain a newer fee API.
