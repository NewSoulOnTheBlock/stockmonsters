# Copy the latest Stockmonsters build next to the player and open it in the browser.
# Usage: powershell -File play.ps1   (run again after every `make` to pick up the new ROM)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$rom = Join-Path $here "..\stockred\pokefirered.gba"
if (-not (Test-Path $rom)) { Write-Error "No build found at $rom - run make in stockred first."; exit 1 }
Copy-Item $rom (Join-Path $here "stockmonsters.gba") -Force

$port = 8642
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $busy) {
    # The Bun netplay server hosts this folder and the /ws multiplayer socket.
    $server = Join-Path $here "..\netplay-server\server.ts"
    Start-Process bun -ArgumentList "run", $server -WorkingDirectory $here -WindowStyle Minimized
    Start-Sleep -Seconds 1
}
Start-Process "http://127.0.0.1:$port/"
