# Desfaz o orquestrador: remove a tarefa "Robo Corp Orquestrador" e HABILITA de novo as tarefas antigas do Corp (horários originais preservados).
Stop-ScheduledTask -TaskName "Robo Corp Orquestrador" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "Robo Corp Orquestrador" -Confirm:$false -ErrorAction SilentlyContinue
foreach ($n in "Robo Corp", "Robo Corp Anexos", "Robo Corp Anexos FDS manha", "Robo Corp Anexos FDS tarde") { Enable-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue | Out-Null }
Remove-Item "$env:USERPROFILE\.robo-corp\pausar-docs.flag", "$env:USERPROFILE\.robo-corp\pausar-baixa.flag" -ErrorAction SilentlyContinue
"Orquestrador removido. Tarefas antigas do Corp reabilitadas."
