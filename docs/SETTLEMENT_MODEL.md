# Settlement model

Vault reservation and settlement are separate deterministic transitions. A reservation moves `available → reserved`. A release request moves `reserved → release_pending`; a refund request moves `reserved → refund_pending`.

An EOA transfer uses the documented `@gl.evm.contract_interface` value-transfer mechanism. External messages cross from GenVM through the Ghost to the GenLayer Chain and always execute on finalization. Value is deducted into the message before eventual recipient credit. A parent Intelligent Contract transaction becoming finalized is not proof that an EOA recipient has been observed credited.

Every settlement is namespaced by `SETTLE:V1:<hash(intent_id,direction)>`, stored before emission, and rejected if the Intent already has a settlement ID. Blind retries are forbidden. Phase 1 exposes `UNCONFIRMED` pending state and does not pretend to prove child transfer completion or automatically recover a failed child transfer.
