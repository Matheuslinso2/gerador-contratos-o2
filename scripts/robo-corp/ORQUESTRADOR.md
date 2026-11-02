# Orquestrador do Corp (24 h, N logins, um robô por login)

**Regra de ouro:** nunca dois robôs no mesmo login. Cada login tem a sua trava (`~/.robo-corp/login-em-uso.json` para o principal, `login-em-uso-<id>.json` para os demais).

## Como funciona
- `grade-24h.json`: a grade. `fixos` (Robo Corp 12:00/20:00 e ciclo de comissões 2 em 2 h nos dias úteis; rodam no login `principal` e têm prioridade), `workers` (um por login; `agenda` opcional), tempos de passagem.
  `npx tsx scripts/robo-corp/orquestrador.ts --simular` mostra o que cada login faria nas próximas 24 h, sem executar nada.
- Passagem de vez sem matar ninguém: o orquestrador cria `~/.robo-corp/pausar-docs[-<login>].flag`; o robô termina o documento em andamento, sai e libera o login. Só se não liberar em 12 min o processo é encerrado. Compromissos fixos nunca são interrompidos.
- Log: `scripts/robo-corp/saida/orquestrador.log` (`[login] ASSUMIU`, `LIBEROU`, falhas). Se um login entra e não enxerga o menu: `LOGIN SEM PERMISSÃO` no log, o login fica 6 h pausado (aviso ao Matheus), sem insistir.
- Pós-processamento a cada 6 h (03:00, 09:00, 15:00, 21:00 — `posProcessamento.horas` na grade; sem login do Corp, roda em paralelo aos robôs): `anexos-pos.cmd` → `pos-corp.ts`. Nunca roda duas vezes ao mesmo tempo (trava `~/.robo-corp/pos-corp.lock`) e **adia o ciclo se houver menos de 1 GB de memória livre** (`--forcar` ignora). Passos, nesta ordem, cada um independente (se um falha, os outros seguem):
  1. junta o estado dos robôs, envia as telas, OCR local das telas, lê as telas, envia os anexos ao Workspace, vincula, limpa as fotos;
  2. lê os PDFs novos: apólices/endossos/certificados (`ler-apolices-vigentes-pdf.ts`; os PDFs de imagem passam pelo OCR local do Windows, `ocr-pdf-win.ps1`, até 60 por ciclo) e propostas (`ler-propostas-pdf.ts`);
  3. aplica no ERP **só campo vazio e só quando número + vigência + CPF/CNPJ conferem** (`ler-propostas-pdf.ts --aplicar`); o vencimento provado por fatura prevalece; o que diverge NÃO é aplicado e vira lista (`erp_pdf_divergencias_pendentes`);
  4. `erp_preencher_dt_emissao`, `erp_atualizar_vencimentos`, `erp_cobranca_atualizar`;
  5. relatório curto em português: arquivo `saida/relatorio-pos-<data-hora>.txt` + linha em `erp_robo_corp_relatorio` (situação ok/parcial/adiado/erro). Sem IA paga em nenhum passo. Não há mecanismo de e-mail de alerta no projeto para isto: o resumo fica no banco e no arquivo.

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
