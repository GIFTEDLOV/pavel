$ErrorActionPreference = "Stop"

$env:GENVM_VERSION = "v0.2.16"
& node scripts/run-node-qualification.mjs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
python -m pytest -q --artifacts-dir .test-artifacts
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
