# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""PAVEL Vault: the sole authoritative GEN accounting contract.

All economic parameters are read from frozen Core state through synchronous
views.  Vault never trusts frontend-supplied principal, recipient, or amount.
Outbound EOA transfers are emitted as finalized external messages and remain
explicitly pending until an external observation exists.
"""

from genlayer import *
import hashlib
import json


ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
MAX_HISTORY = 4096
MAX_RESERVATIONS = 4096


@gl.contract_interface
class CoreInterface:
    class View:
        def get_mandate(self, mandate_id: str) -> str: ...
        def get_authorization_for_vault(self, intent_id: str) -> str: ...
        def get_settlement_instruction(self, intent_id: str) -> str: ...


@gl.evm.contract_interface
class Recipient:
    class View:
        pass
    class Write:
        pass


class PavelVault(gl.Contract):
    owner: Address
    binding_admin: Address
    core_address: Address
    core_bound: bool
    total_deposited: u256
    total_available: u256
    total_reserved: u256
    total_release_pending: u256
    total_refund_pending: u256
    total_recovered: u256
    deposited_by_mandate: TreeMap[str, u256]
    available_by_mandate: TreeMap[str, u256]
    reserved_by_mandate: TreeMap[str, u256]
    release_pending_by_mandate: TreeMap[str, u256]
    refund_pending_by_mandate: TreeMap[str, u256]
    recovered_by_mandate: TreeMap[str, u256]
    committed_by_mandate: TreeMap[str, u256]
    epoch_start_by_mandate: TreeMap[str, u256]
    epoch_spent_by_mandate: TreeMap[str, u256]
    reservations: TreeMap[str, str]
    reservation_ids: DynArray[str]
    settlements: TreeMap[str, str]
    settlement_by_intent: TreeMap[str, str]
    history: DynArray[str]

    def __init__(self, core_address: Address):
        self.owner = gl.message.sender_address
        self.binding_admin = gl.message.sender_address
        # Stable Studionet decodes address constructor calldata before invoking
        # the contract. Preserve an existing Address instead of attempting
        # Address(Address(...)); the latter is a live deployment failure.
        core = core_address if isinstance(core_address, Address) else Address(core_address)
        if core.as_hex.lower() == ZERO_ADDRESS:
            raise gl.vm.UserError("Core address cannot be zero")
        self.core_address = core
        self.core_bound = False
        self.total_deposited = u256(0)
        self.total_available = u256(0)
        self.total_reserved = u256(0)
        self.total_release_pending = u256(0)
        self.total_refund_pending = u256(0)
        self.total_recovered = u256(0)

    def _require(self, condition, message: str) -> None:
        if not condition:
            raise gl.vm.UserError(message)

    def _addr_text(self, address: Address) -> str:
        return address.as_hex.lower()

    def _address(self, value) -> Address:
        # Public address parameters and decoded stored values can be either the
        # runtime Address object or a bounded hexadecimal string from JSON.
        address = value if isinstance(value, Address) else Address(value)
        self._require(address.as_hex.lower() != ZERO_ADDRESS, "zero address is not permitted")
        return address

    def _record(self, table, key: str):
        self._require(key in table, "record does not exist")
        return json.loads(table[key])

    def _put(self, table, key: str, value) -> None:
        table[key] = json.dumps(value, sort_keys=True, separators=(",", ":"))

    def _timestamp(self) -> str:
        raw = gl.message_raw.get("datetime", "")
        self._require(isinstance(raw, str) and len(raw) >= 20, "transaction datetime is unavailable")
        return raw

    def _timestamp_seconds(self, raw: str) -> u256:
        self._require(isinstance(raw, str) and len(raw) >= 20, "malformed transaction datetime")
        self._require(raw[4] == "-" and raw[7] == "-" and raw[10] == "T", "malformed transaction datetime")
        year = u256(int(raw[0:4]))
        month = u256(int(raw[5:7]))
        day = u256(int(raw[8:10]))
        hour = u256(int(raw[11:13]))
        minute = u256(int(raw[14:16]))
        second = u256(int(raw[17:19]))
        self._require(month >= 1 and month <= 12 and day >= 1 and day <= 31, "invalid transaction date")
        self._require(hour < 24 and minute < 60 and second < 60, "invalid transaction time")
        days = u256(0)
        y = u256(1970)
        while y < year:
            leap = (y % 4 == 0 and y % 100 != 0) or (y % 400 == 0)
            days = days + (u256(366) if leap else u256(365))
            y = y + u256(1)
        month_days = (u256(31), u256(28), u256(31), u256(30), u256(31), u256(30), u256(31), u256(31), u256(30), u256(31), u256(30), u256(31))
        i = u256(1)
        while i < month:
            days = days + month_days[i - 1]
            i = i + u256(1)
        if month > 2 and ((year % 4 == 0 and year % 100 != 0) or year % 400 == 0):
            days = days + u256(1)
        days = days + day - u256(1)
        zone = raw[19:]
        offset = 0
        if zone == "Z" or zone == "":
            offset = 0
        else:
            self._require(zone[0] == "+" or zone[0] == "-", "malformed transaction timezone")
            self._require(len(zone) == 6 and zone[3] == ":", "malformed transaction timezone")
            for char in (zone[1], zone[2], zone[4], zone[5]):
                self._require(char in "0123456789", "malformed transaction timezone")
            offset = int(zone[1:3]) * 3600 + int(zone[4:6]) * 60
            self._require(int(zone[1:3]) < 24 and int(zone[4:6]) < 60, "malformed transaction timezone")
            if zone[0] == "-":
                offset = -offset
        base = days * u256(86400) + hour * u256(3600) + minute * u256(60) + second
        return base - u256(offset) if offset >= 0 else base + u256(-offset)

    def _now(self):
        raw = self._timestamp()
        return {"iso": raw, "seconds": self._timestamp_seconds(raw)}

    def _core(self):
        self._require(self.core_bound, "Core binding is not finalized")
        return CoreInterface(self.core_address)

    def _hash(self, value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def _history(self, event: str, object_id: str, fingerprint: str) -> None:
        self._require(len(self.history) < MAX_HISTORY, "Vault history capacity reached")
        self.history.append(json.dumps({"event": event, "id": object_id, "fingerprint": fingerprint}, sort_keys=True, separators=(",", ":")))

    def _ensure_mandate_account(self, mandate_id: str, now: u256) -> None:
        if mandate_id not in self.deposited_by_mandate:
            self.deposited_by_mandate[mandate_id] = u256(0)
            self.available_by_mandate[mandate_id] = u256(0)
            self.reserved_by_mandate[mandate_id] = u256(0)
            self.release_pending_by_mandate[mandate_id] = u256(0)
            self.refund_pending_by_mandate[mandate_id] = u256(0)
            self.recovered_by_mandate[mandate_id] = u256(0)
            self.committed_by_mandate[mandate_id] = u256(0)
            self.epoch_start_by_mandate[mandate_id] = now
            self.epoch_spent_by_mandate[mandate_id] = u256(0)

    def _accounting_conserved(self, mandate_id: str) -> bool:
        return self.available_by_mandate.get(mandate_id, u256(0)) + self.reserved_by_mandate.get(mandate_id, u256(0)) + self.release_pending_by_mandate.get(mandate_id, u256(0)) + self.refund_pending_by_mandate.get(mandate_id, u256(0)) + self.recovered_by_mandate.get(mandate_id, u256(0)) == self.deposited_by_mandate.get(mandate_id, u256(0))

    # ---------- binding and deposits ----------

    @gl.public.write
    def bind_core(self) -> None:
        self._require(gl.message.sender_address == self.binding_admin, "only the deployment binding admin may bind Core")
        self._require(not self.core_bound, "Core binding is immutable")
        self._require(self._addr_text(self.core_address) != ZERO_ADDRESS, "Core address is invalid")
        self.core_bound = True
        self._history("CORE_BOUND", self._addr_text(self.core_address), self._hash("PAVEL:BINDING:V1:" + self._addr_text(self.core_address)))

    @gl.public.write.payable
    def deposit(self, mandate_id: str) -> None:
        self._require(self.core_bound, "Core must be bound before deposits")
        value = gl.message.value
        self._require(value > u256(0), "deposit must be positive")
        mandate_text = self._core().view().get_mandate(mandate_id)
        self._require(mandate_text != "", "mandate does not exist")
        mandate = json.loads(mandate_text)
        caller = self._addr_text(gl.message.sender_address)
        self._require(mandate["principal"] == caller, "only the mandate principal may deposit")
        self._require(mandate["status"] in ("DRAFT", "SEALED"), "mandate cannot receive new funds")
        now = self._now()
        self._ensure_mandate_account(mandate_id, now["seconds"])
        self.deposited_by_mandate[mandate_id] = self.deposited_by_mandate[mandate_id] + value
        self.available_by_mandate[mandate_id] = self.available_by_mandate[mandate_id] + value
        self.total_deposited = self.total_deposited + value
        self.total_available = self.total_available + value
        self._require(self._accounting_conserved(mandate_id), "deposit would violate conservation")
        self._history("DEPOSIT", mandate_id, self._hash("PAVEL:DEPOSIT:V1:" + mandate_id + ":" + str(value) + ":" + now["iso"]))

    # ---------- deterministic reservation ----------

    @gl.public.write
    def reserve(self, intent_id: str) -> None:
        auth = json.loads(self._core().view().get_authorization_for_vault(intent_id))
        caller = self._addr_text(gl.message.sender_address)
        self._require(auth["status"] == "AUTHORIZED" and auth["authorization_decision"] == "AUTHORIZED", "Core authorization is not active")
        self._require(caller in (auth["agent"], auth["principal"]), "caller is not permitted to reserve this Intent")
        self._require(intent_id not in self.reservations, "Intent has already been reserved")
        self._require(auth["mandate_status"] == "SEALED" or (auth["mandate_status"] == "REVOKED" and auth["allow_prior_reservations"]), "mandate is not reservable")
        now = self._now()
        self._require(now["seconds"] < u256(int(auth["intent_expires_at"])) and now["seconds"] < u256(int(auth["mandate_expires_at"])), "authorization is expired")
        amount = u256(int(auth["amount"]))
        self._require(amount > u256(0) and amount <= u256(int(auth["maximum_single_transaction"])), "authorized amount violates deterministic cap")
        self._ensure_mandate_account(auth["mandate_id"], now["seconds"])
        mandate_id = auth["mandate_id"]
        self._require(self.available_by_mandate[mandate_id] >= amount, "insufficient available balance")
        epoch_start = self.epoch_start_by_mandate[mandate_id]
        epoch_spent = self.epoch_spent_by_mandate[mandate_id]
        epoch_duration = u256(int(auth["epoch_duration_seconds"]))
        if now["seconds"] >= epoch_start + epoch_duration:
            epoch_start = now["seconds"]
            epoch_spent = u256(0)
        self._require(self.committed_by_mandate[mandate_id] + amount <= u256(int(auth["total_budget"])), "reservation exceeds total mandate budget")
        self._require(epoch_spent + amount <= u256(int(auth["epoch_budget"])), "reservation exceeds epoch budget")
        self._require(len(self.reservation_ids) < MAX_RESERVATIONS, "reservation capacity reached")
        reservation = {
            "intent_id": intent_id,
            "mandate_id": mandate_id,
            "principal": auth["principal"],
            "agent": auth["agent"],
            "counterparty": auth["counterparty"],
            "recipient": auth["recipient"],
            "amount": auth["amount"],
            "intent_fingerprint": auth["intent_fingerprint"],
            "status": "RESERVED",
            "reserved_at": now["iso"],
            "settlement_id": "",
        }
        self._put(self.reservations, intent_id, reservation)
        self.reservation_ids.append(intent_id)
        self.settlement_by_intent[intent_id] = ""
        self.epoch_start_by_mandate[mandate_id] = epoch_start
        self.available_by_mandate[mandate_id] = self.available_by_mandate[mandate_id] - amount
        self.reserved_by_mandate[mandate_id] = self.reserved_by_mandate[mandate_id] + amount
        self.committed_by_mandate[mandate_id] = self.committed_by_mandate[mandate_id] + amount
        self.epoch_spent_by_mandate[mandate_id] = epoch_spent + amount
        self.total_available = self.total_available - amount
        self.total_reserved = self.total_reserved + amount
        self._require(self._accounting_conserved(mandate_id), "reservation would violate conservation")
        self._history("RESERVATION_CREATED", intent_id, auth["intent_fingerprint"])

    def _settlement_id(self, intent_id: str, direction: str) -> str:
        return "SETTLE:V1:" + self._hash(intent_id + ":" + direction)

    def _settle(self, intent_id: str, direction: str) -> None:
        instruction = json.loads(self._core().view().get_settlement_instruction(intent_id))
        self._require(instruction["direction"] == direction, "Core settlement direction does not authorize this operation")
        now = self._now()
        self._require(now["seconds"] >= u256(int(instruction["ready_at"])), "challenge window or settlement delay is still open")
        self._require(intent_id in self.reservations, "reservation does not exist")
        reservation = self._record(self.reservations, intent_id)
        self._require(reservation["status"] == "RESERVED", "reservation is already pending or settled")
        self._require(self.settlement_by_intent.get(intent_id, "") == "", "settlement replay detected")
        amount = u256(int(reservation["amount"]))
        mandate_id = reservation["mandate_id"]
        recipient = reservation["recipient"] if direction == "RELEASE_TO_COUNTERPARTY" else reservation["principal"]
        settlement_id = self._settlement_id(intent_id, direction)
        self._require(settlement_id not in self.settlements, "settlement identity already exists")
        settlement = {
            "settlement_id": settlement_id,
            "intent_id": intent_id,
            "mandate_id": mandate_id,
            "direction": direction,
            "recipient": recipient,
            "amount": reservation["amount"],
            "status": "RELEASE_PENDING" if direction == "RELEASE_TO_COUNTERPARTY" else "REFUND_PENDING",
            "requested_at": now["iso"],
            "external_observation": "UNCONFIRMED",
            "replay_key": settlement_id,
        }
        # The accounting transition is persisted before the external message.
        reservation["status"] = settlement["status"]
        reservation["settlement_id"] = settlement_id
        self._put(self.reservations, intent_id, reservation)
        self._put(self.settlements, settlement_id, settlement)
        self.settlement_by_intent[intent_id] = settlement_id
        self.reserved_by_mandate[mandate_id] = self.reserved_by_mandate[mandate_id] - amount
        self.total_reserved = self.total_reserved - amount
        if direction == "RELEASE_TO_COUNTERPARTY":
            self.release_pending_by_mandate[mandate_id] = self.release_pending_by_mandate[mandate_id] + amount
            self.total_release_pending = self.total_release_pending + amount
        else:
            self.refund_pending_by_mandate[mandate_id] = self.refund_pending_by_mandate[mandate_id] + amount
            self.total_refund_pending = self.total_refund_pending + amount
        self._require(self._accounting_conserved(mandate_id), "settlement request would violate conservation")
        self._history("SETTLEMENT_REQUESTED", settlement_id, self._hash(json.dumps(settlement, sort_keys=True, separators=(",", ":"))))
        Recipient(self._address(recipient)).emit_transfer(value=amount)

    @gl.public.write
    def request_release(self, intent_id: str) -> None:
        self._settle(intent_id, "RELEASE_TO_COUNTERPARTY")

    @gl.public.write
    def request_refund(self, intent_id: str) -> None:
        self._settle(intent_id, "REFUND_TO_PRINCIPAL")

    # ---------- authoritative views ----------

    @gl.public.view
    def get_core_address(self) -> str:
        return self._addr_text(self.core_address)

    @gl.public.view
    def get_reservation(self, intent_id: str) -> str:
        return self.reservations.get(intent_id, "")

    @gl.public.view
    def get_settlement(self, settlement_id: str) -> str:
        return self.settlements.get(settlement_id, "")

    @gl.public.view
    def get_accounting(self, mandate_id: str) -> str:
        deposited = self.deposited_by_mandate.get(mandate_id, u256(0))
        available = self.available_by_mandate.get(mandate_id, u256(0))
        reserved = self.reserved_by_mandate.get(mandate_id, u256(0))
        release_pending = self.release_pending_by_mandate.get(mandate_id, u256(0))
        refund_pending = self.refund_pending_by_mandate.get(mandate_id, u256(0))
        recovered = self.recovered_by_mandate.get(mandate_id, u256(0))
        return json.dumps({"mandate_id": mandate_id, "deposited": str(deposited), "available": str(available), "reserved": str(reserved), "release_pending": str(release_pending), "refund_pending": str(refund_pending), "recovered": str(recovered), "committed": str(self.committed_by_mandate.get(mandate_id, u256(0))), "epoch_start": str(self.epoch_start_by_mandate.get(mandate_id, u256(0))), "epoch_spent": str(self.epoch_spent_by_mandate.get(mandate_id, u256(0))), "conserved": self._accounting_conserved(mandate_id)}, sort_keys=True, separators=(",", ":"))

    @gl.public.view
    def get_global_accounting(self) -> str:
        return json.dumps({"deposited": str(self.total_deposited), "available": str(self.total_available), "reserved": str(self.total_reserved), "release_pending": str(self.total_release_pending), "refund_pending": str(self.total_refund_pending), "recovered": str(self.total_recovered), "conserved": self.total_available + self.total_reserved + self.total_release_pending + self.total_refund_pending + self.total_recovered == self.total_deposited}, sort_keys=True, separators=(",", ":"))

    @gl.public.view
    def get_history_length(self) -> u256:
        return u256(len(self.history))

    @gl.public.view
    def get_history_item(self, index: u256) -> str:
        self._require(index < u256(len(self.history)), "history index out of bounds")
        return self.history[index]
