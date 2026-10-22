param(
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$SourceRef,
    [string]$Label = 'T3 Code custom baseline',
    [string]$ResourcesPath = (Join-Path $env:LOCALAPPDATA 'Programs\t3code\resources')
)
$ErrorActionPreference = 'Stop'
$forkDestination = [System.IO.Path]::GetFullPath($Destination)
$forkSourceRoot = [System.IO.Path]::GetFullPath($ResourcesPath)
if (Test-Path -LiteralPath $forkDestination) { throw 'The recovery destination already exists.' }
if ($forkDestination.StartsWith($forkSourceRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery destination must be outside the installation.' }
New-Item -ItemType Directory -Path $forkDestination | Out-Null
$forkSourceArchive = Join-Path $forkSourceRoot 'server.asar'
$forkBefore = (Get-FileHash -LiteralPath $forkSourceArchive -Algorithm SHA256).Hash
Copy-Item -LiteralPath $forkSourceArchive -Destination (Join-Path $forkDestination 'server.asar')
Copy-Item -LiteralPath (Join-Path $forkSourceRoot 'server.asar.unpacked') -Destination (Join-Path $forkDestination 'server.asar.unpacked') -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Restore-ForkServer.ps1') -Destination (Join-Path $forkDestination 'Restore-ForkServer.ps1')
$forkNativeRoot = Join-Path $forkSourceRoot 'server.asar.unpacked'
$forkNativeFiles = @(Get-ChildItem -LiteralPath $forkNativeRoot -File -Recurse | ForEach-Object {
    [pscustomobject]@{ path = [System.IO.Path]::GetRelativePath($forkNativeRoot, $_.FullName).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$forkCopied = (Get-FileHash -LiteralPath (Join-Path $forkDestination 'server.asar') -Algorithm SHA256).Hash
$forkAfter = (Get-FileHash -LiteralPath $forkSourceArchive -Algorithm SHA256).Hash
if ($forkBefore -ne $forkCopied -or $forkBefore -ne $forkAfter) { throw 'The installed server changed during backup.' }
foreach ($forkNative in $forkNativeFiles) {
    if ((Get-FileHash -LiteralPath (Join-Path $forkDestination ('server.asar.unpacked/' + $forkNative.path)) -Algorithm SHA256).Hash -ne $forkNative.sha256) { throw 'A copied native dependency differs from the installation.' }
}
[ordered]@{
    formatVersion = 1
    label = $Label
    sourceRef = $SourceRef
    createdAt = [DateTime]::UtcNow.ToString('o')
    serverSha256 = $forkBefore.ToLowerInvariant()
    appSha256 = (Get-FileHash -LiteralPath (Join-Path $forkSourceRoot 'app.asar') -Algorithm SHA256).Hash.ToLowerInvariant()
    nativeFiles = $forkNativeFiles
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $forkDestination 'manifest.json') -Encoding utf8
Write-Output $forkDestination
