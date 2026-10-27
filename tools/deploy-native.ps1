# Copies the staged plugin into the game, or removes it.
#
#   .\tools\deploy-native.ps1            # install into the default Steam path
#   .\tools\deploy-native.ps1 -Remove    # uninstall
#   .\tools\deploy-native.ps1 -GameDir 'D:\Games\Cyberpunk 2077'

param(
    [string] $GameDir = 'C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077',
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $repo 'native\build\dist\red4ext\plugins\REDnode'
$target = Join-Path $GameDir 'red4ext\plugins\REDnode'
# REDswap, the archive swap plugin (H3), goes beside REDnode.
$swapStage = Join-Path $repo 'native\build\dist\red4ext\plugins\REDswap'
$swapTarget = Join-Path $GameDir 'red4ext\plugins\REDswap'

if (-not (Test-Path (Join-Path $GameDir 'red4ext\RED4ext.dll'))) { throw "RED4ext not found under $GameDir" }
if (Get-Process Cyberpunk2077 -ErrorAction SilentlyContinue) { throw 'Close the game first. RED4ext keeps the plugin locked while it runs.' }

if ($Remove) {
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    if (Test-Path $swapTarget) { Remove-Item -Recurse -Force $swapTarget }
    Write-Output "Removed $target and $swapTarget"
    return
}

if (-not (Test-Path (Join-Path $stage 'REDnode.dll'))) { throw 'Nothing staged. Run tools\build-native.ps1 first.' }

New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item -Recurse -Force (Join-Path $stage '*') $target
Write-Output "Deployed to $target"
if (Test-Path (Join-Path $swapStage 'REDswap.dll')) {
    New-Item -ItemType Directory -Force $swapTarget | Out-Null
    Copy-Item -Recurse -Force (Join-Path $swapStage '*') $swapTarget
    Write-Output "Deployed REDswap to $swapTarget"
}
