from dataclasses import dataclass, field
import random

import pytest


@dataclass
class VaultModel:
    deposited: int = 0
    available: int = 0
    reserved: int = 0
    release_pending: int = 0
    refund_pending: int = 0
    recovered: int = 0
    committed: int = 0
    epoch_spent: int = 0
    epoch_start: int = 0
    epoch_duration: int = 10
    epoch_budget: int = 25
    total_budget: int = 100
    max_transaction: int = 40
    revoked: bool = False
    qualifying_challenge: bool = False
    reservations: dict = field(default_factory=dict)

    def conserved(self):
        return self.available + self.reserved + self.release_pending + self.refund_pending + self.recovered == self.deposited

    def deposit(self, amount: int):
        if amount <= 0 or self.revoked:
            return False
        self.deposited += amount
        self.available += amount
        return True

    def reserve(self, intent: str, amount: int, now: int):
        epoch_start = self.epoch_start
        epoch_spent = self.epoch_spent
        if now >= epoch_start + self.epoch_duration:
            epoch_start = now
            epoch_spent = 0
        if (self.revoked or intent in self.reservations or amount <= 0 or amount > self.max_transaction
                or amount > self.available or self.committed + amount > self.total_budget
                or epoch_spent + amount > self.epoch_budget):
            return False
        self.reservations[intent] = {"amount": amount, "status": "RESERVED"}
        self.epoch_start = epoch_start
        self.available -= amount
        self.reserved += amount
        self.committed += amount
        self.epoch_spent = epoch_spent + amount
        return True

    def settle(self, intent: str, direction: str):
        if self.qualifying_challenge or intent not in self.reservations:
            return False
        reservation = self.reservations[intent]
        if reservation["status"] != "RESERVED":
            return False
        amount = reservation["amount"]
        reservation["status"] = direction
        self.reserved -= amount
        if direction == "RELEASE_PENDING":
            self.release_pending += amount
        else:
            self.refund_pending += amount
        return True


def _assert_invariants(model: VaultModel):
    assert model.conserved()
    assert model.available >= 0
    assert model.reserved >= 0
    assert model.release_pending >= 0
    assert model.refund_pending >= 0
    assert model.recovered >= 0
    assert model.committed >= 0


@pytest.mark.parametrize("seed", list(range(10)))
@pytest.mark.property
def test_generated_vault_sequences_conserve_accounting_after_every_operation(seed):
    rng = random.Random(seed)
    model = VaultModel()
    now = 0
    intents = [f"I-{index}" for index in range(5)]
    for _ in range(80):
        action = rng.choice(["deposit", "reserve", "failed_reserve", "epoch", "release", "refund", "challenge", "revoke"])
        if action == "deposit":
            model.deposit(rng.choice([1, 2, 5, 10, 25]))
        elif action == "reserve":
            model.reserve(rng.choice(intents), rng.choice([1, 5, 10, 20, 40]), now)
        elif action == "failed_reserve":
            before = (model.deposited, model.available, model.reserved, model.committed, model.epoch_spent)
            model.reserve(rng.choice(intents), rng.choice([0, 41, 101, 1000]), now)
            assert before == (model.deposited, model.available, model.reserved, model.committed, model.epoch_spent)
        elif action == "epoch":
            now += rng.choice([0, 9, 10, 11])
        elif action == "release":
            model.settle(rng.choice(intents), "RELEASE_PENDING")
        elif action == "refund":
            model.settle(rng.choice(intents), "REFUND_PENDING")
        elif action == "challenge":
            model.qualifying_challenge = rng.choice([True, False])
        else:
            model.revoked = True
        _assert_invariants(model)


@pytest.mark.parametrize("amount", [0, 1, 40, 41, 100, 101])
@pytest.mark.property
def test_budget_boundaries_are_deterministic(amount):
    model = VaultModel(epoch_budget=100)
    model.deposit(200)
    accepted = model.reserve("I-boundary", amount, 0)
    assert accepted is (amount in (1, 40))
    _assert_invariants(model)


@pytest.mark.parametrize("now", [-1, 0, 9, 10, 11, 99, 100, 101])
@pytest.mark.property
def test_epoch_and_expiration_boundaries_do_not_break_invariants(now):
    model = VaultModel(epoch_duration=10, epoch_budget=10, total_budget=20)
    model.deposit(30)
    model.reserve("I-epoch", 10, max(now, 0))
    _assert_invariants(model)
