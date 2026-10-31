<#
.SYNOPSIS
Installs Open3DJ for the current user on Windows (x64 and ARM64). No admin rights needed.

.DESCRIPTION
Works in Windows PowerShell 5.1 and PowerShell 7. What it does:
  1. Uses the node on your PATH if it is version 24 or newer. Otherwise it offers to download
     the official Node 24 zip from nodejs.org into the install folder (checked against
     SHASUMS256.txt, private to Open3DJ, no admin), or to install Node LTS with winget.
  2. Downloads the Open3DJ source for -Ref from GitHub (or copies -Source) and runs
     npm ci --omit=dev --ignore-scripts in it.
  3. Writes open3dj.cmd to <InstallDir>\bin and adds that folder to your user
     PATH (never the machine PATH) unless -NoPath.
  4. Runs open3dj doctor and prints the next steps.
Rerunning it upgrades in place. -Uninstall removes everything it added; your designs are never
touched.

.EXAMPLE
# Download, read, then run (the safer way):
Invoke-WebRequest https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.ps1 -OutFile install-open3dj.ps1
powershell -ExecutionPolicy Bypass -File .\install-open3dj.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\install-open3dj.ps1 -Uninstall

.NOTES
Run as `irm <url> | iex`, this param block runs in your own scope, so variables of yours named
$Ref, $Source, $InstallDir, $NoPath, $Yes, $Uninstall, $PrivateNode or $UseWinget are
overwritten. The form & ([scriptblock]::Create((irm <url>))) runs in a child scope instead.
#>
param(
  # Git branch, tag or commit to install.
  [string]$Ref = 'main',
  # Install from a local Open3DJ folder instead of downloading (CI uses this).
  [string]$Source = '',
  # Install folder. Default: $env:LOCALAPPDATA\Open3DJ
  [string]$InstallDir = '',
  # Do not add the command folder to the user PATH.
  [switch]$NoPath,
  # Do not ask questions; take the default answers (a private Node, no admin).
  [switch]$Yes,
  # Remove Open3DJ.
  [switch]$Uninstall,
  # Download a private Node 24 even if a suitable node is on PATH.
  [switch]$PrivateNode,
  # When Node 24 is missing, install Node LTS with winget instead of a private copy.
  [switch]$UseWinget
)

function Invoke-Open3DJInstaller {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $Repo = if ($env:OPEN3DJ_REPO) { $env:OPEN3DJ_REPO } else { 'NeuralDEEPnet/Open3DJ' }
  $NodeMajor = 24
  $NodeDist = if ($env:OPEN3DJ_NODE_DIST) { $env:OPEN3DJ_NODE_DIST } else { 'https://nodejs.org/dist' }
  $ShimTag = 'Open3DJ command, written by the Open3DJ installer.'
  $ReportUrl = 'https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml'
  $DefaultDir = Join-Path $env:LOCALAPPDATA 'Open3DJ'

  function Fail([string]$Message) { throw "open3dj installer: $Message" }
  function Write-Step([string]$Message) { Write-Host ''; Write-Host "==> $Message" -ForegroundColor Cyan }
  function Write-Say([string]$Message) { Write-Host $Message }

  function Test-Interactive {
    try { return [Environment]::UserInteractive -and -not [Console]::IsInputRedirected } catch { return $false }
  }
  function Confirm-Step([string]$Question) {
    if ($Yes -or -not (Test-Interactive)) { return $true }
    $answer = Read-Host "$Question [Y/n]"
    return -not ($answer -match '^\s*[nN]')
  }

  # Delete a folder without following junctions or symbolic links: npm links the workspace
  # packages with junctions, and a delete that followed them would reach into the live app.
  # It never goes through cmd.exe, so no shell parses the path (a Windows user name may hold
  # & ^ % ( and )). The .open3dj-install marker is deleted last: a delete cut short by a file
  # in use leaves a folder that -Uninstall and the installer still recognize as theirs.
  function Remove-TreeChildren([string]$Path, [bool]$KeepMarker) {
    foreach ($item in @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue)) {
      if ($KeepMarker -and $item.Name -eq '.open3dj-install') { continue }
      try {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
          # A junction or a link: remove the link itself, never what it points to.
          if ($item.PSIsContainer -and $env:OS -eq 'Windows_NT') { [IO.Directory]::Delete($item.FullName, $false) }
          else { [IO.File]::Delete($item.FullName) }
        } elseif ($item.PSIsContainer) {
          Remove-TreeChildren $item.FullName $false
          [IO.Directory]::Delete($item.FullName, $false)
        } else {
          if ($item.Attributes -band [IO.FileAttributes]::ReadOnly) { [IO.File]::SetAttributes($item.FullName, [IO.FileAttributes]::Normal) }
          [IO.File]::Delete($item.FullName)
        }
      } catch { }
    }
  }
  function Remove-Tree([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Remove-TreeChildren $Path $true
    $left = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '.open3dj-install' })
    if ($left.Count -eq 0) {
      try {
        $m = Join-Path $Path '.open3dj-install'
        if (Test-Path -LiteralPath $m) { [IO.File]::Delete($m) }
        [IO.Directory]::Delete($Path, $false)
      } catch { }
    }
    if (Test-Path -LiteralPath $Path) {
      Fail "could not remove $Path. Close programs that use Open3DJ (an MCP client such as Claude Desktop, or a running open3dj view) and run this again."
    }
  }

  # A git ref the way git check-ref-format allows it, within a safe character set. No '..', so
  # a ref can never walk the download URL out of the repository.
  function Test-RefName([string]$Name) {
    if ($Name -notmatch '^[A-Za-z0-9._/-]+$') { return $false }
    return -not ($Name -match '^[-/.]|/$|\.$|\.\.|//|/\.|\.lock$|\.lock/')
  }

  # How a path is written in open3dj.cmd. cmd.exe reads a batch file in the console code page,
  # which no encoding chosen here can be sure to match, and it expands %...% even inside quotes.
  # So the file is plain ASCII: a path inside the install folder is relative to the command
  # (%~dp0 is <InstallDir>\bin\ when it runs), a leading profile folder becomes its variable,
  # and any other % is doubled. A path that is still not ASCII is refused with a clear error.
  function ConvertTo-CmdPath([string]$Path, [string]$Dir) {
    $text = $null
    if ($Path.StartsWith($Dir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
      $text = '%~dp0..\' + ($Path.Substring($Dir.TrimEnd('\').Length + 1) -replace '%', '%%')
    } else {
      foreach ($name in 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE') {
        $v = [Environment]::GetEnvironmentVariable($name)
        if ($v) { $v = $v.TrimEnd('\') }
        if ($v -and $Path.StartsWith($v + '\', [StringComparison]::OrdinalIgnoreCase)) {
          $text = "%$name%\" + ($Path.Substring($v.Length + 1) -replace '%', '%%')
          break
        }
      }
      if (-not $text) { $text = $Path -replace '%', '%%' }
    }
    if ($text -match '[^\x20-\x7e]') {
      Fail "the path $Path has characters that open3dj.cmd cannot hold. Run the installer again with -PrivateNode, or choose an -InstallDir with plain ASCII letters."
    }
    return $text
  }
  function New-CmdShimText([string]$Node, [string]$Cli, [string]$Dir) {
    $n = ConvertTo-CmdPath $Node $Dir
    $c = ConvertTo-CmdPath $Cli $Dir
    return (@(
      '@echo off',
      "rem $ShimTag Rerun the installer to update it.",
      "if not exist `"$n`" goto missing",
      "`"$n`" `"$c`" %*",
      'exit /b %ERRORLEVEL%',
      ':missing',
      "echo open3dj: Node was not found at `"$n`". Rerun the Open3DJ installer. 1>&2",
      'exit /b 127'
    ) -join "`r`n") + "`r`n"
  }
  function Test-Shim([string]$File) {
    try { return (Test-Path -LiteralPath $File -PathType Leaf) -and ([IO.File]::ReadAllText($File).Contains($ShimTag)) } catch { return $false }
  }
  # True when $Child is $Parent or a folder inside it.
  # Windows keeps a file busy for a moment after the program that used it exits, and virus
  # scanners open new files briefly. A rename that fails is tried again for about ten seconds
  # before the folder counts as in use. Returns $true when the rename happened.
  function Rename-WithRetry([string]$Path, [string]$NewName, [int]$Tries = 20) {
    for ($i = 1; $i -le $Tries; $i++) {
      try { Rename-Item -LiteralPath $Path $NewName -ErrorAction Stop; return $true }
      catch { if ($i -lt $Tries) { Start-Sleep -Milliseconds 500 } }
    }
    return $false
  }
  function Test-Inside([string]$Child, [string]$Parent) {
    $c = $Child.TrimEnd('\'); $p = $Parent.TrimEnd('\')
    return (Test-SamePath $c $p) -or $c.StartsWith($p + '\', [StringComparison]::OrdinalIgnoreCase)
  }

  function Get-Text([string]$Url, [hashtable]$Headers = @{}) {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -Headers $Headers
    $c = $r.Content
    if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
    return [string]$c
  }
  function Save-Url([string]$Url, [string]$OutFile) {
    try { Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing }
    catch { Fail "could not download ${Url}: $($_.Exception.Message)" }
  }
  function Expand-Zip([string]$Zip, [string]$Dest) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Dest)
  }

  # Run a native program with its stderr shown but never turned into a terminating error
  # (Windows PowerShell 5.1 does that with -ErrorAction Stop). Callers check $LASTEXITCODE.
  function Invoke-Native([string]$Exe, [string[]]$Arguments, [switch]$Quiet) {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      if ($Quiet) { & $Exe @Arguments 2>$null } else { & $Exe @Arguments }
    } finally {
      $ErrorActionPreference = $eap
    }
  }

  function Get-NodeMajor([string]$Exe) {
    try {
      $v = Invoke-Native $Exe @('-p', 'process.versions.node') -Quiet
      if ($LASTEXITCODE -eq 0 -and $v) { return [int](([string]$v).Split('.')[0]) }
    } catch { }
    return 0
  }

  function Get-NativeArch {
    $a = $null
    try { $a = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name PROCESSOR_ARCHITECTURE).PROCESSOR_ARCHITECTURE } catch { }
    if (-not $a) { $a = $env:PROCESSOR_ARCHITEW6432 }
    if (-not $a) { $a = $env:PROCESSOR_ARCHITECTURE }
    if ($a -eq 'ARM64') { return 'arm64' }
    if ($a -eq 'AMD64') { return 'x64' }
    Fail "this processor ($a) is not supported; Open3DJ runs on x64 and ARM64 Windows"
  }

  function Get-UserPath {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
    if (-not $key) { return '' }
    try { return [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Close() }
  }
  # Write the user PATH as REG_EXPAND_SZ, so entries such as %USERPROFILE%\bin keep working.
  function Set-UserPath([string]$Value) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    try { $key.SetValue('Path', $Value, [Microsoft.Win32.RegistryValueKind]::ExpandString) } finally { $key.Close() }
  }
  function Test-SamePath([string]$A, [string]$B) {
    return [string]::Equals($A.Trim().TrimEnd('\'), $B.Trim().TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
  }

  if ($PSVersionTable.PSVersion.Major -lt 5) { Fail 'this installer needs Windows PowerShell 5.1 or PowerShell 7' }
  if ($env:OS -ne 'Windows_NT') { Fail 'this is not Windows: use scripts/install/install.sh on macOS and Linux' }
  if (-not (Test-RefName $Ref)) { Fail "-Ref '$Ref' is not a branch, tag or commit name" }
  if (-not $NodeDist.StartsWith('https://')) { Fail "OPEN3DJ_NODE_DIST must be an https:// address, not $NodeDist" }
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  # Behind a proxy that asks for a Windows sign-in, Windows PowerShell does not send it unless told.
  try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch { }

  $dir = if ($InstallDir) { $InstallDir } else { $DefaultDir }
  $dir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($dir).TrimEnd('\')
  if ($dir.Length -le 3 -or (Test-SamePath $dir $env:USERPROFILE)) { Fail '-InstallDir must be a folder of its own, not a drive root or your user folder' }
  $marker = Join-Path $dir '.open3dj-install'
  $bin = Join-Path $dir 'bin'

  # ---- uninstall -----------------------------------------------------------------------
  if ($Uninstall) {
    if ((Test-Path -LiteralPath $dir) -and -not (Test-Path -LiteralPath $marker)) {
      Fail "$dir has no .open3dj-install marker, so it was not made by this installer. Nothing was removed."
    }
    Write-Say "This removes $dir and its entry in your user PATH. Your designs and projects are not touched."
    if (-not (Confirm-Step 'Uninstall Open3DJ?')) { Write-Say 'Nothing was removed.'; return }
    if ((Get-Location).Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase)) { Set-Location $env:USERPROFILE }
    [Environment]::CurrentDirectory = $env:TEMP
    # Windows cannot delete a program that is running (node.exe run by an MCP client), and
    # renaming its folder fails in the same case. Check that first, so a busy install is left
    # whole instead of half deleted.
    $renamed = @()
    foreach ($name in 'node', 'app') {
      $p = Join-Path $dir $name
      if (-not (Test-Path -LiteralPath $p)) { continue }
      if (Rename-WithRetry $p "$name.removing") { $renamed += $name }
      else {
        foreach ($r in $renamed) { [void](Rename-WithRetry (Join-Path $dir "$r.removing") $r) }
        Fail 'Open3DJ is in use. Close programs that use it (an MCP client such as Claude Desktop, or a running open3dj view) and run this again. Nothing was removed.'
      }
    }
    Remove-Tree $dir
    Write-Say "removed $dir"
    # The PATH entry goes only once the folder is gone, so an uninstall that stopped part way
    # can simply be run again.
    $entries = @((Get-UserPath) -split ';' | Where-Object { $_ -and -not (Test-SamePath $_ $bin) })
    Set-UserPath ($entries -join ';')
    [Environment]::SetEnvironmentVariable('OPEN3DJ_INSTALL_DIR', $null, 'User')
    $env:Path = (@($env:Path -split ';' | Where-Object { $_ -and -not (Test-SamePath $_ $bin) })) -join ';'
    Write-Say "removed $bin from your user PATH"
    Write-Say 'Open3DJ is uninstalled. Open a new terminal to refresh your PATH.'
    return
  }

  # ---- setup ---------------------------------------------------------------------------
  $from = ''
  if ($Source) {
    $r = Resolve-Path -LiteralPath $Source -ErrorAction SilentlyContinue
    if (-not $r) { Fail "-Source folder $Source not found" }
    $from = $r.ProviderPath
    # A trailing backslash would escape the closing quote Windows PowerShell puts around a
    # path with a space, and merge robocopy's two folder arguments into one.
    if ($from.Length -gt 3) { $from = $from.TrimEnd('\') }
    if (-not (Test-Path -LiteralPath (Join-Path $from 'packages\open3dj\src\cli.ts'))) { Fail "$from is not an Open3DJ folder (no packages\open3dj\src\cli.ts)" }
    if (Test-Inside $dir $from) { Fail "the install folder $dir is inside -Source $from, so the copy would copy itself. Choose an -InstallDir outside it." }
  }
  $arch = Get-NativeArch
  Write-Say "Open3DJ installer: win-$arch, install folder $dir"
  if ((Test-Path -LiteralPath $dir) -and -not (Test-Path -LiteralPath $marker) -and (Get-ChildItem -LiteralPath $dir -Force | Select-Object -First 1)) {
    Fail "$dir exists and was not made by this installer. Choose another -InstallDir or empty it."
  }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  [IO.File]::WriteAllText($marker, "Open3DJ install folder, made by scripts/install/install.ps1. Remove it with: install.ps1 -Uninstall`r`n")
  # The temporary folder sits inside the install folder, so moves stay on one volume.
  $tmp = Join-Path $dir ('.tmp-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    # ---- Node --------------------------------------------------------------------------
    Write-Step 'Node'
    $node = $null
    if (-not $PrivateNode) {
      $found = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($found) {
        $major = Get-NodeMajor $found.Path
        if ($major -ge $NodeMajor) {
          $node = ([string](Invoke-Native $found.Path @('-p', 'process.execPath') -Quiet)).Trim()
          Write-Say "using $node (v$(Invoke-Native $node @('-p', 'process.versions.node') -Quiet))"
        } else {
          Write-Say "the node on your PATH is version $major; Open3DJ needs $NodeMajor or newer"
        }
      } else {
        Write-Say "no node on your PATH; Open3DJ needs Node $NodeMajor or newer"
      }
    } else {
      Write-Say "-PrivateNode: Open3DJ gets its own Node $NodeMajor"
    }

    if (-not $node) {
      $choice = 'private'
      if ($UseWinget) { $choice = 'winget' }
      elseif (-not $Yes -and -not $PrivateNode -and (Test-Interactive)) {
        Write-Say ''
        Write-Say "  [1] Download Node $NodeMajor from nodejs.org into $dir\node, only for Open3DJ (recommended, no admin)"
        Write-Say '  [2] Install Node LTS for every program with winget (may ask for admin rights)'
        Write-Say '  [3] Cancel'
        $answer = Read-Host 'Choose 1, 2 or 3 [1]'
        if ($answer -match '^\s*2') { $choice = 'winget' }
        elseif ($answer -match '^\s*3') { Fail "cancelled. Open3DJ needs Node $NodeMajor; install it from https://nodejs.org and run this again." }
      }

      if ($choice -eq 'winget') {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $winget) {
          Write-Say 'winget is not available; using a private Node instead'
        } else {
          $show = (Invoke-Native $winget.Path @('show', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-source-agreements') -Quiet) | Out-String
          $ltsMajor = 0
          if ($show -match '(?mi)^\s*version\s*:\s*v?(\d+)\.') { $ltsMajor = [int]$Matches[1] }
          if ($ltsMajor -lt $NodeMajor) {
            Write-Say "winget offers Node LTS $ltsMajor, which is older than $NodeMajor; using a private Node instead"
          } else {
            Write-Say "installing Node LTS $ltsMajor with winget"
            Invoke-Native $winget.Path @('install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-source-agreements', '--accept-package-agreements')
            $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
            # Each operand is its own @() array: with one node.exe on PATH, string + string
            # would join the two paths into one.
            $candidates = @(Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }) + @(Join-Path $env:ProgramFiles 'nodejs\node.exe')
            foreach ($c in $candidates) {
              if ($c -and (Test-Path -LiteralPath $c) -and (Get-NodeMajor $c) -ge $NodeMajor) { $node = $c; break }
            }
            if (-not $node) { Write-Say 'winget did not leave a Node 24 on PATH; using a private Node instead' }
          }
        }
      }

      if (-not $node) {
        $base = "$NodeDist/latest-v$NodeMajor.x"
        $sums = Get-Text "$base/SHASUMS256.txt"
        $pattern = "(?m)^([0-9a-f]{64})\s+(node-(v$NodeMajor\.\d+\.\d+)-win-$arch\.zip)\s*$"
        $m = [regex]::Match($sums, $pattern)
        if (-not $m.Success) { Fail "nodejs.org has no Node $NodeMajor zip for win-$arch" }
        $want = $m.Groups[1].Value
        $file = $m.Groups[2].Value
        $version = $m.Groups[3].Value
        $privateNode = Join-Path $dir 'node\node.exe'
        $have = ''
        if (Test-Path -LiteralPath $privateNode) { try { $have = ([string](Invoke-Native $privateNode @('--version') -Quiet)).Trim() } catch { } }
        if ($have -eq $version) {
          Write-Say "private Node $version is up to date"
        } else {
          Write-Say "downloading Node $version for win-$arch from nodejs.org"
          $zip = Join-Path $tmp $file
          Save-Url "$base/$file" $zip
          $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
          if ($got -ne $want) { Fail "SHA-256 mismatch for ${file}: expected $want, got $got. Nothing was installed." }
          Write-Say "SHA-256 matches SHASUMS256.txt ($want)"
          Expand-Zip $zip (Join-Path $tmp 'node')
          Remove-Tree (Join-Path $dir 'node.old')
          if (Test-Path -LiteralPath (Join-Path $dir 'node')) {
            if (-not (Rename-WithRetry (Join-Path $dir 'node') 'node.old')) { Fail "the private Node is in use. Close programs that use Open3DJ (an MCP client such as Claude Desktop) and run this again." }
          }
          Move-Item -LiteralPath (Join-Path $tmp "node\node-$version-win-$arch") (Join-Path $dir 'node')
          Remove-Tree (Join-Path $dir 'node.old')
          Write-Say "Node $version is in $dir\node (private to Open3DJ)"
        }
        $node = $privateNode
      }
    }
    $nodeDir = Split-Path -Parent $node

    # ---- source ------------------------------------------------------------------------
    Write-Step 'Open3DJ source'
    $src = Join-Path $tmp 'src'
    $commit = ''
    if ($Source) {
      Write-Say "copying $from (without node_modules, .git and project folders that runs made)"
      # /XJ: never follow a junction or link out of the source folder.
      Invoke-Native robocopy.exe @($from, $src, '/E', '/XJ', '/XD', 'node_modules', '.git', '*.o3j', '.o3j-cache', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1') | Out-Null
      if ($LASTEXITCODE -ge 8) { Fail "could not copy $from (robocopy exit code $LASTEXITCODE)" }
      $global:LASTEXITCODE = 0
      $git = Get-Command git.exe -ErrorAction SilentlyContinue
      if ($git) {
        $c = Invoke-Native $git.Path @('-C', $from, 'rev-parse', 'HEAD') -Quiet
        if ($LASTEXITCODE -eq 0) { $commit = ([string]$c).Trim() }
      }
      $kind = 'local'
    } else {
      # Pin the ref to a commit first, so install.json and doctor --report name what was installed.
      try { $commit = (Get-Text "https://api.github.com/repos/$Repo/commits/$Ref" @{ Accept = 'application/vnd.github.sha' }).Trim() } catch { $commit = '' }
      if ($commit -notmatch '^[0-9a-f]{40}$') { $commit = '' }
      $what = if ($commit) { $commit } else { $Ref }
      Write-Say "downloading $Repo at $Ref$(if ($commit) { " (commit $commit)" })"
      $zip = Join-Path $tmp 'source.zip'
      Save-Url "https://codeload.github.com/$Repo/zip/$what" $zip
      Expand-Zip $zip (Join-Path $tmp 'unzipped')
      $top = Get-ChildItem -LiteralPath (Join-Path $tmp 'unzipped') -Directory | Select-Object -First 1
      if (-not $top -or -not (Test-Path -LiteralPath (Join-Path $top.FullName 'packages\open3dj\src\cli.ts'))) { Fail "the archive for $Ref does not hold Open3DJ" }
      Move-Item -LiteralPath $top.FullName $src
      $kind = 'github'
    }

    # ---- app and dependencies ----------------------------------------------------------
    Write-Step 'Dependencies'
    $app = Join-Path $dir 'app'
    $old = Join-Path $dir 'app.old'
    Remove-Tree $old
    if (Test-Path -LiteralPath $app) {
      if (-not (Rename-WithRetry $app 'app.old')) { Fail 'Open3DJ is in use. Close programs that use it (an MCP client such as Claude Desktop, or a running open3dj view) and run this again.' }
    }
    Move-Item -LiteralPath $src $app
    $npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
    $npmArgs = @('ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--update-notifier=false', '--loglevel=error')
    $savedPath = $env:Path
    $env:Path = "$nodeDir;$env:Path"
    Push-Location $app
    try {
      # Only runtime dependencies, and no install scripts (none of them needs one).
      if (Test-Path -LiteralPath $npmCli) { Invoke-Native $node (@($npmCli) + $npmArgs) }
      else {
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npm) { $global:LASTEXITCODE = 1; Write-Say "npm was not found next to $node. Run again with -PrivateNode." }
        else { Invoke-Native $npm.Path $npmArgs }
      }
      $npmExit = $LASTEXITCODE
    } finally {
      Pop-Location
      $env:Path = $savedPath
    }
    function Restore-App {
      Remove-Tree $app
      if (Test-Path -LiteralPath $old) { Rename-Item -LiteralPath $old 'app'; Write-Say 'the previous install is unchanged' }
    }
    if ($npmExit -ne 0) {
      Restore-App
      Write-Say 'npm does not use the Windows proxy settings. Behind a company proxy, set HTTPS_PROXY (for example $env:HTTPS_PROXY = ''http://proxy.example:8080''); if the proxy inspects HTTPS (UNABLE_TO_GET_ISSUER_CERT_LOCALLY), also set $env:NODE_OPTIONS = ''--use-system-ca''. Then run this again.'
      Fail 'npm ci failed (see above)'
    }
    $cli = Join-Path $app 'packages\open3dj\src\cli.ts'
    $version = Invoke-Native $node @($cli, '--version')
    if ($LASTEXITCODE -ne 0) { Restore-App; Fail 'open3dj does not start; see the error above' }
    Remove-Tree $old
    $version = ([string]$version).Trim()
    Write-Say "open3dj $version in $app"

    # ---- commands ----------------------------------------------------------------------
    Write-Step 'Command'
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    # Only open3dj.cmd, which cmd.exe, Windows PowerShell 5.1 and PowerShell 7 all run. An
    # open3dj.ps1 would win over it in PowerShell, and the two PowerShell editions keep separate
    # execution policies: a .ps1 that PowerShell 7 allows can fail in Windows PowerShell 5.1
    # with "running scripts is disabled on this system".
    [IO.File]::WriteAllText((Join-Path $bin 'open3dj.cmd'), (New-CmdShimText $node $cli $dir), [Text.Encoding]::ASCII)
    $ps1Path = Join-Path $bin 'open3dj.ps1'
    if (Test-Shim $ps1Path) { Remove-Item -LiteralPath $ps1Path -Force }
    Write-Say "wrote $bin\open3dj.cmd"

    $info = [ordered]@{
      installer = 'install.ps1'
      node = $node
      cli = $cli
      app = $app
      shim = (Join-Path $bin 'open3dj.cmd')
      ref = $Ref
      source = $kind
      installed = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    if ($commit) { $info.commit = $commit }
    [IO.File]::WriteAllText((Join-Path $dir 'install.json'), (($info | ConvertTo-Json) + "`n"), (New-Object Text.UTF8Encoding $false))

    if (-not $NoPath) {
      # An earlier install in another -InstallDir would come first on PATH and shadow this one.
      $entries = @((Get-UserPath) -split ';' | Where-Object { $_ })
      $others = @($entries | Where-Object { -not (Test-SamePath $_ $bin) -and (Test-Shim (Join-Path ([Environment]::ExpandEnvironmentVariables($_)) 'open3dj.cmd')) })
      foreach ($o in $others) {
        Write-Say "removed $o from your user PATH: it holds the open3dj command of another Open3DJ install. Its folder is still there; remove it with its own install.ps1 -Uninstall -InstallDir."
      }
      $entries = @($entries | Where-Object { $e = $_; -not ($others | Where-Object { $_ -eq $e }) })
      $added = $false
      if (-not ($entries | Where-Object { Test-SamePath $_ $bin })) {
        $entries += $bin
        $added = $true
        Write-Say "added $bin to your user PATH"
      }
      if ($added -or $others.Count -gt 0) { Set-UserPath ($entries -join ';') }
      # Setting a user variable also tells Windows that the environment changed, so new
      # terminals see the PATH entry without signing out.
      [Environment]::SetEnvironmentVariable('OPEN3DJ_INSTALL_DIR', $dir, 'User')
    }
    if (-not (@($env:Path -split ';' | Where-Object { $_ -and (Test-SamePath $_ $bin) }).Count)) { $env:Path = "$bin;$env:Path" }

    # ---- check -------------------------------------------------------------------------
    Write-Step 'open3dj doctor'
    Invoke-Native (Join-Path $bin 'open3dj.cmd') @('doctor')
    if ($LASTEXITCODE -ne 0) { Fail 'open3dj is installed, but open3dj doctor failed (see above)' }

    $designs = Join-Path $env:USERPROFILE 'open3dj-designs'
    $desktop = [ordered]@{ command = $node; args = @($cli, 'mcp', '--root', $designs) } | ConvertTo-Json -Compress
    $uninstallCmd = "powershell -ExecutionPolicy Bypass -File `"$app\scripts\install\install.ps1`" -Uninstall"
    if (-not (Test-SamePath $dir $DefaultDir)) { $uninstallCmd += " -InstallDir `"$dir`"" }
    $shortCommit = if ($commit) { " (commit $($commit.Substring(0, 12)))" } else { '' }
    Write-Say ''
    Write-Say "Open3DJ $version is installed$shortCommit."
    if ($NoPath) { Write-Say "$bin is not on your PATH. Run open3dj as $bin\open3dj.cmd, or add the folder yourself." }
    else { Write-Say 'Open a new terminal so that open3dj is on your PATH.' }
    Write-Say @"

Try it:
  mkdir `$env:USERPROFILE\open3dj-designs; cd `$env:USERPROFILE\open3dj-designs
  copy "$app\examples\bracket\bracket.o3j.js" .
  open3dj run bracket.o3j.js
  open3dj view bracket.o3j.js          # opens the 3D viewer in your browser

Connect an agent (the server runs with this Node, so no PATH is needed):
  Claude Code:     claude mcp add open3dj -- "$node" "$cli" mcp
  Claude Desktop:  add this under "mcpServers" in claude_desktop_config.json, with your designs folder as --root:
    "open3dj": $desktop
  More clients:    $app\docs\GETTING-STARTED.md

Tell us how it went. Every report helps, and so does "it just worked":
  open3dj doctor --report     prints a hardware report to paste into
  $ReportUrl

Upgrade: run this installer again.
Uninstall: $uninstallCmd
"@
  } finally {
    # A failure here must not hide the error that got us here.
    try { Remove-Tree $tmp } catch { Write-Warning "could not remove the temporary folder $tmp" }
  }
}

Invoke-Open3DJInstaller
