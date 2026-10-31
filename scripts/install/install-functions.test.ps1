<#
Checks the helper functions of install.ps1 in the PowerShell that runs this file (Windows
PowerShell 5.1 or PowerShell 7). scripts/install/install.test.ts runs it and reads the JSON it
prints. The functions are taken from install.ps1 by its syntax tree, so this tests the real code.

Environment: O3J_PS1 (install.ps1), O3J_BASE (an empty scratch folder), O3J_ODD (folder names
separated by '|', with characters that cmd.exe or a code page would get wrong) and O3J_NODE (a
node executable, used on Windows to run a generated open3dj.cmd for real).
#>
$ErrorActionPreference = 'Stop'
$IsWin = $env:OS -eq 'Windows_NT'
$ShimTag = 'Open3DJ command, written by the Open3DJ installer.'
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:O3J_PS1, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "install.ps1 does not parse: $($errors[0].Message)" }
$wanted = 'Fail', 'Remove-TreeChildren', 'Remove-Tree', 'Test-RefName', 'ConvertTo-CmdPath', 'New-CmdShimText', 'Test-Shim', 'Test-Inside', 'Test-SamePath', 'Rename-WithRetry'
$found = @()
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
  if ($wanted -contains $f.Name) { . ([scriptblock]::Create($f.Extent.Text)); $found += $f.Name }
}
$out = [ordered]@{ edition = $PSVersionTable.PSEdition; functions = @($found | Sort-Object -Unique) }

function New-Dir([string]$Path) { [void][IO.Directory]::CreateDirectory($Path); return $Path }
function New-File([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text) }

# ---- Remove-Tree: odd folder names, links that must not be followed, read-only files ----------
$base = $env:O3J_BASE
$keep = New-Dir (Join-Path $base 'keep')
New-File (Join-Path $keep 'sentinel.txt') 'keep'
$out.trees = @()
foreach ($odd in ($env:O3J_ODD -split '\|')) {
  $root = New-Dir (Join-Path $base $odd)
  # cmd.exe would split "a&b" at the '&' and delete "a": this sibling must survive.
  # Windows drops trailing spaces and dots from folder names, as cmd.exe does with the name it splits off.
  $sibling = New-Dir (Join-Path $base (($odd -split '&')[0].TrimEnd(' ', '.')))
  New-File (Join-Path $sibling 'still-here.txt') 'x'
  New-File (Join-Path $root '.open3dj-install') 'marker'
  $nm = New-Dir (Join-Path $root 'app\node_modules\@open3dj')
  New-File (Join-Path $root 'app\file.txt') 'x'
  $ro = Join-Path $root 'app\readonly.txt'
  New-File $ro 'x'
  [IO.File]::SetAttributes($ro, [IO.FileAttributes]::ReadOnly)
  $link = Join-Path $nm 'kernel'
  if ($IsWin) { [void](New-Item -ItemType Junction -Path $link -Value $keep) }
  else { [void](New-Item -ItemType SymbolicLink -Path $link -Value $keep) }
  $linked = Test-Path -LiteralPath (Join-Path $link 'sentinel.txt')
  Remove-Tree $root
  $out.trees += [ordered]@{
    name = $odd
    linked = $linked
    removed = -not (Test-Path -LiteralPath $root)
    siblingKept = Test-Path -LiteralPath (Join-Path $sibling 'still-here.txt')
  }
}
$out.linkTargetKept = Test-Path -LiteralPath (Join-Path $keep 'sentinel.txt')

# ---- a file in use: the marker stays, and renaming its folder fails (Windows only) ------------
if ($IsWin) {
  $busy = New-Dir (Join-Path $base 'busy')
  New-File (Join-Path $busy '.open3dj-install') 'marker'
  $nodeDir = New-Dir (Join-Path $busy 'node')
  New-File (Join-Path $busy 'a.txt') 'x'
  $locked = Join-Path $nodeDir 'node.exe'
  New-File $locked 'x'
  $fs = [IO.File]::Open($locked, 'Open', 'Read', 'None')
  try {
    $renameFailed = $false
    try { Rename-Item -LiteralPath $nodeDir 'node.removing' } catch { $renameFailed = $true }
    $threw = $false
    try { Remove-Tree $busy } catch { $threw = $true }
    $out.busy = [ordered]@{ renameFailed = $renameFailed; threw = $threw; markerKept = Test-Path -LiteralPath (Join-Path $busy '.open3dj-install') }
  } finally { $fs.Dispose() }
  Remove-Tree $busy
  $out.busy.removedAfterClose = -not (Test-Path -LiteralPath $busy)
}

# ---- Rename-WithRetry: a free folder renames; a busy one fails after its tries, then renames --
$free = New-Dir (Join-Path $base 'rename-free')
$out.retry = [ordered]@{ free = (Rename-WithRetry $free 'rename-free-done' 2) }
if ($IsWin) {
  $busyDir = New-Dir (Join-Path $base 'rename-busy')
  $stream = [IO.File]::Open((Join-Path $busyDir 'held.txt'), 'Create', 'ReadWrite', 'None')
  try { $out.retry.busyFails = -not (Rename-WithRetry $busyDir 'rename-busy-done' 2) } finally { $stream.Dispose() }
  $out.retry.renamesAfterClose = (Rename-WithRetry $busyDir 'rename-busy-done' 2)
}

# ---- Test-RefName ---------------------------------------------------------------------------
$out.refsOk = @('main', 'v1.2.3', 'feature/x-1', 'e0f16a5c91c6', 'ccr-1e979422-dguyci' | Where-Object { Test-RefName $_ })
$out.refsBad = @('../../../octocat/Hello-World/zip/master', 'a/../b', '.hidden', 'x/', 'x.', 'x.lock', 'a//b', 'a/.b', '-x', '/x', 'main;rm', 'a b', '' | Where-Object { -not (Test-RefName $_) })

# ---- Test-Inside ----------------------------------------------------------------------------
$out.inside = @(
  (Test-Inside 'C:\src\Open3DJ\inst' 'C:\src\Open3DJ'),
  (Test-Inside 'C:\src\Open3DJ' 'C:\src\Open3DJ\'),
  (Test-Inside 'C:\src\Open3DJ2' 'C:\src\Open3DJ'),
  (Test-Inside 'C:\Users\x\AppData\Local\Open3DJ' 'C:\src\Open3DJ')
)

# ---- open3dj.cmd text ------------------------------------------------------------------------
$user = 'C:\Users\Zo' + [char]0xEB + ' ' + [char]0x141 + ' R&D'
$env:USERPROFILE = $user
$env:LOCALAPPDATA = "$user\AppData\Local"
$env:APPDATA = "$user\AppData\Roaming"
$dir = "$env:LOCALAPPDATA\Open3DJ"
$cli = "$dir\app\packages\open3dj\src\cli.ts"
$private = New-CmdShimText "$dir\node\node.exe" $cli $dir
$nvm = New-CmdShimText "$env:APPDATA\nvm\v24.22.1\node.exe" $cli $dir
$pct = New-CmdShimText 'C:\tools\50%\node.exe' $cli $dir
$refused = ''
try { [void](New-CmdShimText ('D:\Zo' + [char]0xEB + '\node.exe') $cli $dir) } catch { $refused = $_.Exception.Message }
$out.shim = [ordered]@{
  private = $private
  nvm = $nvm
  percent = $pct
  ascii = -not (($private + $nvm + $pct) -match '[^\x09\x0a\x0d\x20-\x7e]')
  refused = $refused
  asciiPreamble = [Text.Encoding]::ASCII.GetPreamble().Length
}

# ---- run a generated open3dj.cmd from a folder with odd characters (Windows only) -------------
if ($IsWin -and $env:O3J_NODE) {
  # No % here: cmd.exe expands %...% in the command line that starts any batch file, so a
  # folder name with a variable in it breaks every .cmd, not only this one.
  $inst = Join-Path $base ('Zo' + [char]0xEB + ' ' + [char]0x141 + ' & R&D (x) run')
  $src = New-Dir (Join-Path $inst 'app\packages\open3dj\src')
  [void](New-Dir (Join-Path $inst 'node'))
  [void](New-Dir (Join-Path $inst 'bin'))
  Copy-Item -LiteralPath $env:O3J_NODE -Destination (Join-Path $inst 'node\node.exe')
  New-File (Join-Path $src 'cli.ts') 'console.log(JSON.stringify(process.argv.slice(2)));'
  $shim = Join-Path $inst 'bin\open3dj.cmd'
  [IO.File]::WriteAllText($shim, (New-CmdShimText (Join-Path $inst 'node\node.exe') (Join-Path $src 'cli.ts') $inst), [Text.Encoding]::ASCII)
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $ran = & $shim hello 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $eap
  $out.run = [ordered]@{ output = $ran.Trim(); exitCode = $code }
  Remove-Tree $inst
}

# Escape every non-ASCII character, so the console code page cannot change the output.
$json = $out | ConvertTo-Json -Depth 5 -Compress
$sb = New-Object Text.StringBuilder
foreach ($ch in $json.ToCharArray()) {
  if ([int]$ch -gt 126) { [void]$sb.AppendFormat('\u{0:x4}', [int]$ch) } else { [void]$sb.Append($ch) }
}
$sb.ToString()
