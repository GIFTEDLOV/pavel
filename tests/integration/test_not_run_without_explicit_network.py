import pytest


@pytest.mark.integration
@pytest.mark.skip(reason="Phase 1 does not submit network transactions; use an explicit localnet/studionet qualification job")
def test_network_integration_is_explicitly_opt_in():
    pytest.fail("network integration is intentionally not run in Phase 1")
