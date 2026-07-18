@echo off
setlocal
cd /d "%~dp0..\"
set DRIVER=%CD%\.tools\android-sdk\extras\google\Android_Emulator_Hypervisor_Driver
echo.
echo Instalando/iniciando Android Emulator Hypervisor Driver...
echo Esta janela deve pedir permissao de administrador.
echo.
cd /d "%DRIVER%"
call silent_install.bat
sc start aehd
echo.
echo Verificacao:
"%~dp0..\.tools\android-sdk\emulator\emulator.exe" -accel-check
echo.
pause
