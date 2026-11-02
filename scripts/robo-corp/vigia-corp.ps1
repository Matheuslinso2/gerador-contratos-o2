# Vigia leve dos robôs do Corp (tarefa "Robo Corp Vigia", a cada 10 min). Não usa o Corp nem o navegador.
# 1) orquestrador parado (tarefa do Windows não está rodando) -> reinicia e registra
# 2) orquestrador "vivo" mas sem batimento há mais de 10 min (travado) -> mata e reinicia
# 3) nada andou (nenhum log/estado dos robôs mexeu) há mais de 30 min, fora o pós-processamento -> reinicia e manda e-mail ao Matheus (no máx. 1 a cada 2 h)
$raiz = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$saida = Join-Path $raiz "scripts\robo-corp\saida"; New-Item -ItemType Directory -Force $saida | Out-Null
$logf = Join-Path $saida "vigia.log"
$home_ = Join-Path $env:USERPROFILE ".robo-corp"
function Log($m) { Add-Content -Path $logf -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) -Encoding utf8 }
function Avisar($m) {
  $marca = Join-Path $home_ "vigia-ultimo-aviso.txt"
  if ((Test-Path $marca) -and ((Get-Date) - (Get-Item $marca).LastWriteTime).TotalHours -lt 2) { Log "e-mail NÃO enviado (já avisei há menos de 2 h): $m"; return }
  Set-Content $marca (Get-Date -Format o)
  Push-Location $raiz
  & cmd.exe /c "npx.cmd tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/alerta-vigia.ts `"$m`"" 2>&1 | Out-Null
  Pop-Location
  Log "e-mail de alerta enviado: $m"
}
function Reiniciar($motivo) {
  Log "REINICIANDO o orquestrador: $motivo"
  Stop-ScheduledTask -TaskName "Robo Corp Orquestrador" -ErrorAction SilentlyContinue
  # encerra o que sobrou do orquestrador e dos robôs (só processos do nosso projeto)
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "robo-corp[\\/](orquestrador|anexos|explorar|exportar)" -and $_.CommandLine -notmatch "vigia-corp" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item (Join-Path $home_ "login-em-uso*.json") -ErrorAction SilentlyContinue
  Start-Sleep 5
  Start-ScheduledTask -TaskName "Robo Corp Orquestrador"
}
$t = Get-ScheduledTask -TaskName "Robo Corp Orquestrador" -ErrorAction SilentlyContinue
if (-not $t) { Log "tarefa do orquestrador não está instalada; nada a vigiar"; exit 0 }
if ($t.State -ne "Running") { Reiniciar "a tarefa estava parada (estado $($t.State))"; exit 0 }
$bat = Join-Path $home_ "orquestrador-vivo.json"
if (Test-Path $bat) {
  $idade = ((Get-Date) - (Get-Item $bat).LastWriteTime).TotalMinutes
  if ($idade -gt 10) { Reiniciar "sem batimento há $([int]$idade) min (travado)"; Avisar "O orquestrador ficou travado ($([int]$idade) min sem sinal). Reiniciei sozinho."; exit 0 }
}
# progresso: o arquivo mais recente entre logs dos robôs, estados e batimento de login
$arqs = @(Get-ChildItem $saida -Filter "anexos*.log" -ErrorAction SilentlyContinue) + @(Get-ChildItem (Join-Path $saida "ultimo.log") -ErrorAction SilentlyContinue) + @(Get-ChildItem (Join-Path $saida "orquestrador.log") -ErrorAction SilentlyContinue)
$ult = ($arqs | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
if ($ult) {
  $parado = ((Get-Date) - $ult.LastWriteTime).TotalMinutes
  # logins pausados de propósito (sem permissão / recusados) não contam como parada se pelo menos um anda; se TODOS estão sem andar há 30 min, avisa
  if ($parado -gt 30) { Reiniciar "nada andou há $([int]$parado) min (último arquivo: $($ult.Name))"; Avisar "Os robôs do Corp ficaram $([int]$parado) min sem baixar nada (último sinal: $($ult.Name)). Reiniciei o orquestrador sozinho." ; exit 0 }
}
Log "ok (orquestrador rodando; último sinal dos robôs há $([int]$parado) min)"
