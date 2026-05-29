param(
  [Parameter(Position = 0)]
  [ValidateSet("install", "update", "status", "uninstall")]
  [string]$Command = "install",
  [string]$HostVersion = "0.2.14",
  [string]$ReleaseTag = "latest",
  [string]$HelperSource = "",
  [switch]$SkipChecksum,
  [switch]$Json,
  [string]$ExtensionId = "mmbmjpmhmlkjknhcigafgplahdbicabe",
  [string]$Browser = "all",
  [string]$RegistryKey = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path variable:IsWindows)) {
  $IsWindows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
}

if (-not $IsWindows) {
  throw "HoverTransPort install.ps1 is supported only from PowerShell on Windows."
}

$HostName = "com.monklabs.hover_trans_port"
$AppDirName = "Hover Trans Port"
$HelperExecutableName = "hover-trans-port-helper.exe"
$InstallerFileName = "install-windows-native-host.ps1"
$ReleaseBaseUrl = if ($env:HOVER_TRANS_PORT_RELEASE_BASE_URL) {
  $env:HOVER_TRANS_PORT_RELEASE_BASE_URL.TrimEnd("/")
} else {
  "https://github.com/monk-lee/hover-trans-port/releases"
}
$PreviousVersion = ""
$InstallerTempDirs = @()

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  throw "HoverTransPort install.ps1 requires LOCALAPPDATA."
}

$InstallRoot = Join-Path $env:LOCALAPPDATA $AppDirName
$NativeHostsRoot = Join-Path $InstallRoot "native-hosts"
$VersionDir = Join-Path $NativeHostsRoot $HostVersion
$CurrentLink = Join-Path $InstallRoot "current"
$LauncherPath = Join-Path $InstallRoot "launcher.cmd"
$HelperPath = Join-Path $VersionDir $HelperExecutableName
$UpdaterPath = Join-Path $VersionDir "update-native-host.cmd"

$BrowserTargets = @(
  @{
    Id = "chrome"
    RegistryKey = "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName"
  },
  @{
    Id = "chromium"
    RegistryKey = "HKCU\Software\Chromium\NativeMessagingHosts\$HostName"
  },
  @{
    Id = "edge"
    RegistryKey = "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
  },
  @{
    Id = "brave"
    RegistryKey = "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName"
  },
  @{
    Id = "whale"
    RegistryKey = "HKCU\Software\Naver\Whale\NativeMessagingHosts\$HostName"
  },
  @{
    Id = "atlas"
    RegistryKey = "HKCU\Software\OpenAI\ChatGPT Atlas\NativeMessagingHosts\$HostName"
  },
  @{
    Id = "vivaldi"
    RegistryKey = "HKCU\Software\Vivaldi\NativeMessagingHosts\$HostName"
  }
)

function Get-SelectedBrowserTargets {
  param(
    [string]$Selection,
    [string]$CustomRegistryKey
  )

  $targetIds = @()
  if ([string]::IsNullOrWhiteSpace($Selection) -or $Selection.Trim().ToLowerInvariant() -eq "all") {
    $targetIds = @($BrowserTargets | ForEach-Object { $_["Id"] })
  } else {
    $seen = @{}
    foreach ($part in $Selection.Split(",")) {
      $id = $part.Trim().ToLowerInvariant()
      if ($id -and -not $seen.ContainsKey($id)) {
        $seen[$id] = $true
        $targetIds += $id
      }
    }
  }

  if ($targetIds.Count -eq 0) {
    throw "No browser targets selected."
  }

  $selected = @()
  foreach ($id in $targetIds) {
    $target = $BrowserTargets | Where-Object { $_["Id"] -eq $id } | Select-Object -First 1
    if (-not $target) {
      throw "Unsupported browser target: $id"
    }
    $selected += @{
      Id = $target["Id"]
      RegistryKey = $target["RegistryKey"]
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($CustomRegistryKey)) {
    if ($selected.Count -ne 1) {
      throw "-RegistryKey can only be used with one browser target."
    }
    $selected[0]["RegistryKey"] = $CustomRegistryKey
  }

  return $selected
}

function Get-ManifestPath {
  param([hashtable]$Target)

  $manifestDir = Join-Path (Join-Path $InstallRoot "NativeMessagingHosts") $Target["Id"]
  return Join-Path $manifestDir "$HostName.json"
}

function Get-ManifestPaths {
  param([array]$Targets)

  return @($Targets | ForEach-Object { Get-ManifestPath $_ })
}

function Get-ReleaseAssetUrl {
  param([string]$AssetName)

  if ($ReleaseTag -eq "latest") {
    return "$ReleaseBaseUrl/latest/download/$AssetName"
  }

  return "$ReleaseBaseUrl/download/$ReleaseTag/$AssetName"
}

function Get-HelperAssetName {
  $arch = if ($env:PROCESSOR_ARCHITEW6432) {
    $env:PROCESSOR_ARCHITEW6432
  } else {
    $env:PROCESSOR_ARCHITECTURE
  }

  switch ($arch) {
    "AMD64" { return "hover-trans-port-helper-windows-x64.exe" }
    "ARM64" { return "hover-trans-port-helper-windows-arm64.exe" }
    default { throw "install.ps1: unsupported architecture: windows/$arch" }
  }
}

function Save-Url {
  param(
    [string]$Url,
    [string]$Destination
  )

  Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

function Write-Stderr {
  param([string]$Message)

  [Console]::Error.WriteLine($Message)
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Clear-InstallerTempDirs {
  foreach ($tempDir in $script:InstallerTempDirs) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  $script:InstallerTempDirs = @()
}

function Test-HelperChecksum {
  param(
    [string]$AssetName,
    [string]$HelperFile,
    [string]$ChecksumsFile
  )

  $line = Get-Content -LiteralPath $ChecksumsFile | Where-Object {
    $_ -match "\s$([regex]::Escape($AssetName))$"
  } | Select-Object -First 1

  if (-not $line) {
    throw "checksums.txt does not include $AssetName"
  }

  $expected = ($line -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $HelperFile).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    throw "checksum verification failed for $AssetName"
  }
}

function Resolve-HelperSource {
  if (-not [string]::IsNullOrWhiteSpace($HelperSource)) {
    if (-not (Test-Path -LiteralPath $HelperSource -PathType Leaf)) {
      throw "install.ps1: helper source does not exist: $HelperSource"
    }
    return (Resolve-Path -LiteralPath $HelperSource).Path
  }

  $assetName = Get-HelperAssetName
  if (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
    $scriptDir = Split-Path -Parent $PSCommandPath
    $bundled = Join-Path $scriptDir $assetName
    if (Test-Path -LiteralPath $bundled -PathType Leaf) {
      return $bundled
    }
  }

  $tempRoot = [System.IO.Path]::GetTempPath()
  $tempDir = Join-Path $tempRoot "hover-trans-port-installer.$([guid]::NewGuid().ToString("N"))"
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $script:InstallerTempDirs += $tempDir

  try {
    $downloadedHelper = Join-Path $tempDir $assetName
    $helperUrl = Get-ReleaseAssetUrl $assetName
    Write-Stderr "install.ps1: downloading $helperUrl"
    Save-Url $helperUrl $downloadedHelper

    if (-not $SkipChecksum) {
      $checksumsPath = Join-Path $tempDir "checksums.txt"
      $checksumsUrl = Get-ReleaseAssetUrl "checksums.txt"
      Write-Stderr "install.ps1: downloading $checksumsUrl"
      Save-Url $checksumsUrl $checksumsPath
      Test-HelperChecksum $assetName $downloadedHelper $checksumsPath
    }

    return $downloadedHelper
  } catch {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }
}

function Copy-Helper {
  param(
    [string]$Source,
    [string]$Destination
  )

  Copy-Item -LiteralPath $Source -Destination $Destination -Force
  Unblock-File -LiteralPath $Destination -ErrorAction SilentlyContinue
}

function Save-InstallerScript {
  param([string]$Destination)

  if (-not [string]::IsNullOrWhiteSpace($PSCommandPath) -and (Test-Path -LiteralPath $PSCommandPath -PathType Leaf)) {
    Copy-Item -LiteralPath $PSCommandPath -Destination $Destination -Force
    return
  }

  $installerUrl = Get-ReleaseAssetUrl $InstallerFileName
  Write-Stderr "install.ps1: downloading $installerUrl"
  Save-Url $installerUrl $Destination
}

function Write-Launcher {
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  Set-Content -LiteralPath $LauncherPath -Encoding ASCII -Value @"
@echo off
setlocal
set "ROOT=%~dp0"
set /p CURRENT=<"%ROOT%current"
if not defined CURRENT (
  echo hover-trans-port: active native host is not installed 1>&2
  exit /b 1
)
set "HELPER=%ROOT%native-hosts\%CURRENT%\hover-trans-port-helper.exe"
if not exist "%HELPER%" (
  echo hover-trans-port: active native host is not installed 1>&2
  exit /b 1
)
"%HELPER%"
exit /b %ERRORLEVEL%
"@
}

function Write-UpdaterCmd {
  param([string]$Destination)

  Set-Content -LiteralPath $Destination -Encoding ASCII -Value @"
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
"@
}

function Write-Metadata {
  param(
    [string]$Destination,
    [string]$FinalUpdaterPath
  )

  $metadata = [ordered]@{
    hostVersion = $HostVersion
    protocolVersion = 1
    source = "powershell-script-installer"
    updaterPath = $FinalUpdaterPath
  }
  Write-Utf8NoBom $Destination ($metadata | ConvertTo-Json -Depth 3)
}

function Write-Manifests {
  param([array]$Targets)

  foreach ($target in $Targets) {
    $manifestPath = Get-ManifestPath $target
    $manifestDir = Split-Path -Parent $manifestPath
    New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null

    $manifest = [ordered]@{
      allowed_origins = @("chrome-extension://$ExtensionId/")
      description = "Hover Trans Port Native Host"
      name = $HostName
      path = $LauncherPath
      type = "stdio"
    }
    Write-Utf8NoBom $manifestPath ($manifest | ConvertTo-Json -Depth 3)
  }
}

function Register-Manifests {
  param([array]$Targets)

  foreach ($target in $Targets) {
    $manifestPath = Get-ManifestPath $target
    $registryPath = $target["RegistryKey"]
    foreach ($view in @("/reg:32", "/reg:64")) {
      & reg.exe add $registryPath /ve /t REG_SZ /d $manifestPath /f $view | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "reg add failed for $registryPath $view"
      }
    }
  }
}

function Unregister-Manifests {
  param([array]$Targets)

  foreach ($target in $Targets) {
    $registryPath = $target["RegistryKey"]
    foreach ($view in @("/reg:32", "/reg:64")) {
      & reg.exe delete $registryPath /f $view 2>$null | Out-Null
    }
  }
}

function Get-CurrentVersion {
  if (-not (Test-Path -LiteralPath $CurrentLink -PathType Leaf)) {
    return ""
  }

  $target = (Get-Content -LiteralPath $CurrentLink -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($target)) {
    return ""
  }

  return Split-Path -Leaf $target
}

function Emit-InstallResult {
  param(
    [array]$Targets,
    [array]$ManifestPaths
  )

  if ($Json) {
    $result = [ordered]@{
      command = $Command
      ok = $true
      previousVersion = $PreviousVersion
      installedVersion = $HostVersion
      installRoot = $InstallRoot
      currentLink = $CurrentLink
      helperPath = $HelperPath
      updaterPath = $UpdaterPath
      manifests = $ManifestPaths
    }
    $result | ConvertTo-Json -Depth 4 -Compress
    return
  }

  Write-Output "installed native host $HostVersion"
  foreach ($manifestPath in $ManifestPaths) {
    Write-Output "manifest: $manifestPath"
  }
  Write-Output "launcher: $LauncherPath"
  Write-Output "current: $CurrentLink -> $HostVersion"
  Write-Output "updater: $UpdaterPath"
}

function Install-Host {
  param([array]$Targets)

  $script:PreviousVersion = Get-CurrentVersion
  $manifestPaths = @(Get-ManifestPaths $Targets)
  $helperSourcePath = Resolve-HelperSource
  $stagingDir = "$VersionDir.staging"
  $backupDir = "$VersionDir.backup"
  $stagedHelperPath = Join-Path $stagingDir $HelperExecutableName
  $stagedInstallerPath = Join-Path $stagingDir "install.ps1"
  $stagedUpdaterPath = Join-Path $stagingDir "update-native-host.cmd"

  Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

  Copy-Helper $helperSourcePath $stagedHelperPath
  Clear-InstallerTempDirs
  Save-InstallerScript $stagedInstallerPath
  Write-UpdaterCmd $stagedUpdaterPath
  Write-Metadata (Join-Path $stagingDir "metadata.json") $UpdaterPath

  New-Item -ItemType Directory -Path $NativeHostsRoot -Force | Out-Null
  if (Test-Path -LiteralPath $VersionDir) {
    Move-Item -LiteralPath $VersionDir -Destination $backupDir
  }

  try {
    Move-Item -LiteralPath $stagingDir -Destination $VersionDir
    Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
  } catch {
    if ((Test-Path -LiteralPath $backupDir) -and -not (Test-Path -LiteralPath $VersionDir)) {
      Move-Item -LiteralPath $backupDir -Destination $VersionDir
    }
    Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }

  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  Set-Content -LiteralPath $CurrentLink -Encoding ASCII -Value $HostVersion
  Write-Launcher
  Write-Manifests $Targets
  Register-Manifests $Targets

  Emit-InstallResult $Targets $manifestPaths
}

function Test-AllManifestsExist {
  param([array]$Targets)

  foreach ($target in $Targets) {
    if (-not (Test-Path -LiteralPath (Get-ManifestPath $target) -PathType Leaf)) {
      return $false
    }
  }
  return $true
}

function Status-Host {
  param([array]$Targets)

  $installedVersion = Get-CurrentVersion
  if (-not [string]::IsNullOrWhiteSpace($installedVersion)) {
    $installedHelper = Join-Path (Join-Path $NativeHostsRoot $installedVersion) $HelperExecutableName
    if ((Test-Path -LiteralPath $installedHelper -PathType Leaf) -and (Test-AllManifestsExist $Targets)) {
      Write-Output "installed native host $installedVersion"
      foreach ($manifestPath in Get-ManifestPaths $Targets) {
        Write-Output "manifest: $manifestPath"
      }
      Write-Output "current: $CurrentLink -> $installedVersion"
      return
    }
  }

  Write-Output "not installed"
}

function Uninstall-Host {
  param([array]$Targets)

  Unregister-Manifests $Targets
  foreach ($manifestPath in Get-ManifestPaths $Targets) {
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output "uninstalled native host"
}

$AllTargets = @($BrowserTargets | ForEach-Object {
  @{
    Id = $_["Id"]
    RegistryKey = $_["RegistryKey"]
  }
})

if ($Command -eq "uninstall") {
  Uninstall-Host $AllTargets
  return
}

$SelectedTargets = @(Get-SelectedBrowserTargets $Browser $RegistryKey)

switch ($Command) {
  "install" { Install-Host $SelectedTargets }
  "update" { Install-Host $SelectedTargets }
  "status" { Status-Host $SelectedTargets }
}
