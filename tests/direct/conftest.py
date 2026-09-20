import json
import hashlib
import sys


# genlayer-test v0.29.2 leaves the Direct Mode stdin handle open until VM
# teardown. Windows cannot unlink that open temporary file; preserve the
# harness behavior while allowing the contract deployment to continue.
try:
    import gltest.direct.loader as _direct_loader

    _original_inject_message = _direct_loader._inject_message_to_fd0

    def _windows_safe_inject_message(vm):
        try:
            _original_inject_message(vm)
        except PermissionError:
            pass

    _direct_loader._inject_message_to_fd0 = _windows_safe_inject_message
except ImportError:
    pass

# genlayer-test v0.29.2 refreshes sender/origin on vm.warp() but leaves the
# cached message datetime unchanged for same-process calls. PAVEL's contracts
# intentionally use gl.message_raw["datetime"], so keep the Direct Mode
# cheatcode faithful to the documented dynamic warp behavior.
try:
    from gltest.direct.vm import VMContext as _VMContext

    _original_warp = _VMContext.warp

    def _pavel_warp(vm, timestamp):
        _original_warp(vm, timestamp)
        gl_module = sys.modules.get("genlayer.gl")
        if gl_module is not None and getattr(gl_module, "message_raw", None) is not None:
            gl_module.message_raw["datetime"] = timestamp

    _VMContext.warp = _pavel_warp
except ImportError:
    pass


BASE_TIME = "2030-01-01T00:00:00Z"
VALID_FROM = 1893456000
EXPIRES_AT = 1924992000


def address_text(address):
    return address.as_hex if hasattr(address, "as_hex") else "0x" + address.hex()


def configure_and_seal_core(core, direct_vm, owner, agent, *, parent=""):
    direct_vm.sender = owner
    core.register_principal()
    core.register_agent(address_text(agent), "operations-agent")
    mandate_id = core.create_mandate(address_text(agent), parent)
    core.configure_mandate(
        mandate_id,
        "Atlas infrastructure authority",
        "Acquire Linux GPU infrastructure for Project Atlas",
        "Do not externalize authority; preserve the principal's constitution.",
        "Linux GPU infrastructure and directly necessary provider services",
        "Advertising, trading, unrelated software, consumer purchases, personal services",
        8 * 10**18,
        25 * 10**18,
        30 * 24 * 60 * 60,
        100 * 10**18,
        VALID_FROM,
        EXPIRES_AT,
        3600,
        "Provider identity, quote, and fulfillment proof required.",
        "evidence.example,mirror.example,challenge.example",
        "Exact provider, deliverable, quantity, and material service terms must be evidenced.",
        "Refund only to the frozen principal on non-fulfillment.",
        False,
    )
    core.register_counterparty(address_text(owner), "Atlas Provider", "https://evidence.example")
    core.seal_mandate(mandate_id)
    return mandate_id


def create_submitted_intent(core, direct_vm, owner, agent, mandate_id, *, recipient=None, amount=3 * 10**18):
    direct_vm.sender = agent
    recipient = recipient or owner
    intent_id = core.create_intent(
        mandate_id,
        "C-1",
        address_text(recipient),
        amount,
        "GPU provider quote",
        "Purchase Linux GPU infrastructure for Project Atlas",
        "One month of ML-suitable Linux GPU infrastructure",
        "Provider quote, amount, and service period",
        "Provisioned instance with the quoted GPU capacity and Linux image",
        EXPIRES_AT - 3600,
    )
    core.submit_intent(intent_id)
    return intent_id


def add_evidence(core, direct_vm, agent, intent_id, kind="QUOTE", url="https://evidence.example/quote", body="Provider: Atlas GPU\nAmount: 3 GEN", authority="evidence.example", recovery_authority="mirror.example"):
    direct_vm.sender = agent
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    return core.define_evidence(intent_id, kind, url, authority, digest, len(body.encode("utf-8")), recovery_authority, 0)


def seed_fulfilled_intent(core, intent_id, challenge_deadline=1893459600):
    """Seed only the prior finalized fulfillment boundary for challenge tests.

    The Direct Mode harness does not provide a production Core/Vault message
    router. All challenge actions themselves still execute through public
    contract methods; this fixture represents the already-authorized,
    already-fulfilled state that precedes a public challenge.
    """
    item = json.loads(core.get_intent(intent_id))
    item["status"] = "FULFILLED"
    item["fulfillment"] = json.dumps({"schema": "pavel-fulfillment-v1", "vector": {"outcome": "FULFILLED"}, "snapshot_id": item["current_snapshot_id"]}, sort_keys=True, separators=(",", ":"))
    item["settlement_direction"] = "RELEASE_TO_COUNTERPARTY"
    item["settlement_ready_at"] = str(challenge_deadline)
    item["challenge_deadline"] = str(challenge_deadline)
    core.intents[intent_id] = json.dumps(item, sort_keys=True, separators=(",", ":"))
