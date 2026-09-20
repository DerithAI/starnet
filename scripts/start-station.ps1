# start-station.ps1 — start the StarNet sidecar WITHOUT ever putting a provider key on the command line.
#
# Why this file exists (measured 2026-09-20): the station was being started with an inline one-liner
#     pwsh -Command "$env:OPENROUTER_API_KEY='<value>'; Stop-Process -Name node -Force; node sidecar/index.js"
# On Windows the whole -Command string IS the process command line (argv), so the key was readable by any
# local process through Win32_Process (live pwsh pid 22020 carried OPENROUTER_API_KEY; a same-day IDE task
# carried the ANTHROPIC variant). Nothing about a key needs to be an argument: the sidecar reads it from its
# own environment. This launcher takes NO secret parameter, for the same reason.
#
# Key sources, in order (shell env wins, exactly like dev/seed.js):
#   1. the environment this process inherits (export it yourself in the shell you launch from),
#   2. an env file — default dev/.env.dev (gitignored; template: dev/.env.dev.example), or -EnvFile <path>.
# Values from the file go into the child's environment only; they are never printed and never become argv.
#
# Usage:
#   pwsh -File scripts/start-station.ps1                 # start on :8787 (restarts whatever holds the port)
#   pwsh -File scripts/start-station.ps1 -DryRun         # report what would happen; change nothing
#   pwsh -File scripts/start-station.ps1 -Port 8899 -NoRestart
[CmdletBinding()]
param(
  [string]$EnvFile,
  [int]$Port = 8787,
  [switch]$DryRun,
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $EnvFile) { $EnvFile = Join-Path $repo 'dev\.env.dev' }

# Provider credentials the sidecar can pick up from its environment (names only — no value is read here).
$keyNames = @(
  'SKYNET_OPENROUTER_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY',
  'XAI_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY'
)

function Get-ProcessEnv { param([string]$Name) [Environment]::GetEnvironmentVariable($Name, 'Process') }
function Get-PresentKeys { @($keyNames | Where-Object { $v = Get-ProcessEnv $_; $v -and $v.Trim() }) }

# ── Self-check: this process must not carry a key in its own command line ─────────────────────
# The pattern is assembled at runtime, so this file itself contains no key-shaped literal.
$assignShape = '(ANTHROPIC|OPENROUTER|OPENAI|GEMINI|GROQ|XAI|MISTRAL|DEEPSEEK|TOGETHER|FIREWORKS|PERPLEXITY|CEREBRAS)_(API_)?KEY\s*='
try {
  $own = (Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $PID) -ErrorAction Stop).CommandLine
  if ($own -match $assignShape) {
    Write-Warning 'This launcher was started with a provider key ON THE COMMAND LINE — it is already exposed to every local process. Kill it and relaunch without the key (see this file''s header).'
  } else {
    Write-Host 'self-check : no provider-key assignment on this command line'
  }
} catch {
  Write-Verbose "self-check unavailable: $($_.Exception.Message)"
}

# ── Seed the child environment from an env file (shell env wins) ───────────────────────────────
$loaded = @()
$kept = @()
if (Test-Path -LiteralPath $EnvFile -PathType Leaf) {
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match '^\s*#') { continue }
    $m = [regex]::Match($line, '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
    if (-not $m.Success) { continue }
    $name = $m.Groups[1].Value
    $value = $m.Groups[2].Value.Trim().Trim('"').Trim("'")
    if ([string]::IsNullOrEmpty($value)) { continue }
    if (Get-ProcessEnv $name) { $kept += $name; continue }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    $loaded += $name
  }
} else {
  Write-Host "env file   : $EnvFile (not found — relying on the inherited environment)"
}

$node = (Get-Command node -ErrorAction SilentlyContinue)
$present = Get-PresentKeys

Write-Host "repo       : $repo"
Write-Host "env file   : $EnvFile"
Write-Host "env loaded : $(if ($loaded) { ($loaded | Sort-Object -Unique) -join ', ' } else { '(none)' })"
Write-Host "env kept   : $(if ($kept) { ($kept | Sort-Object -Unique) -join ', ' } else { '(none)' })"
Write-Host "keys found : $(if ($present) { ($present | Sort-Object) -join ', ' } else { '(none)' })"
Write-Host "node       : $(if ($node) { $node.Source } else { 'NOT FOUND' })"

if (-not $present) {
  Write-Warning 'No provider key in the environment — the UI will still load, but agent runs will fail until one is provided (env file: dev/.env.dev).'
}

# ── Who holds the port right now ───────────────────────────────────────────────────────────────
$listener = @()
try { $listener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop) }
catch { Write-Verbose "port probe unavailable: $($_.Exception.Message)" }

$owners = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
if ($owners.Count -gt 0) {
  foreach ($ownerPid in $owners) {
    $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    Write-Host ("port {0}    : held by pid {1} ({2})" -f $Port, $ownerPid, $(if ($proc) { $proc.ProcessName } else { 'gone' }))
  }
} else {
  Write-Host ("port {0}    : free" -f $Port)
}

if ($DryRun) {
  Write-Host 'dry run    : nothing started, nothing stopped'
  exit 0
}

if (-not $node) { throw 'node not found on PATH' }

# ── Free the port — only the listener just measured, never "all node processes" ────────────────
if (-not $NoRestart -and $owners.Count -gt 0) {
  foreach ($ownerPid in $owners) {
    Write-Host ("stopping   : pid {0} (listener on :{1})" -f $ownerPid, $Port)
    Stop-Process -Id $ownerPid -Force -ErrorAction Stop
  }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  }
  if (@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
    throw "port $Port is still held after stopping its listener"
  }
}

# ── Start the sidecar (environment inherited; no key in argv) ──────────────────────────────────
Write-Host ("starting   : {0} sidecar/index.js (port {1})" -f $node.Source, $Port)
Push-Location $repo
try {
  & $node.Source 'sidecar/index.js'
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $code
