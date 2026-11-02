# Instala o ORQUESTRADOR DO CORP (24 h) no Agendador de Tarefas do Windows — NÃO é executado automaticamente: só depois de o Matheus aprovar a grade (grade-24h.json).
# Cria a tarefa "Robo Corp Orquestrador" (liga com o Windows e todo dia 00:05; sem limite de execução; nunca duas instâncias; reinicia se cair) e DESABILITA
# (não apaga) as tarefas antigas que usam o login do Corp: "Robo Corp", "Robo Corp Anexos", "Robo Corp Anexos FDS manha", "Robo Corp Anexos FDS tarde".
# Desfazer: scripts\robo-corp\desfazer-orquestrador.ps1
# Se qualquer passo falhar, PARA antes de desabilitar as tarefas antigas (02/11: o gatilho "ao ligar o Windows" exigia administrador, falhou, e as antigas foram desabilitadas sem o orquestrador existir).
$ErrorActionPreference = "Stop"
$raiz = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$acao = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d `"$raiz`" && npx.cmd tsx scripts/robo-corp/orquestrador.ts" -WorkingDirectory $raiz
# "ao entrar no Windows" (não exige administrador) + todo dia 00:05. O Windows entra sozinho no usuário após reiniciar (se não entrar, o gatilho das 00:05 e o vigia cobrem).
$gatilhos = @((New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME), (New-ScheduledTaskTrigger -Daily -At 00:05))
$conf = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 5) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Robo Corp Orquestrador" -Action $acao -Trigger $gatilhos -Settings $conf -Description "Um robô por vez no login do Corp, 24 h, pela grade scripts\robo-corp\grade-24h.json" -Force | Out-Null
foreach ($n in "Robo Corp", "Robo Corp Anexos", "Robo Corp Anexos FDS manha", "Robo Corp Anexos FDS tarde") { Disable-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue | Out-Null }
"Orquestrador instalado. Tarefas antigas do Corp desabilitadas (para voltar: desfazer-orquestrador.ps1)."
# Vigia (a cada 10 min): reinicia o orquestrador se parar/travar e avisa o Matheus por e-mail se os robôs ficarem 30 min sem andar. Log: saida\vigia.log
$gv = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
$av = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\vigia-corp.ps1`"" -WorkingDirectory $raiz
$cv = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 8) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Robo Corp Vigia" -Action $av -Trigger $gv -Settings $cv -Description "Vigia do orquestrador do Corp (reinicia e avisa por e-mail)" -Force | Out-Null
Start-ScheduledTask -TaskName "Robo Corp Orquestrador"
"Vigia instalado (a cada 10 min) e orquestrador iniciado."
