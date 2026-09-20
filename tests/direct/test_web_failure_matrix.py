import json

import pytest

from .conftest import BASE_TIME, add_evidence, configure_and_seal_core, create_submitted_intent


@pytest.mark.parametrize(
    ("label", "status", "body", "expected"),
    [
        ("unauthorized", 401, "unauthorized", "EVIDENCE_REPAIR_REQUIRED"),
        ("forbidden", 403, "forbidden", "EVIDENCE_REPAIR_REQUIRED"),
        ("gone", 410, "gone", "EVIDENCE_REPAIR_REQUIRED"),
        ("timeout", 408, "timeout", "EVIDENCE_RETRY_REQUIRED"),
        ("rate_limited", 429, "rate limited", "EVIDENCE_RETRY_REQUIRED"),
        ("server_error", 500, "server error", "EVIDENCE_RETRY_REQUIRED"),
        ("empty", 200, "", "EVIDENCE_REPAIR_REQUIRED"),
        ("oversized", 200, "x" * 9000, "EVIDENCE_REPAIR_REQUIRED"),
        ("unexpected_content", 200, "different content", "EVIDENCE_REPAIR_REQUIRED"),
        ("invalid_utf8", 200, b"\xff\xfe", "EVIDENCE_REPAIR_REQUIRED"),
    ],
)
@pytest.mark.direct
def test_web_failure_matrix_is_not_semantic_guilt(direct_vm, direct_deploy, direct_owner, direct_alice, label, status, body, expected):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    add_evidence(core, direct_vm, direct_alice, intent_id)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": status, "body": body})
    direct_vm.strict_mocks = True
    core.stage_evidence(intent_id)
    assert label
    assert json.loads(core.get_intent(intent_id))["status"] == expected
