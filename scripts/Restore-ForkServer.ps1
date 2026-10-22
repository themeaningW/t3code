param(
    [string]$BundleDirectory = $PSScriptRoot,
    [string]$ResourcesPath = (Join-Path $env:LOCALAPPDATA 'Programs\t3code\resources'),
    [string]$ExpectedCurrentSha256 = ''
)
$ErrorActionPreference = 'Stop'
$forkBundle = [System.IO.Path]::GetFullPath($BundleDirectory)
$forkResources = [System.IO.Path]::GetFullPath($ResourcesPath)
$forkManifest = Get-Content -LiteralPath (Join-Path $forkBundle 'manifest.json') -Raw | ConvertFrom-Json
if ($forkManifest.formatVersion -ne 1) { throw 'Unsupported fork bundle format.' }
$forkArchive = Join-Path $forkResources 'server.asar'
$forkSource = Join-Path $forkBundle 'server.asar'
if ((Get-FileHash -LiteralPath $forkSource -Algorithm SHA256).Hash -ne $forkManifest.serverSha256) {
    throw 'Bundle archive checksum mismatch.'
}
if ((Get-FileHash -LiteralPath (Join-Path $forkResources 'app.asar') -Algorithm SHA256).Hash -ne $forkManifest.appSha256) {
    throw 'The desktop application version changed. This bundle cannot replace its server.'
}
$forkInstallRoot = [System.IO.Path]::GetDirectoryName($forkResources) + [System.IO.Path]::DirectorySeparatorChar
$forkRunning = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($forkInstallRoot, [System.StringComparison]::OrdinalIgnoreCase)
})
if ($forkRunning.Count -gt 0) { throw 'Close T3 Code completely before installing or restoring this bundle.' }
foreach ($forkNative in $forkManifest.nativeFiles) {
    $forkNativePath = [System.IO.Path]::GetFullPath((Join-Path $forkResources ('server.asar.unpacked/' + $forkNative.path)))
    $forkNativeRoot = (Join-Path $forkResources 'server.asar.unpacked') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $forkNativePath.StartsWith($forkNativeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Invalid native file path in bundle.'
    }
    if ((Get-FileHash -LiteralPath $forkNativePath -Algorithm SHA256).Hash -ne $forkNative.sha256) {
        throw "Native dependency changed: $($forkNative.path). Restore the matching desktop version first."
    }
}
$forkCurrentHash = (Get-FileHash -LiteralPath $forkArchive -Algorithm SHA256).Hash
if ($ExpectedCurrentSha256 -and $forkCurrentHash -ne $ExpectedCurrentSha256) {
    throw 'The installed server changed after this update was prepared.'
}
if ($forkCurrentHash -eq $forkManifest.serverSha256) {
    Write-Output 'This bundle is already installed.'
    return
}
$forkIncoming = Join-Path $forkResources ('server.asar.fork-incoming-' + [guid]::NewGuid().ToString('N'))
$forkPrevious = Join-Path $forkResources ('server.asar.before-fork-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'))
Copy-Item -LiteralPath $forkSource -Destination $forkIncoming
if ((Get-FileHash -LiteralPath $forkIncoming -Algorithm SHA256).Hash -ne $forkManifest.serverSha256) {
    throw 'Staged archive checksum mismatch.'
}
[System.IO.File]::Replace($forkIncoming, $forkArchive, $forkPrevious, $false)
if ((Get-FileHash -LiteralPath $forkArchive -Algorithm SHA256).Hash -ne $forkManifest.serverSha256) {
    throw 'Installed archive checksum mismatch.'
}
[pscustomobject]@{ action = 'installed'; label = $forkManifest.label; sourceRef = $forkManifest.sourceRef; previousArchive = $forkPrevious; sha256 = $forkManifest.serverSha256 } | ConvertTo-Json
