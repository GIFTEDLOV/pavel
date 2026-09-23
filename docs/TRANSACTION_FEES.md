# Fee policy note

The current official documentation recommends measured fee profiles and SDK fee
estimation. PAVEL's transaction boundary remains prepared for
`estimateTransactionFeesForWrite` and fee-profile integration; fee handling
does not change the protocol rule that a known transaction hash is reconciled
instead of blindly rebroadcast.
