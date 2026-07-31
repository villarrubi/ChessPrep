param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VirtualPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

function Get-CompatiblePython {
    $candidates = @(
        @{ Cmd = "py"; Args = @("-3.14") },
        @{ Cmd = "py"; Args = @("-3.13") },
        @{ Cmd = "py"; Args = @("-3.12") },
        @{ Cmd = "py"; Args = @("-3.11") },
        @{ Cmd = "py"; Args = @("-3.10") },
        @{ Cmd = "python"; Args = @() }
    )
    foreach ($candidate in $candidates) {
        try {
            $versionOutput = & $candidate.Cmd @($candidate.Args + "--version") 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { continue }
            if ($versionOutput -match "Python (\d+)\.(\d+)") {
                $major = [int]$Matches[1]
                $minor = [int]$Matches[2]
                if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 10)) {
                    return @{ Cmd = $candidate.Cmd; Args = $candidate.Args; Version = "$major.$minor" }
                }
            }
        } catch {
            continue
        }
    }
    throw "Se necesita Python 3.10 o superior. Instálalo y vuelve a ejecutar .\run.ps1"
}

if (Test-Path -LiteralPath $VirtualPython) {
    $venvVersion = & $VirtualPython --version 2>&1 | Out-String
    if ($venvVersion -notmatch "Python 3\.(1[0-9]|[2-9]\d)") {
        Write-Host "El entorno virtual usa una versión incompatible ($($venvVersion.Trim())). Se recreará." -ForegroundColor Yellow
        Remove-Item -LiteralPath (Join-Path $ProjectRoot ".venv") -Recurse -Force
    }
}

if (-not (Test-Path -LiteralPath $VirtualPython)) {
    $python = Get-CompatiblePython
    Write-Host "Creando .venv con Python $($python.Version)..." -ForegroundColor Cyan
    & $python.Cmd @($python.Args + @("-m", "venv", (Join-Path $ProjectRoot ".venv")))
}

if (-not $SkipInstall) {
    & $VirtualPython -m pip install -r (Join-Path $ProjectRoot "api\requirements.txt")
}

Write-Host "ChessPrep disponible en http://localhost:8000" -ForegroundColor Green
& $VirtualPython -m uvicorn api.app.main:app --reload --host 127.0.0.1 --port 8000
