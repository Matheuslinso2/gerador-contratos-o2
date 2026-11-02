# Instala o ORQUESTRADOR DO CORP (24 h) no Agendador de Tarefas do Windows — NÃO é executado automaticamente: só depois de o Matheus aprovar a grade (grade-24h.json).
# Cria a tarefa "Robo Corp Orquestrador" (liga com o Windows e todo dia 00:05; sem limite de execução; nunca duas instâncias; reinicia se cair) e DESABILITA
# (não apaga) as tarefas antigas que usam o login do Corp: "Robo Corp", "Robo Corp Anexos", "Robo Corp Anexos FDS manha", "Robo Corp Anexos FDS tarde".
# Desfazer: scripts\robo-corp\desfazer-orquestrador.ps1
$raiz = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$acao = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d `"$raiz`" && npx.cmd tsx scripts/robo-corp/orquestrador.ts" -WorkingDirectory $raiz
$gatilhos = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -Daily -At 00:05))
$conf = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 5) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Robo Corp Orquestrador" -Action $acao -Trigger $gatilhos -Settings $conf -Description "Um robô por vez no login do Corp, 24 h, pela grade scripts\robo-corp\grade-24h.json" -Force | Out-Null
foreach ($n in "Robo Corp", "Robo Corp Anexos", "Robo Corp Anexos FDS manha", "Robo Corp Anexos FDS tarde") { Disable-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue | Out-Null }
"Orquestrador instalado. Tarefas antigas do Corp desabilitadas (para voltar: desfazer-orquestrador.ps1)."
