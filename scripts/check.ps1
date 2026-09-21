[CmdletBinding()]
param(
  [ValidateSet("All", "Backend", "Frontend", "Email", "Terraform")]
  [string[]]$Scope = @("All")
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$runAll = $Scope -contains "All"

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

function Test-Scope {
  param([Parameter(Mandatory)][string]$Name)
  return $runAll -or $Scope -contains $Name
}

Push-Location $repoRoot
try {
  if ((Test-Scope "Backend") -and -not (Test-Path -LiteralPath $python)) {
    throw "Missing .venv. Run .\scripts\setup.ps1 first."
  }

  if (Test-Scope "Frontend") {
    Write-Host "Checking frontend JavaScript..."
    foreach ($file in @(
      "frontend/app.js",
      "frontend/bootstrap.js",
      "frontend/leaderboard.js",
      "frontend/monitoring.js",
      "frontend/picks.js",
      "frontend/scoring.js",
      "frontend/shell.js",
      "frontend/auth-config.js"
    )) {
      Invoke-NativeCommand -FilePath node -ArgumentList @("--check", $file)
    }
    Invoke-NativeCommand -FilePath node -ArgumentList @("--test", "backend/test_leaderboard.cjs")
  }

  if (Test-Scope "Backend") {
    Write-Host "Checking backend Python..."
    Invoke-NativeCommand -FilePath $python -ArgumentList @(
      "-m", "py_compile", "backend/lambda/app.py", "backend/lambda/results_updater.py"
    )
    Invoke-NativeCommand -FilePath $python -ArgumentList @("-m", "unittest", "discover", "-s", "backend", "-p", "test_*.py")
  }

  if (Test-Scope "Email") {
    if (-not (Test-Path -LiteralPath "backend/custom-email-sender/node_modules")) {
      throw "Missing email-sender dependencies. Run .\scripts\setup.ps1 first."
    }
    Write-Host "Checking the custom email sender..."
    Invoke-NativeCommand -FilePath npm -ArgumentList @("test", "--prefix", "backend/custom-email-sender")
  }

  if (Test-Scope "Terraform") {
    Write-Host "Checking Terraform..."
    Invoke-NativeCommand -FilePath terraform -ArgumentList @("fmt", "-check", "-recursive", "terraform")
    foreach ($terraformDirectory in @("terraform/bootstrap", "terraform/envs/dev", "terraform/envs/prod")) {
      if (-not (Test-Path -LiteralPath "$terraformDirectory/.terraform")) {
        throw "Terraform is not initialized in $terraformDirectory. Run .\scripts\setup.ps1 first."
      }
      Invoke-NativeCommand -FilePath terraform -ArgumentList @("-chdir=$terraformDirectory", "validate")
    }
  }

  Write-Host "Requested checks passed: $($Scope -join ', ')"
}
finally {
  Pop-Location -ErrorAction SilentlyContinue
}
