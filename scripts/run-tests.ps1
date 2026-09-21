$ErrorActionPreference = "Stop"

$env:GENVM_VERSION = "v0.2.16"
$python = Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"
& $python -m pytest -q --artifacts-dir .test-artifacts
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
