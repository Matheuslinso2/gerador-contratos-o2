# Robô do Corp → SharePoint

Exporta do Corp (Agger) os relatórios que alimentam o SharePoint "O2 Data
Analytics" (e, por ele, o Power BI e o Workspace), sem ninguém precisar entrar
no Corp. Decisão do Matheus em 21/10/2026: roda **neste PC**, com um **usuário
próprio do robô** no Corp, e salva os Excel já com o nome e a pasta certos numa
**pasta sincronizada do SharePoint** (o OneDrive sobe sozinho).

O Corp é um programa de computador transmitido como imagem para o navegador
(não há botões/campos na página), então o robô trabalha como uma pessoa:
teclado (Alt+letra dos menus, Tab, datas digitadas) e, onde precisa, procura
um "modelo" de imagem na tela (pasta `modelos/`) para clicar.

## Preparar (uma vez)

1. No Corp, criar o usuário do robô (ex.: `robo`) com acesso ao Gerenciador de
   Relatórios.
2. Copiar `config.exemplo.json` para `C:\Users\<usuário>\.robo-corp\config.json`
   e preencher usuário/senha (o arquivo fica FORA do projeto; nunca no Git).
3. No site do SharePoint `analyticspwb`, abrir a biblioteca
   `Documentos Compartilhados` e clicar em **Sincronizar**. A pasta aparece no
   Explorador de Arquivos; colocar o caminho dela em `pastaSharepoint`
   (até `01. BASES DE DADOS\01. EXTRAÇÕES CORP`).
4. Rodar o mapeamento (abaixo) uma vez, com alguém acompanhando.

## Rodar

```bash
npx tsx scripts/robo-corp/exportar.ts --mapear
```
Entra no Corp e tira fotos de cada passo em `scripts/robo-corp/saida/mapa/`
(serve para calibrar os modelos de imagem na primeira vez e para diagnosticar).

```bash
npx tsx scripts/robo-corp/exportar.ts --so grade_prods_2026
```
Exporta um relatório só (teste).

```bash
npx tsx scripts/robo-corp/exportar.ts
```
Exporta todos os relatórios do `config.json`, salva em `pastaSaida` e copia
para `pastaSharepoint` (se configurada). Depois, o Workspace lê o SharePoint
pelo cron `corp-sharepoint` — ou, enquanto o acesso ao SharePoint não estiver
configurado na Vercel, pela carga local:
`npx tsx scripts/corp-sharepoint/carregar-local.ts <pastaSaida>`.

Agendar: Agendador de Tarefas do Windows → "Robô Corp", diário às 02:00,
ação `cmd /c cd /d "<pasta do projeto>" && npx tsx scripts/robo-corp/exportar.ts`.
Fotos de cada execução ficam em `saida/<data>/` para conferir se deu certo.

## Filtros (deduzidos das próprias planilhas do SharePoint, 21/10/2026)

- Propostas Grade por Produtor: Seguradora e Ramo TODOS, Data = **Início de
  Vigência**, período por ano (2020–2021, 2022–2023, 2024–2025, 2026),
  Apólices + Endossos + Faturas + Endossos de Cancelamento, Prêmio Líquido,
  comissões marcadas. Os 4 arquivos são reexportados sempre (um cancelamento
  de hoje cai no ano da vigência).
- Clientes com Documentos e Sinistros Geral - Grade: sem filtro de período
  (histórico inteiro).
