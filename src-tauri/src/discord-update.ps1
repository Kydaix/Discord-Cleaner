# Embedded by updates.rs; only the fixed Discord Stable / Windows x64 feed is used.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-DiscordRelease {
    $manifest = Invoke-RestMethod -Uri 'https://updates.discord.com/distributions/app/manifests/latest?channel=stable&platform=win&arch=x64' -TimeoutSec 30
    $version = $manifest.full.host_version -join '.'
    if ($version -cnotmatch '^\d{1,9}\.\d{1,9}\.\d{1,9}$') { throw 'Invalid Discord version response.' }
    # Do not execute a URL supplied by the webview or use the full.distro hash for an EXE.
    return @{ latest = $version }
}

function Write-Stage([string] $step, [string] $status = 'ok', [string] $detail = '') {
    @{ step = $step; status = $status; detail = $detail } | ConvertTo-Json -Compress
}

function Assert-DiscordSignature([string] $path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ne 'Discord Inc.') {
        throw 'The installer does not have a valid Discord Inc. signature. Nothing was installed.'
    }
}

function Install-Discord([string] $version) {
    if ($version -cnotmatch '^\d{1,9}\.\d{1,9}\.\d{1,9}$') { throw 'Invalid requested version.' }
    $release = Get-DiscordRelease
    if ($release.latest -ne $version) { throw 'The available Discord version changed. Check for updates again.' }
    $root = Join-Path $env:LOCALAPPDATA 'Discord'
    $appDir = Join-Path $root "app-$version"
    $exe = Join-Path $appDir 'Discord.exe'
    $work = Join-Path ([IO.Path]::GetTempPath()) ('DiscordCleaner-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $work
    $installer = Join-Path $work 'DiscordSetup.exe'
    $lock = $null
    try {
        Write-Stage 'download' 'skip'
        Invoke-WebRequest -Uri "https://stable.dl2.discordapp.net/distro/app/stable/win/x64/$version/DiscordSetup.exe" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 180 -OutFile $installer
        Write-Stage 'download'
        # Hold a read-only handle through verification and execution to prevent replacement.
        $lock = [IO.File]::Open($installer, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        Assert-DiscordSignature $installer
        Write-Stage 'signature'
        $runningUpdates = @(Get-Process -Name Update -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) })
        if ($runningUpdates.Count) { throw 'Discord is already updating. Wait for it to finish, then retry.' }
        foreach ($discord in @(Get-Process -Name Discord -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) })) {
            $discord.Kill()
            if (-not $discord.WaitForExit(10000)) { throw 'Discord could not be closed. No installation was started.' }
        }
        Write-Stage 'kill'
        # Normal installation is required: --silent skips Discord's first-run database setup.
        Write-Stage 'install' 'skip'
        $process = Start-Process -FilePath $installer -WorkingDirectory $work -PassThru
        $null = $process.Handle # Keep the process handle so ExitCode survives a fast installer exit.
        if (-not $process.WaitForExit(600000)) { throw 'Installation is still running. No cleanup was performed. Finish the installer before retrying.' }
        if ($process.ExitCode -ne 0) { throw "Discord installation failed (exit $($process.ExitCode)). No cleanup was performed." }
        # Wait for first-run initialization and any updater child to finish, not just Setup.exe.
        $deadline = [DateTime]::UtcNow.AddMinutes(3)
        do {
            $updating = @(Get-Process -Name Update -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
            $ready = (Test-Path -LiteralPath $exe -PathType Leaf) -and
                (Test-Path -LiteralPath (Join-Path $root 'installer.db') -PathType Leaf) -and
                -not (Test-Path -LiteralPath (Join-Path $appDir 'installer.db'))
            if ($ready -and -not $updating) { break }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Discord initialization did not finish. No cleanup was performed.' }
            Start-Sleep -Seconds 1
        } while ($true)
        Assert-DiscordSignature $exe
        Write-Stage 'install'
    } finally {
        if ($lock) { $lock.Dispose() }
        # Only these two paths were created here; never recursively delete a computed directory.
        Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $work -ErrorAction SilentlyContinue
    }
}

# Dot-sourcing defines the functions for isolated tests without network or installation.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ($env:DISCORD_CLEANER_OPERATION -eq 'check') { Get-DiscordRelease | ConvertTo-Json -Compress }
        elseif ($env:DISCORD_CLEANER_OPERATION -eq 'install') { Install-Discord $env:DISCORD_CLEANER_VERSION }
        else { throw 'Unknown operation.' }
    } catch {
        Write-Stage 'error' 'warn' $_.Exception.Message
        exit 1
    }
}
