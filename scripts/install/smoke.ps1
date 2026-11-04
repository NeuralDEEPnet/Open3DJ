<#
.SYNOPSIS
Checks an installed open3dj on Windows the way a person uses it.

.DESCRIPTION
open3dj from PATH runs doctor, runs two examples, exports STEP and 3MF, renders PNGs and
serves one MCP session over stdio; open3dj.cmd is checked from cmd.exe too. The install smoke
workflow runs it after install.ps1; you can run it too. Results go to -OutDir: doctor.json,
bracket.png, enclosure.png, exports\, mcp-smoke.json.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\install\smoke.ps1 -OutDir $env:TEMP\open3dj-smoke
#>
param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Open3DJ')
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here '..\..')).ProviderPath
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'work') | Out-Null
$out = (Resolve-Path $OutDir).ProviderPath

function Write-Step([string]$Message) { Write-Host ''; Write-Host "==> $Message" }
function Fail([string]$Message) { throw "smoke: FAILED: $Message" }
# Run open3dj and stop on a non-zero exit code.
function Invoke-Open3DJ {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & open3dj @args } finally { $ErrorActionPreference = $eap }
  if ($LASTEXITCODE -ne 0) { Fail "open3dj $($args -join ' ') exited with $LASTEXITCODE" }
}
function Get-Head([string]$Path, [int]$Count) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  return [Text.Encoding]::ASCII.GetString($bytes, 0, [Math]::Min($Count, $bytes.Length))
}

Write-Step 'open3dj on PATH'
$cmd = Get-Command open3dj -ErrorAction SilentlyContinue
if (-not $cmd) { Fail 'open3dj is not on PATH in this shell' }
Write-Host "$($cmd.Source)"
Invoke-Open3DJ --version
$viaCmd = & cmd.exe /d /c 'open3dj --version'
if ($LASTEXITCODE -ne 0) { Fail 'open3dj.cmd does not run from cmd.exe' }
Write-Host "cmd.exe: open3dj --version -> $viaCmd"

Write-Step 'doctor --json'
$doctor = Invoke-Open3DJ doctor --json
[IO.File]::WriteAllText((Join-Path $out 'doctor.json'), (($doctor -join "`n") + "`n"))
if (-not (($doctor -join "`n") -match '"cpu\.wasm"')) { Fail 'doctor --json lists no cpu.wasm backend' }

Copy-Item (Join-Path $repo 'examples\bracket\bracket.o3j.js'), (Join-Path $repo 'examples\enclosure\enclosure.o3j.js') (Join-Path $out 'work')
Push-Location (Join-Path $out 'work')
try {
  Write-Step 'run'
  Invoke-Open3DJ run bracket.o3j.js
  Invoke-Open3DJ run enclosure.o3j.js

  Write-Step 'export'
  $exports = Join-Path $out 'exports'
  Invoke-Open3DJ export bracket.o3j --format step --out $exports
  Invoke-Open3DJ export enclosure.o3j --format step --out $exports
  Invoke-Open3DJ export enclosure.o3j --format 3mf --out $exports
  foreach ($f in 'bracket.step', 'enclosure.step') {
    if ((Get-Head (Join-Path $exports $f) 13) -ne 'ISO-10303-21;') { Fail "$f is not a STEP file" }
  }
  if ((Get-Head (Join-Path $exports 'enclosure.3mf') 2) -ne 'PK') { Fail 'enclosure.3mf is not a zip (3MF) file' }

  Write-Step 'render'
  Invoke-Open3DJ render bracket.o3j --out (Join-Path $out 'bracket.png')
  Invoke-Open3DJ render enclosure.o3j --out (Join-Path $out 'enclosure.png')
  foreach ($f in 'bracket.png', 'enclosure.png') {
    if ((Get-Head (Join-Path $out $f) 4).Substring(1) -ne 'PNG') { Fail "$f is not a PNG" }
  }
} finally {
  Pop-Location
}

Write-Step 'MCP over stdio'
$installJson = Join-Path $InstallDir 'install.json'
$info = Get-Content -Raw -LiteralPath $installJson | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $info.node)) { Fail "no node in $installJson" }
$eap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { $mcp = & $info.node (Join-Path $here 'mcp-smoke.ts') --install $installJson } finally { $ErrorActionPreference = $eap }
if ($LASTEXITCODE -ne 0) { Fail 'the MCP session failed (see above)' }
$mcp
[IO.File]::WriteAllText((Join-Path $out 'mcp-smoke.json'), (($mcp -join "`n") + "`n"))

Write-Host ''
Write-Host 'smoke: all checks passed'
