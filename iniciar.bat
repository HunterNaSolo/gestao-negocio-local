@echo off
title Gestao do Negocio

:loop
echo Iniciando o Gestao do Negocio...
echo (Nao feche essa janela — ela precisa ficar aberta enquanto usa o programa)
echo.
call npm start

if %errorlevel% equ 42 (
  echo.
  echo Nova versao aplicada — reiniciando automaticamente...
  timeout /t 2 /nobreak >nul
  goto loop
)

pause
