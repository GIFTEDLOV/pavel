$ErrorActionPreference = 'Stop'
$env:GENVM_VERSION = 'v0.2.16'
$contracts = @('contracts/pavel_core.py', 'contracts/pavel_vault.py')
foreach ($contract in $contracts) {
  & .venv/Scripts/genvm-lint.exe check $contract --json
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
