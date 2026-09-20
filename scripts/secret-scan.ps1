$ErrorActionPreference = 'Stop'
$matches = rg -n -i --hidden --glob '!.git/**' --glob '!**/node_modules/**' --glob '!**/.pnpm/**' --glob '!.venv/**' --glob '!.next/**' --glob '!artifacts/**' --glob '!__pycache__/**' --glob '!**/*.tsbuildinfo' --glob '!scripts/secret-scan.ps1' '(private[_ -]?key|mnemonic|seed phrase|api[_ -]?key\s*[:=])' .
if ($LASTEXITCODE -eq 0) { $matches; exit 1 }
Write-Output 'secret scan: no obvious credential patterns found'
