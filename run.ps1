param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VirtualPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $VirtualPython)) {
    python -m venv (Join-Path $ProjectRoot ".venv")
}

if (-not $SkipInstall) {
    & $VirtualPython -m pip install -r (Join-Path $ProjectRoot "api\requirements.txt")
}

Write-Host "ChessPrep disponible en http://localhost:8000" -ForegroundColor Green
& $VirtualPython -m uvicorn api.app.main:app --reload --host 127.0.0.1 --port 8000

