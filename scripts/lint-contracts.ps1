$ErrorActionPreference = 'Stop'
$env:GENVM_VERSION = 'v0.2.16'
$lint = Get-Command genvm-lint -ErrorAction Stop
$contracts = @('contracts/pavel_core.py', 'contracts/pavel_vault.py')
foreach ($contract in $contracts) {
  & $lint.Source check $contract --json
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
