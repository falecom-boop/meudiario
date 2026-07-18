param(
  [string]$AvdName = "DiarioApi35",
  [string]$ApkPath = "android\app\build\outputs\apk\debug\app-debug.apk",
  [string]$PackageName = "br.local.diarioclasse",
  [switch]$Headless
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Sdk = Join-Path $Root ".tools\android-sdk"
$env:ANDROID_SDK_ROOT = $Sdk
$env:ANDROID_HOME = $Sdk
$env:Path = "$Sdk\platform-tools;$Sdk\emulator;$env:Path"

$Adb = Join-Path $Sdk "platform-tools\adb.exe"
$Emulator = Join-Path $Sdk "emulator\emulator.exe"
$ResolvedApk = Resolve-Path (Join-Path $Root $ApkPath)
$LogsDir = Join-Path $Root "android-smoke-output"
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

$accelOutput = & $Emulator -accel-check 2>&1 | Out-String
if ($accelOutput -match "not installed|requires hardware acceleration|accel:\s*6") {
  Write-Host ""
  Write-Host "O emulador ainda nao consegue iniciar porque o hypervisor/driver nao esta ativo." -ForegroundColor Yellow
  Write-Host "Saida do emulator -accel-check:" -ForegroundColor Yellow
  Write-Host $accelOutput
  Write-Host "Abra um PowerShell/CMD como ADMINISTRADOR e rode:" -ForegroundColor Cyan
  Write-Host "  cd /d `"$Sdk\extras\google\Android_Emulator_Hypervisor_Driver`"" -ForegroundColor Cyan
  Write-Host "  .\silent_install.bat" -ForegroundColor Cyan
  Write-Host "  sc start aehd" -ForegroundColor Cyan
  Write-Host "Depois rode este script de novo." -ForegroundColor Cyan
  exit 2
}

$devicesBefore = & $Adb devices
if ($devicesBefore -notmatch "emulator-") {
  $out = Join-Path $LogsDir "emulator.out.log"
  $err = Join-Path $LogsDir "emulator.err.log"
  Remove-Item -LiteralPath $out,$err -Force -ErrorAction SilentlyContinue
  $args = @("-avd", $AvdName, "-no-audio", "-no-snapshot", "-gpu", "swiftshader_indirect")
  if ($Headless) { $args += "-no-window" }
  Write-Host "Iniciando emulador $AvdName..." -ForegroundColor Cyan
  Start-Process -FilePath $Emulator -ArgumentList $args -RedirectStandardOutput $out -RedirectStandardError $err
}

$deadline = (Get-Date).AddMinutes(5)
do {
  Start-Sleep -Seconds 5
  $devices = & $Adb devices
  $serial = (($devices | Select-String "emulator-\d+\s+device").Matches.Value -split "\s+")[0]
  if ($serial) {
    $boot = & $Adb -s $serial shell getprop sys.boot_completed 2>$null
    if ($boot -match "1") { break }
  }
} while ((Get-Date) -lt $deadline)

if (-not $serial -or $boot -notmatch "1") {
  throw "Emulador nao iniciou. Veja android-smoke-output\emulator.err.log."
}

Write-Host "Instalando APK em $serial..." -ForegroundColor Cyan
& $Adb -s $serial install -r $ResolvedApk
Write-Host "Abrindo app $PackageName..." -ForegroundColor Cyan
& $Adb -s $serial shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1 | Out-Null
Start-Sleep -Seconds 8

& $Adb -s $serial logcat -d -t 400 > (Join-Path $LogsDir "logcat.txt")
& $Adb -s $serial exec-out screencap -p > (Join-Path $LogsDir "screenshot.png")

$crashes = Select-String -Path (Join-Path $LogsDir "logcat.txt") -Pattern "FATAL EXCEPTION|AndroidRuntime|Capacitor/Console.*error|Uncaught" -SimpleMatch
if ($crashes) {
  $crashes | Select-Object -First 20
  throw "Smoke test encontrou erro no logcat."
}

Write-Host "Smoke test OK em $serial. Saidas em $LogsDir" -ForegroundColor Green
