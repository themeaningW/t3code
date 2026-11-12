param(
    [Parameter(Mandatory)][string]$Destination,
    [string]$ProfilesDirectory = $env:APPDATA,
    [string[]]$ProfileNames = @('t3code-v2', 't3code'),
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\t3code')
)
$ErrorActionPreference = 'Stop'
$backupDestination = [IO.Path]::GetFullPath($Destination)
$backupProfiles = [IO.Path]::GetFullPath($ProfilesDirectory)
$backupInstall = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$backupCacheDirectories = @('Cache', 'Code Cache', 'GPUCache', 'GPUPersistentCache', 'GrShaderCache', 'ShaderCache', 'DawnGraphiteCache', 'DawnWebGPUCache')

function Assert-DesktopClosed {
    $running = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($backupInstall, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($running.Count -gt 0) {
        throw 'T3 Code is still running or reopened during backup. Close it and retry; no files were installed.'
    }
}

function Get-PersistentFiles([string]$Root) {
    $directories = [Collections.Generic.Stack[string]]::new()
    $directories.Push($Root)
    while ($directories.Count -gt 0) {
        foreach ($entry in Get-ChildItem -LiteralPath $directories.Pop() -Force) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            if ($entry.PSIsContainer) {
                if ($entry.Name -notin $backupCacheDirectories) { $directories.Push($entry.FullName) }
            } elseif ($entry.Name -notin @('LOCK', 'lockfile') -and $entry.Name -notlike 'Singleton*') {
                $entry
            }
        }
    }
}

if (Test-Path -LiteralPath $backupDestination) { throw 'The desktop profile backup destination already exists.' }
foreach ($profileName in $ProfileNames) {
    if ([IO.Path]::GetFileName($profileName) -ne $profileName -or $profileName -in @('.', '..')) { throw 'Invalid profile name.' }
    $source = [IO.Path]::GetFullPath((Join-Path $backupProfiles $profileName))
    if ($backupDestination.Equals($source, [StringComparison]::OrdinalIgnoreCase) -or
        $backupDestination.StartsWith($source + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The backup must be outside the source profile.'
    }
}
Assert-DesktopClosed
$backupStaging = $backupDestination + '.partial-' + [guid]::NewGuid().ToString('N')
$null = New-Item -ItemType Directory -Path $backupStaging
$backupManifest = @()
foreach ($profileName in $ProfileNames) {
    $source = Join-Path $backupProfiles $profileName
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { continue }
    Assert-DesktopClosed
    Write-Host "Backing up desktop profile: $profileName. Keep T3 Code closed until verification finishes."
    $target = Join-Path $backupStaging $profileName
    $copyLog = Join-Path $backupStaging ($profileName + '-copy.log')
    # Never skip Cookies or LevelDB: they hold sign-ins and the device-local layout.
    & robocopy.exe $source $target /E /COPY:DAT /DCOPY:DAT /XJ /R:0 /W:0 /NP /NFL /NDL /NJH /NJS /XF LOCK lockfile 'Singleton*' /XD @backupCacheDirectories "/UNILOG:$copyLog" | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Desktop profile copy failed: $profileName. No files were installed. Details: $copyLog"
    }
    Assert-DesktopClosed
    $files = @(Get-PersistentFiles $source)
    foreach ($file in $files) {
        $relative = [IO.Path]::GetRelativePath($source, $file.FullName)
        $copied = Join-Path $target $relative
        $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        if (-not (Test-Path -LiteralPath $copied -PathType Leaf) -or
            (Get-FileHash -LiteralPath $copied -Algorithm SHA256).Hash -ne $sourceHash) {
            throw "Desktop profile backup verification failed: $profileName/$relative"
        }
        $backupManifest += [pscustomobject]@{ profile = $profileName; path = $relative; sha256 = $sourceHash.ToLowerInvariant() }
    }
}
Assert-DesktopClosed
ConvertTo-Json -InputObject @($backupManifest) -Depth 4 | Set-Content -LiteralPath (Join-Path $backupStaging 'files.json') -Encoding utf8
[IO.Directory]::Move($backupStaging, $backupDestination)
[pscustomobject]@{ destination = $backupDestination; verifiedFiles = $backupManifest.Count; cachesExcluded = $true } | ConvertTo-Json -Compress
