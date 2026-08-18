@echo off
echo ============================================
echo   Instalando o Gestao do Negocio...
echo ============================================
echo.

if not exist ".env" (
  copy .env.example .env
  echo Criei o arquivo .env — pode editar ele com o Bloco de Notas se quiser
  echo definir uma senha ou ligar a atualizacao automatica.
  echo.
)

echo Instalando as pecas necessarias (isso demora um pouquinho, so na primeira vez)...
call npm install

echo.
echo ============================================
echo   Instalacao concluida!
echo   Agora e so abrir o arquivo "iniciar.bat"
echo ============================================
pause
