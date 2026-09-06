# Default checks are isolated. -LiveCheck downloads and verifies, but never installs.
param([switch] $LiveCheck)
. "$PSScriptRoot/../src-tauri/src/discord-update.ps1"

if ($LiveCheck) {
    $release = Get-DiscordRelease
    $download = Join-Path ([IO.Path]::GetTempPath()) ('DiscordCleaner-check-' + [Guid]::NewGuid().ToString('N') + '.exe')
    try {
        Invoke-WebRequest -Uri "https://stable.dl2.discordapp.net/distro/app/stable/win/x64/$($release.latest)/DiscordSetup.exe" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 180 -OutFile $download
        Assert-DiscordSignature $download
        Write-Output "Official feed and installer signature verified for $($release.latest). No installer was executed."
    } finally {
        Remove-Item -LiteralPath $download -ErrorAction SilentlyContinue
    }
    exit 0
}

function Assert($condition, [string] $message) { if (-not $condition) { throw $message } }
function Assert-Throws([scriptblock] $action, [string] $expected) {
    try { & $action | Out-Null } catch {
        Assert ($_.Exception.Message -like "*$expected*") "Unexpected error: $_"
        return
    }
    throw "Expected failure: $expected"
}

$script:remote = @(1, 0, 10000)
$script:signatureStatus = 'Valid'
$script:signer = 'Discord Inc.'
$script:launches = 0
$script:downloads = 0
$script:exitCode = 0
$script:finished = $true
$script:updating = $false
function Invoke-RestMethod { @{ full = @{ host_version = $script:remote } } }
function Invoke-WebRequest($Uri, $OutFile) {
    Assert ($Uri -ceq 'https://stable.dl2.discordapp.net/distro/app/stable/win/x64/1.0.10000/DiscordSetup.exe') 'Unexpected download URL'
    $script:downloads++
    [IO.File]::WriteAllText($OutFile, 'mock installer')
}
function Get-AuthenticodeSignature {
    $cert = New-Object PSObject
    $cert | Add-Member ScriptMethod GetNameInfo { return $script:signer }
    @{ Status = $script:signatureStatus; SignerCertificate = $cert }
}
function Get-Process {
    if ($script:updating) { @{ Path = (Join-Path $env:LOCALAPPDATA 'Discord\Update.exe') } }
}
function Start-Process {
    $script:launches++
    $process = [PSCustomObject]@{ Handle = 1; ExitCode = $script:exitCode }
    $process | Add-Member ScriptMethod WaitForExit { return $script:finished }
    return $process
}

$originalLocalAppData = $env:LOCALAPPDATA
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('DiscordCleaner-test-' + [Guid]::NewGuid().ToString('N'))
$discordRoot = Join-Path $fixture 'Discord'
$appDir = Join-Path $discordRoot 'app-1.0.10000'
$fakeExe = Join-Path $appDir 'Discord.exe'
$database = Join-Path $discordRoot 'installer.db'
try {
    $env:LOCALAPPDATA = $fixture
    $null = New-Item -ItemType Directory -Path $appDir -Force
    [IO.File]::WriteAllText($fakeExe, 'mock installed executable')
    [IO.File]::WriteAllText($database, 'mock initialized database')
    Assert ((Get-DiscordRelease).latest -eq '1.0.10000') 'Manifest version parsing'
    $script:remote = @(1, 'x', 2)
    Assert-Throws { Get-DiscordRelease } 'Invalid Discord version'
    $script:remote = @(1, 0, 10000)
    Assert-Throws { Install-Discord '1.0.10000/evil' } 'Invalid requested version'
    Assert-Throws { Install-Discord '1.0.9999' } 'version changed'
    Assert ($script:downloads -eq 0) 'Invalid versions must not download'

    $script:signatureStatus = 'NotSigned'
    Assert-Throws { Install-Discord '1.0.10000' } 'valid Discord Inc. signature'
    $script:signatureStatus = 'Valid'
    $script:signer = 'Someone else'
    Assert-Throws { Install-Discord '1.0.10000' } 'valid Discord Inc. signature'
    Assert ($script:launches -eq 0) 'Untrusted installers must never run'
    $script:signer = 'Discord Inc.'
    $script:updating = $true
    Assert-Throws { Install-Discord '1.0.10000' } 'already updating'
    Assert ($script:launches -eq 0) 'Do not overlap an existing updater'
    $script:updating = $false

    $script:exitCode = 1
    Assert-Throws { Install-Discord '1.0.10000' } 'installation failed'
    $script:exitCode = 0
    $script:finished = $false
    Assert-Throws { Install-Discord '1.0.10000' } 'still running'
    $script:finished = $true
    $events = @(Install-Discord '1.0.10000' | ForEach-Object { $_ | ConvertFrom-Json })
    Assert ($events[-1].step -eq 'install' -and $events[-1].status -eq 'ok') 'Successful initialized installation'
    Assert ($script:launches -eq 3) 'Unexpected number of launches'
    Write-Output 'Update checks passed: manifest validation, pinned download, signatures, concurrent updater, failure, timeout and success.'
} finally {
    $env:LOCALAPPDATA = $originalLocalAppData
    # Known fixture paths only, in leaf-to-root order; no recursive deletion.
    foreach ($path in @($fakeExe, $database, $appDir, $discordRoot, $fixture)) {
        Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue
    }
}
