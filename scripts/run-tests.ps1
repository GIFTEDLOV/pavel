$ErrorActionPreference = "Stop"

$env:GENVM_VERSION = "v0.2.16"
$nodeTests = @(
    "scripts/qualification/account-resolution-regression.mjs",
    "scripts/qualification/confirmation-regression.mjs",
    "scripts/qualification/reconciliation-regression.mjs",
    "scripts/qualification/v3-runner-regression.mjs",
    "scripts/qualification/v4-runner-regression.mjs",
    "scripts/qualification/v4-remaining-lifecycle-regression.mjs",
    "scripts/qualification/finish-v4-regression.mjs",
    "scripts/qualification/official-transaction-regression.mjs",
    "scripts/qualification/checkpoint-retry-regression.mjs",
    "scripts/qualification/v5-runner-regression.mjs",
    "scripts/qualification/v6-authorization-regression.mjs",
    "scripts/qualification/v6-live-resume-regression.mjs",
    "scripts/qualification/deployment-reconciliation-regression.mjs",
    "scripts/qualification/v7-fulfillment-regression.mjs",
    "scripts/qualification/v7-fulfillment-mutation.mjs"
)
& node --experimental-strip-types --test $nodeTests
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
python -m pytest -q --artifacts-dir .test-artifacts
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
