$ErrorActionPreference = 'Stop'

# This scan is deliberately limited to project-controlled release material. It
# must not inspect encrypted user keystores or generated qualification output.
$scannerPath = $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pattern = '(private[_ -]?key|mnemonic|seed phrase|api[_ -]?key\s*[:=])'
$excludedGlobs = @(
    '!.git/**',
    '!**/node_modules/**',
    '!**/.pnpm/**',
    '!.venv/**',
    '!**/venv/**',
    '!.next/**',
    '!**/dist/**',
    '!**/build/**',
    '!**/coverage/**',
    '!**/cache/**',
    '!**/.cache/**',
    '!**/__pycache__/**',
    '!**/.pytest_cache/**',
    '!.test-artifacts/**',
    '!artifacts/**',
    '!**/*.tsbuildinfo',
    '!scripts/secret-scan.ps1'
)

function Write-SafeMatch([string]$file, [int]$lineNumber, [string]$line) {
    $normalizedFile = $file -replace '^\.\\', ''
    $normalizedLine = $line.Trim()
    # These two exact README lines explain secret-handling rules. They contain
    # detector vocabulary but no credential value; all other README content is
    # still scanned normally.
    $allowlistedDocumentation = $normalizedFile -eq 'README.md' -and $normalizedLine -in @(
        'Public reads do not require a wallet. Never place private keys, keystore',
        'passwords, seed phrases, or API tokens in `.env.example` or tracked files.'
    )
    if ($allowlistedDocumentation) { return }
    foreach ($match in [regex]::Matches($line, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        # Emit only file, line, and detector token. Never emit the containing line.
        Write-Output ("{0}:{1}:{2}" -f $file, $lineNumber, $match.Value)
    }
}

$rg = Get-Command rg.exe -ErrorAction SilentlyContinue
if ($null -ne $rg) {
    Push-Location $root
    try {
        $rgArguments = @('-n', '-i', '--hidden')
        foreach ($glob in $excludedGlobs) { $rgArguments += @('--glob', $glob) }
        $rgArguments += @($pattern, '.')
        $output = & $rg.Source @rgArguments
        $rgExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($rgExitCode -eq 0) {
        $safeMatches = @()
        foreach ($matchLine in @($output)) {
            if ($matchLine -match '^(.*?):(\d+):(.*)$') {
                $safeMatches += @(Write-SafeMatch $Matches[1] ([int]$Matches[2]) $Matches[3])
            }
        }
        if ($safeMatches.Count -gt 0) {
            $safeMatches
            exit 1
        }
        Write-Output 'secret scan: no obvious credential patterns found'
        exit 0
    }
    if ($rgExitCode -eq 1) {
        Write-Output 'secret scan: no obvious credential patterns found'
        exit 0
    }
    throw "secret scan could not run rg (exit code $rgExitCode)"
}

# The V5 runner invokes this script in a child PowerShell process. Use a
# built-in fallback so the gate remains deterministic when rg is not on PATH.
$excludedDirectories = @(
    '.git', 'node_modules', '.pnpm', '.venv', 'venv', '.next', 'dist', 'build',
    'coverage', 'cache', '.cache', '__pycache__', '.pytest_cache',
    '.test-artifacts', 'artifacts'
)
function Get-ScanFiles([string]$directory) {
    foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
        if ($entry.PSIsContainer) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            if ($entry.Name -notin $excludedDirectories) { Get-ScanFiles $entry.FullName }
            continue
        }
        if ($entry.Name -notlike '*.tsbuildinfo' -and $entry.FullName -ne $scannerPath) {
            $entry
        }
    }
}
$files = @(Get-ScanFiles $root)

$found = $false
foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Length).TrimStart('\', '/')
    $display = '.\' + ($relative -replace '/', '\')
    $lineNumber = 0
    foreach ($line in [IO.File]::ReadLines($file.FullName)) {
        $lineNumber++
        $lineMatches = [regex]::Matches($line, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($lineMatches.Count -gt 0) {
            $found = $true
            Write-SafeMatch $display $lineNumber $line
        }
    }
}

if ($found) { exit 1 }
Write-Output 'secret scan: no obvious credential patterns found'
