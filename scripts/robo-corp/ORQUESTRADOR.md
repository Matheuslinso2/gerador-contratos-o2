# Orquestrador do Corp (24 h, N logins, um robô por login)

**Regra de ouro:** nunca dois robôs no mesmo login. Cada login tem a sua trava (`~/.robo-corp/login-em-uso.json` para o principal, `login-em-uso-<id>.json` para os demais).

## Como funciona
- `grade-24h.json`: a grade. `fixos` (Robo Corp 12:00/20:00 e ciclo de comissões 2 em 2 h nos dias úteis; rodam no login `principal` e têm prioridade), `workers` (um por login; `agenda` opcional), tempos de passagem.
  `npx tsx scripts/robo-corp/orquestrador.ts --simular` mostra o que cada login faria nas próximas 24 h, sem executar nada.
- Passagem de vez sem matar ninguém: o orquestrador cria `~/.robo-corp/pausar-docs[-<login>].flag`; o robô termina o documento em andamento, sai e libera o login. Só se não liberar em 12 min o processo é encerrado. Compromissos fixos nunca são interrompidos.
- Log: `scripts/robo-corp/saida/orquestrador.log` (`[login] ASSUMIU`, `LIBEROU`, falhas). Se um login entra e não enxerga o menu: `LOGIN SEM PERMISSÃO` no log, o login fica 6 h pausado (aviso ao Matheus), sem insistir.
- Pós-processamento diário (03:00, sem login do Corp): `anexos-pos.cmd` = junta o estado dos robôs (`merge-estado.ts`), OCR das telas, envio ao Workspace, vinculador, limpeza.

## Vários logins (como o Matheus acrescenta mais um)
1. Em `C:\Users\<usuário>\.robo-corp\config.json` incluir (modelo em `config.exemplo.json`):
   `"logins": { "senha": "<a senha única>", "lista": [ { "id": "R2", "usuario": "POWER BI O2 - R2" }, { "id": "R3", "usuario": "POWER BI O2 - R3" } ] }`
   (o login principal continua sendo o de `unidade`). Ninguém lê, mostra ou grava essa senha: ela só é digitada pelo robô na tela de login.
2. Em `grade-24h.json` acrescentar `{ "id": "R4" }` em `workers`. Sem tocar em código. Login que ainda não está no `config.json` fica parado (aviso no log a cada hora).
- Fila de documentos: dividida em lotes de 25 reservados por arquivo (`<pasta de anexos>/claims/lote-N.json`, validade de 40 min renovada a cada documento, retomada se o processo morreu). Nenhum documento é visitado por dois robôs.
- Estado: cada login grava só o seu `estado-<login>.json`; todos leem o conjunto; `merge-estado.ts` junta em `estado.json` (atômico) antes do envio.
- Fotos/telas/anexos: pasta de fotos por login; arquivos por Nosso nº (sem colisão).

## Robô de BAIXA no Corp em blocos
Ainda não existe pronto para rodar sozinho (hoje é supervisionado: `explorar.ts` + conferência por pixels). A vez da baixa vai para os documentos até existirem (1) `baixaComando` na grade (um .cmd que aceite HH:MM de parada, respeite `pausar-baixa[-<login>].flag`, use `pegarVezDoCorp`, e **saia com código 10 quando não houver o que baixar** — o login então ajuda nos documentos por 10 min) e (2) o arquivo `~/.robo-corp/baixa-ligada.flag`, criado só com a aprovação do Matheus. A baixa segue as regras combinadas (só o que tem prova, tolerância R$ 6, nada digitado sem conferência).

## Windows
`instalar-orquestrador.ps1` cria a tarefa "Robo Corp Orquestrador" (liga com o Windows e 00:05 todo dia; sem limite; nunca duas instâncias; reinicia se cair) e DESABILITA (não apaga) "Robo Corp", "Robo Corp Anexos", "Robo Corp Anexos FDS manha/tarde". Desfazer: `desfazer-orquestrador.ps1`.
