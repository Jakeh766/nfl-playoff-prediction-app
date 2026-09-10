[CmdletBinding()]
param(
  [switch]$SkipNode,
  [switch]$SkipTerraform
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory)]
    [string]$FilePath,

    [Parameter(Mandatory)]
    [string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
  }
}

function Find-Python313 {
  $standardInstall = Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"
  if (Test-Path -LiteralPath $standardInstall) {
    return $standardInstall
  }

  $commands = Get-Command python -All -ErrorAction SilentlyContinue
  foreach ($command in $commands) {
    if ($command.Source -and $command.Source -notmatch "WindowsApps") {
      return $command.Source
    }
  }

  throw "Python 3.13 was not found. Install Python 3.13 and disable the Microsoft Store Python app-execution aliases."
}

Push-Location $repoRoot
try {
  if (-not (Test-Path -LiteralPath $venvPython)) {
    $python = Find-Python313
    Write-Host "Creating .venv with $python"
    Invoke-NativeCommand -FilePath $python -ArgumentList @("-m", "venv", ".venv")
  }

  Invoke-NativeCommand -FilePath $venvPython -ArgumentList @("--version")
  $pythonVersion = & $venvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
  if ($LASTEXITCODE -ne 0 -or $pythonVersion -ne "3.13") {
    throw "The repository .venv must use Python 3.13. Remove .venv and rerun this script."
  }

  if (-not $SkipNode) {
    Invoke-NativeCommand -FilePath npm -ArgumentList @("ci", "--prefix", "backend/custom-email-sender")
  }

  if (-not $SkipTerraform) {
    foreach ($terraformDirectory in @("terraform/bootstrap", "terraform/envs/dev", "terraform/envs/prod")) {
      if (-not (Test-Path -LiteralPath "$terraformDirectory/.terraform")) {
        Invoke-NativeCommand -FilePath terraform -ArgumentList @("-chdir=$terraformDirectory", "init", "-backend=false", "-input=false")
      }
    }
  }

  Write-Host "Local development setup is ready."
}
finally {
  Pop-Location -ErrorAction SilentlyContinue
}
