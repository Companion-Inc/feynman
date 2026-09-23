param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,

  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Get-SubstMappings {
  $output = @(& subst.exe 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not enumerate subst mappings (exit $LASTEXITCODE)."
  }

  return @(
    $output |
      ForEach-Object { $_.ToString().Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Sort-Object
  )
}

function Mount-OccupiedTestDrive {
  param([string]$TargetPath)

  for ($code = [int][char]"Z"; $code -ge [int][char]"D"; $code -= 1) {
    $letter = ([char]$code).ToString()
    $drive = "${letter}:"
    if (Get-PSDrive -Name $letter -PSProvider FileSystem -ErrorAction SilentlyContinue) {
      continue
    }

    & subst.exe $drive $TargetPath 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $driveRoot = "$drive\"
      if (Test-Path -LiteralPath $driveRoot) {
        return $driveRoot
      }
      & subst.exe $drive /D 2>$null | Out-Null
    }
  }

  throw "Could not allocate a subst drive to verify occupied-drive fallback."
}

function Dismount-OccupiedTestDrive {
  param([string]$DriveRoot)

  if (-not $DriveRoot) {
    return
  }

  $drive = $DriveRoot.Substring(0, 2)
  $lastExitCode = $null
  for ($attempt = 1; $attempt -le 5; $attempt += 1) {
    & subst.exe $drive /D 2>$null | Out-Null
    $lastExitCode = $LASTEXITCODE
    if ($lastExitCode -eq 0 -or -not (Test-Path -LiteralPath $DriveRoot)) {
      return
    }
    if ($attempt -lt 5) {
      Start-Sleep -Milliseconds (100 * $attempt)
    }
  }

  throw "Could not remove occupied-drive fixture $drive (exit $lastExitCode)."
}

function Remove-TestPathWithRetry {
  param([string]$Path)

  if (-not $Path) {
    return
  }

  $lastError = $null
  for ($attempt = 1; $attempt -le 5; $attempt += 1) {
    try {
      if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      }
      if (-not (Test-Path -LiteralPath $Path)) {
        return
      }
      $lastError = New-Object System.IO.IOException -ArgumentList (
        "Path still exists after cleanup attempt ${attempt}: $Path"
      )
    } catch {
      $lastError = $_
    }
    if ($attempt -lt 5) {
      Start-Sleep -Milliseconds (100 * $attempt)
    }
  }

  throw $lastError
}

function Restore-ProcessEnvironmentVariable {
  param(
    [string]$Name,
    [AllowNull()]
    [string]$Value
  )

  if ($null -eq $Value) {
    Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item -Path "Env:$Name" -Value $Value
  }
}

$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
if ((Get-Item -LiteralPath $archive).Length -eq 0) {
  throw "Native archive is empty: $archive"
}

$baseTemp = if ($env:RUNNER_TEMP) {
  $env:RUNNER_TEMP
} else {
  [System.IO.Path]::GetTempPath()
}
$testRoot = Join-Path $baseTemp ("feynman-installer-" + [guid]::NewGuid().ToString("N"))
$serverScript = Join-Path $testRoot "serve-feynman-archive.mjs"
$portFile = Join-Path $testRoot "archive-port.txt"
$checksumFile = Join-Path $testRoot "SHA256SUMS"
$serverJob = $null
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$originalLocalAppData = $env:LOCALAPPDATA
$originalFeynmanHome = $env:FEYNMAN_HOME
$originalInstallBaseUrl = $env:FEYNMAN_INSTALL_BASE_URL
$originalNoProxy = $env:NO_PROXY
$originalPath = $env:PATH
$originalSubstMappings = @(Get-SubstMappings)
$occupiedDriveRoot = $null
$verificationError = $null

try {
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
  $longTempRoot = Join-Path $testRoot ("long-temp-" + ("x" * 96))
  New-Item -ItemType Directory -Path $longTempRoot -Force | Out-Null
  if ($longTempRoot.Length -lt 120) {
    throw "Windows installer verifier did not create a sufficiently long TEMP path."
  }
  $env:TEMP = $longTempRoot
  $env:TMP = $longTempRoot
  $env:LOCALAPPDATA = Join-Path $testRoot "LocalAppData"
  $env:FEYNMAN_HOME = Join-Path $testRoot "FeynmanHome"
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null
  $occupiedDriveRoot = Mount-OccupiedTestDrive -TargetPath $testRoot
  $expectedSubstMappings = @(Get-SubstMappings)

  function Assert-NoInstallerStagingLeaks {
    if (
      -not [string]::Equals(
        $env:TEMP,
        $longTempRoot,
        [System.StringComparison]::OrdinalIgnoreCase
      ) -or
      -not [string]::Equals(
        $env:TMP,
        $longTempRoot,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    ) {
      throw "Installer did not restore the verifier's long TEMP/TMP values."
    }

    $actualMappings = @(Get-SubstMappings)
    $expectedMappingText = ($expectedSubstMappings | Sort-Object) -join "`n"
    $actualMappingText = ($actualMappings | Sort-Object) -join "`n"
    if (-not [string]::Equals($actualMappingText, $expectedMappingText, [System.StringComparison]::Ordinal)) {
      throw "Installer leaked or removed a subst mapping. Expected '$expectedMappingText'; found '$actualMappingText'."
    }

    if (-not (Test-Path -LiteralPath $occupiedDriveRoot)) {
      throw "Installer removed the occupied subst drive instead of selecting another free drive."
    }

    $stageLeaks = @(
      Get-ChildItem `
        -LiteralPath $env:LOCALAPPDATA `
        -Directory `
        -Filter "feynman-stage-*" `
        -ErrorAction SilentlyContinue
    )
    if ($stageLeaks.Count -ne 0) {
      throw "Installer leaked same-volume staging roots: $($stageLeaks.FullName -join ', ')"
    }
  }

  $archiveName = Split-Path -Leaf $archive
  $servedArchive = Join-Path $testRoot $archiveName
  Copy-Item -LiteralPath $archive -Destination $servedArchive
  $activeArchiveSha256 = (Get-FileHash -LiteralPath $servedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  "$activeArchiveSha256  $archiveName" | Set-Content -LiteralPath $checksumFile -Encoding ASCII
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($servedArchive)
  try {
    $longestEntry = $zip.Entries |
      Where-Object { -not [string]::IsNullOrEmpty($_.Name) } |
      Sort-Object { $_.FullName.Length } -Descending |
      Select-Object -First 1
    if (-not $longestEntry) {
      throw "Native archive contains no files"
    }
    $shortDriveRootLength = 3
    $extractDirectoryLength = "extract".Length
    $longestExtractedPathLength = `
      $shortDriveRootLength +
      $extractDirectoryLength +
      1 +
      $longestEntry.FullName.Replace("/", "\").Length
    if ($longestExtractedPathLength -ge 260) {
      throw "Native archive exceeds the short-drive Windows MAX_PATH safety budget: $longestExtractedPathLength characters"
    }
  } finally {
    $zip.Dispose()
  }
  @'
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";

const archive = process.env.ARCHIVE_PATH;
const checksumFile = process.env.CHECKSUM_PATH;
const portFile = process.env.ARCHIVE_PORT_FILE;
const archiveName = basename(archive);
const checksumName = basename(checksumFile);
const server = createServer((request, response) => {
  const pathname = new URL(
    request.url ?? "/",
    "http://127.0.0.1",
  ).pathname;

  if (pathname === "/healthz") {
    response.writeHead(204);
    response.end();
    return;
  }

  const source = pathname === `/${archiveName}`
    ? archive
    : pathname === `/${checksumName}`
      ? checksumFile
      : undefined;
  if (!source) {
    response.writeHead(404);
    response.end("not found");
    return;
  }

  if (source === checksumFile) {
    const body = readFileSync(source);
    response.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Length": body.byteLength,
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  const size = statSync(source).size;
  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Length": size,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(source).pipe(response);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine local archive server port");
  }
  writeFileSync(portFile, String(address.port));
});
'@ | Set-Content -LiteralPath $serverScript -Encoding utf8

  $serverJob = Start-Job -ScriptBlock {
    param($script, $archivePath, $checksumsPath, $serverPortFile)
    $env:ARCHIVE_PATH = $archivePath
    $env:CHECKSUM_PATH = $checksumsPath
    $env:ARCHIVE_PORT_FILE = $serverPortFile
    & node $script
    if ($LASTEXITCODE -ne 0) {
      throw "Local archive server failed: $LASTEXITCODE"
    }
  } -ArgumentList $serverScript, $servedArchive, $checksumFile, $portFile

  $baseUrl = $null
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    if (Test-Path -LiteralPath $portFile) {
      $port = (Get-Content -LiteralPath $portFile -Raw).Trim()
      if ($port -match "^\d+$") {
        $baseUrl = "http://127.0.0.1:$port"
        break
      }
    }

    if ($serverJob.State -eq "Failed" -or $serverJob.State -eq "Completed") {
      Receive-Job -Job $serverJob
      throw "Local archive server exited before becoming ready"
    }
    Start-Sleep -Seconds 1
  }

  if (-not $baseUrl) {
    Receive-Job -Job $serverJob
    throw "Local archive server did not publish a listening port"
  }

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    try {
      $response = Invoke-WebRequest `
        -Uri "$baseUrl/healthz" `
        -UseBasicParsing `
        -TimeoutSec 2
      if ($response.StatusCode -eq 204) {
        $ready = $true
        break
      }
    } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw "Local archive server did not become ready"
  }

  $env:FEYNMAN_INSTALL_BASE_URL = $baseUrl
  $env:NO_PROXY = "127.0.0.1,localhost"

  $installerSource = Get-Content `
    -LiteralPath "scripts/install/install.ps1" `
    -Raw
  $installer = [scriptblock]::Create($installerSource)

  $installRoot = Join-Path $env:LOCALAPPDATA "Programs\feynman"
  $installBinDir = Join-Path $installRoot "bin"
  $bundleDir = Join-Path $installRoot "feynman-$Version-win32-x64"
  $shim = Join-Path $installRoot "bin\feynman.cmd"
  $shimPs1 = Join-Path $installRoot "bin\feynman.ps1"
  $bundleCmd = Join-Path $bundleDir "feynman.cmd"
  $bundlePs1 = Join-Path $bundleDir "feynman.ps1"

  function Assert-InstalledCandidate {
    if (Test-Path -LiteralPath $shimPs1) {
      throw "PATH bin must not contain a policy-blocked feynman.ps1 shim: $shimPs1"
    }

    $launchers = @($shim, $bundleCmd)
    foreach ($launcher in $launchers) {
      if (-not (Test-Path -LiteralPath $launcher)) {
        throw "Installed launcher is missing: $launcher"
      }

      $versionOutput = @(& $launcher --version 2>&1)
      $versionExit = $LASTEXITCODE
      if ($versionExit -ne 0) {
        throw "Installed feynman --version failed for ${launcher}: $versionExit"
      }
      $actualVersion = ($versionOutput | Select-Object -Last 1).ToString().Trim()
      if ($actualVersion -ne $Version) {
        throw "Version mismatch for ${launcher}: expected=$Version actual=$actualVersion"
      }

      $helpOutput = @(& $launcher --help 2>&1)
      $helpExit = $LASTEXITCODE
      if ($helpExit -ne 0) {
        throw "Installed feynman --help failed for ${launcher}: $helpExit"
      }
      if ($helpOutput.Count -eq 0) {
        throw "Installed feynman --help returned no output for $launcher"
      }
      $helpOutput | Select-Object -First 20
    }

    if (-not (Test-Path -LiteralPath $bundlePs1)) {
      throw "Installed bundle PowerShell launcher is missing: $bundlePs1"
    }
    $powerShellExecutable = (Get-Process -Id $PID).Path
    $ps1VersionOutput = @(
      & $powerShellExecutable -NoProfile -ExecutionPolicy Bypass -File $bundlePs1 --version 2>&1
    )
    if ($LASTEXITCODE -ne 0) {
      throw "Installed bundle PowerShell launcher failed --version: $bundlePs1"
    }
    $actualPs1Version = ($ps1VersionOutput | Select-Object -Last 1).ToString().Trim()
    if ($actualPs1Version -ne $Version) {
      throw "Version mismatch for ${bundlePs1}: expected=$Version actual=$actualPs1Version"
    }
  }

  function Assert-BareRestrictedLauncher {
    foreach ($hostName in @("powershell.exe", "pwsh")) {
      $hostCommand = Get-Command $hostName -ErrorAction SilentlyContinue
      if (-not $hostCommand) {
        continue
      }
      $versionOutput = @(
        & $hostCommand.Source `
          -NoProfile `
          -ExecutionPolicy Restricted `
          -Command "feynman --version; exit `$LASTEXITCODE" `
          2>&1
      )
      if ($LASTEXITCODE -ne 0) {
        throw "Bare feynman failed under Restricted policy in ${hostName}: $LASTEXITCODE"
      }
      $actualVersion = ($versionOutput | Select-Object -Last 1).ToString().Trim()
      if ($actualVersion -ne $Version) {
        throw "Bare feynman version mismatch under Restricted policy in ${hostName}: expected=$Version actual=$actualVersion"
      }
    }
  }

  & $installer -Version $Version
  Assert-NoInstallerStagingLeaks
  Assert-InstalledCandidate
  $env:PATH = "$installBinDir;$env:PATH"
  Assert-BareRestrictedLauncher

  $replacementSentinel = Join-Path $bundleDir "stale-replacement.sentinel"
  "must be removed" | Set-Content -LiteralPath $replacementSentinel

  & $installer -Version $Version
  Assert-NoInstallerStagingLeaks

  if (Test-Path -LiteralPath $replacementSentinel) {
    throw "Exact-candidate replacement retained the old bundle"
  }
  Assert-InstalledCandidate
  Assert-BareRestrictedLauncher

  # The exact release ZIP is large enough that repeatedly downloading and
  # extracting it can consume the entire hosted-runner timeout. The clean and
  # replacement passes above prove the real candidate in both PowerShell
  # hosts. Exercise checksum and rollback branches with a compact, valid bundle
  # so those same installer paths remain covered without ten redundant 530 MiB
  # transfers across the two hosts.
  $fixtureRoot = Join-Path $testRoot "compact-fixture"
  $fixtureBundleDir = Join-Path $fixtureRoot "feynman-$Version-win32-x64"
  $fixtureArchive = Join-Path $testRoot "compact-fixture.zip"
  New-Item -ItemType Directory -Path $fixtureBundleDir -Force | Out-Null
  @"
@echo off
if "%~1"=="--version" (
  echo $Version
  exit /b 0
)
if "%~1"=="--help" (
  echo Feynman installer verifier fixture
  exit /b 0
)
exit /b 0
"@ | Set-Content -LiteralPath (Join-Path $fixtureBundleDir "feynman.cmd") -Encoding ASCII
  @"
if (`$args[0] -eq "--version") {
  Write-Output "$Version"
  exit 0
}
if (`$args[0] -eq "--help") {
  Write-Output "Feynman installer verifier fixture"
  exit 0
}
exit 0
"@ | Set-Content -LiteralPath (Join-Path $fixtureBundleDir "feynman.ps1") -Encoding UTF8
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($fixtureRoot, $fixtureArchive)
  $fixtureZip = [System.IO.Compression.ZipFile]::Open(
    $fixtureArchive,
    [System.IO.Compression.ZipArchiveMode]::Update
  )
  try {
    $reportedAwsEntryName = "feynman-$Version-win32-x64/app/node_modules/@earendil-works/pi-coding-agent/node_modules/@aws-sdk/core/dist-es/submodules/client/middleware-recursion-detection/getRecursionDetectionPlugin.browser.js"
    $longEntryPrefix = "feynman-$Version-win32-x64/app/node_modules/@earendil-works/pi-coding-agent/node_modules/path-budget/"
    $longEntrySuffix = ".js"
    $maximumExtractedPathLength = 259
    $maximumArchiveEntryLength = `
      $maximumExtractedPathLength -
      $shortDriveRootLength -
      $extractDirectoryLength -
      1
    $longEntryPaddingLength = `
      $maximumArchiveEntryLength -
      $longEntryPrefix.Length -
      $longEntrySuffix.Length
    if ($longEntryPaddingLength -le 0) {
      throw "Long-path fixture prefix leaves no room inside the Windows MAX_PATH boundary."
    }
    $longEntryName = `
      $longEntryPrefix +
      ("x" * $longEntryPaddingLength) +
      $longEntrySuffix
    $longFixtureExtractedPathLength = `
      $shortDriveRootLength +
      $extractDirectoryLength +
      1 +
      $longEntryName.Replace("/", "\").Length
    if ($longFixtureExtractedPathLength -ne $maximumExtractedPathLength) {
      throw "Long-path fixture did not reach the calculated Windows MAX_PATH boundary: $longFixtureExtractedPathLength"
    }
    foreach ($fixtureEntryName in @($reportedAwsEntryName, $longEntryName)) {
      $fixtureEntry = $fixtureZip.CreateEntry($fixtureEntryName)
      $fixtureEntryStream = $fixtureEntry.Open()
      try {
        $fixtureEntryStream.WriteByte(0)
      } finally {
        $fixtureEntryStream.Dispose()
      }
    }
  } finally {
    $fixtureZip.Dispose()
  }
  Copy-Item -LiteralPath $fixtureArchive -Destination $servedArchive -Force
  $activeArchiveSha256 = (
    Get-FileHash -LiteralPath $servedArchive -Algorithm SHA256
  ).Hash.ToLowerInvariant()
  "$activeArchiveSha256  $archiveName" |
    Set-Content -LiteralPath $checksumFile -Encoding ASCII

  & $installer -Version $Version
  Assert-NoInstallerStagingLeaks
  Assert-InstalledCandidate
  $installedReportedAwsFixture = Join-Path $installRoot ($reportedAwsEntryName.Replace("/", "\"))
  if (-not (Test-Path -LiteralPath $installedReportedAwsFixture)) {
    throw "Successful compact replacement did not install the reported AWS fixture entry."
  }
  $installedLongFixture = Join-Path $installRoot ($longEntryName.Replace("/", "\"))
  if (-not (Test-Path -LiteralPath $installedLongFixture)) {
    throw "Successful compact replacement did not install the MAX_PATH boundary fixture entry."
  }

  $duplicateSentinel = Join-Path $bundleDir "duplicate-checksum-must-preserve.sentinel"
  "must remain" | Set-Content -LiteralPath $duplicateSentinel
  $conflictingChecksum = "0" * 64
  foreach ($checksumLines in @(
    @("$activeArchiveSha256  $archiveName", "$conflictingChecksum  $archiveName"),
    @("$conflictingChecksum  $archiveName", "$activeArchiveSha256  $archiveName")
  )) {
    $checksumLines | Set-Content -LiteralPath $checksumFile -Encoding ASCII
    $duplicateRejected = $false
    try {
      & $installer -Version $Version
    } catch {
      $duplicateRejected = $_.Exception.Message -match "multiple checksum entries"
    }
    Assert-NoInstallerStagingLeaks
    if (-not $duplicateRejected) {
      throw "Installer did not reject duplicate checksum entries"
    }
    if (-not (Test-Path -LiteralPath $duplicateSentinel)) {
      throw "Duplicate checksum entries replaced the prior installed bundle"
    }
  }

  "$activeArchiveSha256  $archiveName" | Set-Content -LiteralPath $checksumFile -Encoding ASCII
  $backupFailureSentinel = Join-Path $bundleDir "backup-failure-must-preserve.sentinel"
  "must remain" | Set-Content -LiteralPath $backupFailureSentinel
  $env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_BACKUP = "1"
  $backupFailureRejected = $false
  try {
    & $installer -Version $Version
  } catch {
    $backupFailureRejected = $_.Exception.Message -match "Injected installer failure after bundle backup"
  } finally {
    Remove-Item Env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_BACKUP -ErrorAction SilentlyContinue
  }
  Assert-NoInstallerStagingLeaks
  if (-not $backupFailureRejected) {
    throw "Installer did not surface the injected bundle-backup failure"
  }
  if (-not (Test-Path -LiteralPath $backupFailureSentinel)) {
    throw "Failed bundle backup removed the previous bundle"
  }
  Assert-InstalledCandidate

  $preservedSentinel = Join-Path $bundleDir "checksum-failure-must-preserve.sentinel"
  "must remain" | Set-Content -LiteralPath $preservedSentinel
  ("0" * 64) + "  $archiveName" | Set-Content -LiteralPath $checksumFile -Encoding ASCII
  $checksumRejected = $false
  try {
    & $installer -Version $Version
  } catch {
    $checksumRejected = $_.Exception.Message -match "SHA-256 mismatch"
  }
  Assert-NoInstallerStagingLeaks
  if (-not $checksumRejected) {
    throw "Installer did not reject a corrupted archive checksum"
  }
  if (-not (Test-Path -LiteralPath $preservedSentinel)) {
    throw "Checksum failure replaced the prior installed bundle"
  }

  $previousBundleDir = Join-Path $installRoot "feynman-previous-win32-x64"
  Move-Item -LiteralPath $bundleDir -Destination $previousBundleDir
  @"
@echo off
CALL "$previousBundleDir\feynman.cmd" %*
"@ | Set-Content -LiteralPath $shim -Encoding ASCII
  $upgradeSentinel = Join-Path $previousBundleDir "upgrade-failure-must-preserve.sentinel"
  "must remain" | Set-Content -LiteralPath $upgradeSentinel
  "$activeArchiveSha256  $archiveName" | Set-Content -LiteralPath $checksumFile -Encoding ASCII

  $env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_SWAP = "1"
  $upgradeFailureRejected = $false
  try {
    & $installer -Version $Version
  } catch {
    $upgradeFailureRejected = $_.Exception.Message -match "Injected installer failure"
  } finally {
    Remove-Item Env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_SWAP -ErrorAction SilentlyContinue
  }
  Assert-NoInstallerStagingLeaks
  if (-not $upgradeFailureRejected) {
    throw "Installer did not surface the injected upgrade failure"
  }
  if (Test-Path -LiteralPath $bundleDir) {
    throw "Failed upgrade retained the replacement bundle"
  }
  if (-not (Test-Path -LiteralPath $upgradeSentinel)) {
    throw "Failed upgrade removed the previous bundle"
  }
  foreach ($launcher in @($shim)) {
    $versionOutput = @(& $launcher --version 2>&1)
    $versionExit = $LASTEXITCODE
    if ($versionExit -ne 0) {
      throw "Restored launcher failed after injected upgrade failure: $launcher"
    }
    $actualVersion = ($versionOutput | Select-Object -Last 1).ToString().Trim()
    if ($actualVersion -ne $Version) {
      throw "Restored launcher version mismatch after injected failure: $launcher"
    }
  }
} catch {
  $verificationError = $_
  throw
} finally {
  $cleanupError = $null
  $environmentVariables = @(
    [PSCustomObject]@{ Name = "TEMP"; Value = $originalTemp }
    [PSCustomObject]@{ Name = "TMP"; Value = $originalTmp }
    [PSCustomObject]@{ Name = "LOCALAPPDATA"; Value = $originalLocalAppData }
    [PSCustomObject]@{ Name = "FEYNMAN_HOME"; Value = $originalFeynmanHome }
    [PSCustomObject]@{ Name = "FEYNMAN_INSTALL_BASE_URL"; Value = $originalInstallBaseUrl }
    [PSCustomObject]@{ Name = "NO_PROXY"; Value = $originalNoProxy }
    [PSCustomObject]@{ Name = "PATH"; Value = $originalPath }
  )
  foreach ($environmentVariable in $environmentVariables) {
    try {
      Restore-ProcessEnvironmentVariable `
        -Name $environmentVariable.Name `
        -Value $environmentVariable.Value
    } catch {
      if (-not $cleanupError) {
        $cleanupError = $_
      }
    }
  }
  try {
    if ($serverJob) {
      Stop-Job -Job $serverJob -ErrorAction SilentlyContinue
      Receive-Job -Job $serverJob -ErrorAction SilentlyContinue
      Remove-Job -Job $serverJob -Force -ErrorAction SilentlyContinue
    }
  } catch {
    if (-not $cleanupError) {
      $cleanupError = $_
    }
  }
  try {
    if ($occupiedDriveRoot) {
      Get-ChildItem -LiteralPath $occupiedDriveRoot -Force -ErrorAction Stop |
        ForEach-Object { Remove-TestPathWithRetry -Path $_.FullName }
    }
  } catch {
    if (-not $cleanupError) {
      $cleanupError = $_
    }
  }
  $occupiedDriveDismounted = -not $occupiedDriveRoot
  try {
    Dismount-OccupiedTestDrive -DriveRoot $occupiedDriveRoot
    $occupiedDriveDismounted = $true
  } catch {
    if (-not $cleanupError) {
      $cleanupError = $_
    }
  }
  try {
    $remainingSubstMappings = @(Get-SubstMappings)
    $originalMappingText = ($originalSubstMappings | Sort-Object) -join "`n"
    $remainingMappingText = ($remainingSubstMappings | Sort-Object) -join "`n"
    if (-not [string]::Equals($remainingMappingText, $originalMappingText, [System.StringComparison]::Ordinal)) {
      throw "Verifier leaked a subst mapping. Before '$originalMappingText'; after '$remainingMappingText'."
    }
  } catch {
    if (-not $cleanupError) {
      $cleanupError = $_
    }
  }
  try {
    if ($occupiedDriveDismounted) {
      Remove-TestPathWithRetry -Path $testRoot
    }
  } catch {
    if (-not $cleanupError) {
      $cleanupError = $_
    }
  }

  if ($cleanupError) {
    if ($verificationError) {
      Write-Warning "Windows installer verifier cleanup also failed: $($cleanupError.Exception.Message)"
    } else {
      throw $cleanupError
    }
  }
}
