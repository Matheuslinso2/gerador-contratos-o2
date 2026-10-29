# Levantamento do padrão de coberturas por produto (ERP O2)

Data: 29/10/2026. Só leitura: nada foi gravado no banco, sem commit, sem push.
Método: baixei de 1 a 5 PDFs de documentos vigentes por produto e seguradora (apólice ou proposta, não boleto), extraí o texto e li o bloco de coberturas. Foram 88 PDFs lidos, escolhidos ao acaso entre os vigentes que têm PDF salvo. A amostra é pequena: serve para descobrir o padrão e o formato, não para provar frequência exata. Onde a amostra é de 1 ou 2 PDFs, está marcado.
Nenhum nome de cliente, CPF/CNPJ, endereço ou número de apólice foi copiado para este relatório.

## 1. Resumo rápido

| Produto | Vigentes (A/F) | Com PDF salvo | Padrão claro? | Leitor automático |
|---|---|---|---|---|
| Incêndio (imobiliário, residencial, empresarial) | cerca de 8.900 | cerca de 2.400 (mais cerca de 540 só pelo Corp) | Sim, por seguradora | Fácil: Porto, Tokio, Allianz, Yelum (uma tabela com nome, limite e prêmio) |
| Condomínio | 62 | 9 | Sim (Tokio, Allianz) | Fácil, mas a lista é longa (12 a 20 linhas) |
| Automóvel | 98 | 17 | Sim (Tokio, Porto, Azul, Mapfre, Suhai), com ressalvas | Médio: cada seguradora tem layout próprio |
| Equipamentos portáteis | 27 | 15 | Sim (Porto) | Fácil, mas 5 de 9 PDFs tentados têm senha |
| Vida | 67 | 4 | Parcial (1 PDF por seguradora) | Fácil por seguradora; falta amostra |
| RC (responsabilidade civil) | 10 | 0 a 1 | Não | Complicado: apólice longa (40 páginas), com sublimites e franquias |
| Viagem | 1 | 0 | Sem PDF | Não dá para levantar |
| Capitalização | 1.183 | cerca de 650 | Não tem cobertura | Não se aplica (título de capitalização) |
| Fiança (só conferência) | 2.554 | cerca de 680 | Sim | Já existe (ver seção 9) |

Os produtos "residencial" e "empresarial" não existem como produto no banco: são nomes de ramo dentro de `incendio` (IMOBILIARIO 4.851, 2 IMOBILIARIO 3.492, RESIDENCIAL 458, EMPRESARIAL 97). Por isso estão tratados juntos na seção 2.

## 2. Incêndio (inclui imobiliário, residencial e empresarial)

Uma regra vale para todas as seguradoras: o PDF tem uma tabela de coberturas com **nome, limite máximo de indenização (LMI), prêmio e, em alguns casos, participação obrigatória do segurado (POS) ou franquia**. A cobertura básica é sempre Incêndio (raio, explosão, fumaça e queda de aeronave). O resto é adicional.

### 2.1 Porto Seguro (amostra: 5 imobiliário + 3 residencial + 3 empresarial)

Dois formatos de tabela:

| Formato | Onde aparece | Título do bloco | Colunas |
|---|---|---|---|
| A (Porto Imobiliária) | ramo IMOBILIARIO | `COBERTURAS` / `LIMITE MÁXIMO DE INDENIZAÇÃO (R$)` / `PRÊMIO VALOR DO SEGURO (R$)` | nome, LMI, prêmio. Fecha com `TOTAL PRÊMIO COBERTURAS` |
| B (Porto Residência/Empresa) | RESIDENCIAL e EMPRESARIAL | `COBERTURAS CONTRATADAS` / `NOME DA COBERTURA  L.M.I (R$)  PREÇO (R$)  [P.O.S.]` | nome, LMI, preço. Depois vem o bloco `PARTICIPAÇÃO OBRIGATÓRIA DO SEGURADO` por cobertura. Fecha com `PREÇO LÍQUIDO DAS COBERTURAS` |

Coberturas vistas (quantos PDFs, dentro de cada formato):

| Cobertura (nome padrão) | Como o PDF escreve | Tipo | Frequência | LMI típico |
|---|---|---|---|---|
| Incêndio, explosão (e fumaça, queda de aeronave) | `INCÊNDIO, EXPLOSÃO, IMPLOSÃO,` / `INCÊNDIO, EXPLOSÃO, FUMAÇA E QUEDA` | Básica | A 5/5, B residencial 3/3, B empresarial 3/3 | R$ 120 mil a 1,2 milhão |
| Perda ou pagamento de aluguel | `PERDA OU PAGAMENTO DE ALUGUEL` / `PERDA DE ALUGUEL` / `PERDA OU PAGAMENTO DO ALUGUEL` | Adicional | A 5/5, B 6/6 | R$ 16 mil a 50 mil (cerca de 3 a 10% do prédio) |
| Conteúdo - Porto Imobiliária | `CONTEUDO - PORTO IMOBILIARIA` | Adicional (cortesia, prêmio R$ 0,01) | A 5/5 | 10% do prédio |
| Danos elétricos | `DANOS ELÉTRICOS` | Adicional | A 0/5, residencial 2/3, empresarial 1/3 | R$ 6.700 a 11 mil; POS 10% com mínimo (ex. R$ 850) |
| Vendaval, furacão, ciclone, tornado e granizo | `VENDAVAL, FURACÃO, CICLONE, TORNADO E QUEDA DE GRANIZO` | Adicional | só empresarial 1/3 | R$ 5.000 |
| Despesas de salvamento | `DESPESAS DE SALVAMENTO` | Adicional | empresarial 3/3 (algumas vezes só na cláusula particular) | R$ 20 mil |
| RC familiar | `RC FAMILIAR` | Adicional | empresarial 1/3 | R$ 30 mil |
| Quebra de vidros | `QUEBRA DE VIDROS` | Adicional | empresarial 1/3 | R$ 4.000 |
| Vazamento de tanques ou tubulações | `VAZAMENTO DE TANQUES OU TUBULAÇÕES` | Adicional | empresarial 1/3 | R$ 11 mil |

Observações:
- Três dos PDFs Porto "imobiliário" vieram marcados como tipo "outro" (boas-vindas com coberturas no meio): o bloco é o mesmo, só muda o cabeçalho da primeira página.
- Residencial e empresarial da Porto têm muitos PDFs **protegidos por senha** (6 de 9 tentados no residencial, 11 de 14 no empresarial). A senha da Porto são os 4 primeiros dígitos do CPF/CNPJ (já registrado na memória do projeto). A função `textoDoPdf` aceita a lista de CPFs para tentar; no teste passei lista vazia, então esses PDFs não foram lidos. Não testei o desbloqueio.
- Há também o bloco "SERVIÇOS CONTRATADOS" (plano de assistência: encanador, chaveiro, help desk etc.). Não é cobertura com LMI; sugiro guardar à parte como "assistência".

### 2.2 Tokio Marine (amostra: 7 apólices de imobiliário/residencial + 3 empresariais)

Imobiliário e residencial (formato C):
- Título: `Coberturas Contratadas  Limite Máximo de Indenização  Prêmio Líquido R$  [Franquias]`.
- Fecha com `Prêmio Líquido Total:` e logo depois `Limite Máximo de Garantia: R$ ...`.
- A cobertura que aparece por padrão é pequena: **sempre três linhas**.

| Cobertura | Como escreve | Tipo | Frequência | Observação |
|---|---|---|---|---|
| Incêndio, raio, explosão, fumaça e queda de aeronave | `Incêndio, Raio, Explosão, Fumaça e Queda Aeronave` (quebra em 2 linhas) | Básica | 7/7 | LMI R$ 250 mil a 375 mil |
| Despesas com aluguel | `Despesas com Aluguel` | Adicional | 6/7 | 3 a 5% do prédio (R$ 6 mil a 16,8 mil) |
| Assistência 24 horas | `Assistência 24 horas` (sem LMI, só prêmio) | Serviço | 7/7 | LMI vem como `-` |

Extra importante: existe uma frase `Limite Máximo Pactuado para Despesas de Contenção e Salvamento é de R$ 1.000,00` (fixo por apólice) e `Tipo de Cobertura: %Prédio: 70 %Conteúdo: 30` (divisão entre prédio e conteúdo). São dados do cabeçalho, não da tabela.

Empresarial Tokio (3 PDFs de 417 mil caracteres cada, são as condições gerais embutidas): título `Cobertura  Limite Máximo de Indenização - R$  Franquia / Participação Obrigatória do Segurado em Caso de Sinistro  Prêmio líquido - R$`. Aqui a lista é longa, com POS em coluna: Incêndio (POS 10% com mínimo R$ 1.500 só em caso de raio), Despesas de aluguel e instalação em novo local, Vendaval, Danos elétricos, Roubo, Lucros cessantes, Responsabilidade civil (todos os 3 de 3 contêm estes termos em algum lugar do PDF, mas só li a primeira tabela de perto). Para o leitor, a tabela de coberturas fica nas primeiras 6 páginas; o resto do texto é cláusulas.

### 2.3 Allianz (amostra: 4 + 3 residencial + 3 outros formatos)

Dois formatos:

| Formato | Título | Colunas |
|---|---|---|
| D (residencial/imobiliário) | `Coberturas  Limite Máximo de Indenização  Preço por Cobertura  Participação Obrigatória` | nome, LMI, preço, POS |
| E (empresarial/outros) | `COBERTURAS/ RISCOS COBERTOS  Limite Máximo de Indenização  Prêmio por Cobertura  Franquia % R$` | nome, LMI, prêmio, franquia (percentual e mínimo) |

Coberturas vistas no formato D (7 PDFs):

| Cobertura | Como escreve | Tipo | Frequência |
|---|---|---|---|
| Incêndio, raio, explosão, fumaça, queda de aeronave | `Incend / Raio / Expl / Fumaça / Q.Aero` | Básica | 5/7 |
| Perda e pagamento de aluguel | `Perda e Pagamento de Aluguel` | Adicional | 5/7 |
| Danos elétricos | `Danos Elétricos` (POS 10% com mínimo R$ 600) | Adicional | 5/7 |
| Assistência 24h | `Assistência 24h Essencial` (sem LMI) | Serviço | 6/7 |
| RC familiar | `RC Familiar` | Adicional | 3/7 |
| Gastos com defesa | `Gastos com Defesa` | Adicional | 3/7 |
| Ruptura de tanques e tubulações | `Ruptura de Tanques e Tubulações` | Adicional | 2/7 |

Formato E tem mais itens (Incêndio e complementares, Demolição e desentulho, Recomposição de registros e documentos, Tumultos/greves/lock-out, Bens em poder de terceiros, Derrame de sprinklers, Perda e/ou pagamento de aluguel), com **cada linha duplicada** (uma com prêmio, outra com franquia). O leitor precisa juntar as duas linhas pelo nome. Frase-chave de apoio: `*As coberturas de Incêndio, Queda de Raios, Explosão, Fumaça, Queda de Aeronave compreendem a Cobertura Básica`.

Um dos PDFs "residencial" da Allianz era só aviso de parcela em atraso (sem tabela de coberturas), então nem todo anexo serve.

### 2.4 Yelum (amostra: 3 apólices + 1 proposta de lotes)

- Título: `Coberturas Contratadas  LMI(R$)  Prêmio(R$)  Participação Obrigatória do Segurado`.
- Depois há uma segunda tabela `Ramo da cobertura contratada` (código SUSEP/ramo, ex. "14 - COMPREENSIVO RESIDENCIAL").

| Cobertura | Como escreve | Tipo | Frequência (3 apólices) |
|---|---|---|---|
| Incêndio / explosão / fumaça e queda de aeronaves (prédio e conteúdo) | `INCENDIO/ EXPLOSAO DE QUALQUER NATUREZA/ FUMACA E QUEDA DE AERONAVES (Prédio e Conteúdo)` | Básica | 3/3 (LMI R$ 250 mil a 686 mil; queda de raio com POS de 10% mínimo R$ 400) |
| Perda ou pagamento de aluguel | `PERDA OU PAGAMENTO DE ALUGUEL` (período indenitário de 6 meses) | Adicional | 3/3 |
| Assistência 24 horas | `ASSISTENCIA 24 HORAS - IMOBILIARIO BASICO` ou `COMPLETO` | Serviço | 3/3 |
| Danos elétricos | `DANOS ELETRICOS` (R$ 10 mil, POS 10% mínimo R$ 400) | Adicional | 1/3 |

Atenção: a proposta Yelum de lotes diz "Conforme relação de itens em anexo": as coberturas ficam numa **lista de itens separada**, não no corpo. Dos PDFs Yelum com anexo, 25 de 28 eram endossos (sem tabela de coberturas completa).

### 2.5 Zurich (amostra: 2)

Só 2 PDFs úteis, um deles com layout idêntico ao da Tokio (mesmo bloco `Coberturas Contratadas ... Franquias`) e outro com `Coberturas (Valores Expressos em Reais)  Limite Máximo de Indenização  Prêmio Líquido  Franquia`: Incêndio/queda de raio/explosão (R$ 200 mil), Despesas de contenção ou salvamento, Assistência Essencial. Amostra insuficiente: 132 vigentes e nenhum com anexo na pasta de documentos (só pelo Corp).

### 2.6 Lacunas em incêndio
- Brad (5), Alfa (4+1), HDI (2), Pottencial (1): sem PDF disponível ou sem leitura. Volume muito pequeno.
- Tokio incêndio: 5.933 vigentes, 838 com anexo no ERP + 461 só pelo Corp. Ou seja, a maior parte do estoque da Tokio **não tem PDF**; a ficha mostraria "sem coberturas" até o PDF ser anexado.

## 3. Condomínio

### 3.1 Tokio (amostra: 4)

Título: `Coberturas Contratadas  Limite Máximo de Indenização  Prêmio Líquido R$`. Bloco longo (cerca de 20 linhas), com **um quadro separado** "Cobertura P.O.S" com os percentuais de franquia por cobertura e uma tabela de plano de vida em grupo (Tipo do plano, Qtde de vidas, LMI por vida).

| Cobertura | Frequência (4 PDFs) | LMI típico |
|---|---|---|
| Incêndio, raio, explosão, fumaça e queda de aeronave | 4/4 | R$ 4 a 10 milhões |
| Danos elétricos | 4/4 | R$ 20 a 40 mil |
| Vendaval, furacão, ciclone, tornado e granizo | 4/4 | R$ 20 a 70 mil |
| Quebra de vidros, espelhos, anúncios luminosos | 4/4 | R$ 10 a 30 mil |
| Responsabilidade civil condomínio | 4/4 | R$ 100 mil |
| Responsabilidade civil síndico | 4/4 | R$ 100 mil |
| Roubo e subtração de bens com arrombamento | 3/4 | R$ 10 a 20 mil |
| Responsabilidade civil portões automáticos | 3/4 | R$ 20 mil |
| Incêndio de bens de condôminos | 3/4 | R$ 500 mil |
| Impacto de veículos | 3/4 | R$ 20 a 70 mil |
| Responsabilidade civil garagem (incêndio e roubo) | 2/4 | R$ 50 mil |
| Tumulto, greve e lock-out | 1/4 | R$ 20 mil |
| Desmoronamento | aparece no quadro de POS | |
| Assistência 24 horas plano básico | 4/4 | sem LMI |
| Vida em grupo dos funcionários: Morte, I.P.A., I.E.A., I.P.D.F., D.I.T., Auxílio alimentação, Auxílio funeral | 4/4 (Morte) | R$ 35 mil a 50 mil por vida |

### 3.2 Allianz (amostra: 2)

Título: `COBERTURAS  Limite Máximo de Indenização  Preço por Cobertura  Franquia % R$`. Coberturas: Básica Simples (incêndio, raio, explosão, queda de aeronave, fumaça), Danos elétricos, Derrame de sprinklers, Desmoronamento, Incêndio de bens de condôminos, Quebra de vidros/anúncios luminosos, RC guarda de veículos (parcial), RC condomínio, RC síndico, Ruptura de tanques e tubulações, Vendaval/ciclone/tornado/granizo, Gastos com defesa, Assistência 24h. Todos os 2 PDFs tinham RC condomínio, RC síndico, RC guarda veículos, Ruptura, Vendaval, Gastos com defesa. Franquia vem em duas colunas (percentual e mínimo em reais).

### 3.3 Outras
HDI (5) só tem cotação, Bradesco (3) sem PDF, Porto (1) não lido. Amostra total: 6 PDFs.

## 4. Automóvel

Observação importante: o ramo AUTOMOVEL traz também **Porto Bike** (bicicleta). 2 dos 4 PDFs Porto "automóvel" eram de bike. Coberturas muito diferentes (ver 4.3).

### 4.1 Tokio (amostra: 4)
Título: `Descrição  Limite Máximo Indenização R$  Prêmio Líquido R$` (a tabela vem logo depois dos dados do veículo). Lista fixa de 12 linhas, onde as não contratadas aparecem com `Não contratada` e prêmio 0,00. Isso ajuda: o leitor pode ignorar linhas "Não contratada/Não possui".

| Cobertura | Frequência |
|---|---|
| Colisão, incêndio e roubo/furto (100% do valor referenciado, FIPE) | 4/4 |
| RCF-V Danos materiais (R$ 50 mil, por exemplo) | 4/4 |
| RCF-V Danos corporais | 4/4 |
| RCF-V Danos morais | linha presente 4/4 (contratada em parte) |
| APP invalidez e morte por passageiro | linha presente 4/4 (na amostra estava "Não contratada") |
| Assistência 24 horas (VIP) | 4/4 |
| Km adicional de reboque, Acessórios, Despesas extraordinárias, Blindagem, Extensão 0 km | linha presente, normalmente "Não contratada" |

Franquias aparecem em outro bloco: `Isenção de 1ª Franquia Parcial`, tipos de oficina e peça, vidros, carro reserva.

### 4.2 Porto Auto, Azul (amostra: 2 Porto auto + 1 Azul)
Mesmo layout dos dois: título `Coberturas  Valor máximo de indenização  Prêmio LMI  Valor do seguro`, em 3 grupos:
- Casco: `Colisão/Incêndio/Roubo/Furto` (Porto: 100% do valor referência; Azul: `Incêndio, roubo e furto`, 80%), Blindagem, Kit gás, Acessórios, Equipamentos especiais, Carroçaria (os cinco últimos com "Não contratado" quando zerados).
- Passageiros: `Morte/Invalidez/Despesas Médico-Hospitalares` (R$ 10 mil).
- Terceiros: Danos materiais, danos corporais, danos morais/estéticos (R$ 5 mil a 20 mil, ex. R$ 75 mil / R$ 150 mil).
- Mais um bloco "Coberturas adicionais, serviços e benefícios" com códigos entre parênteses (ex. `(135M) Danos Morais`, `(38L) Vidros`, `(93D) Custos de defesa`, `(37C) Assistência 200 km`).
- Franquias de vidros em quadro separado.

Observação de leitura: o texto do PDF extraído às vezes vem com colunas embaralhadas (valor antes do nome). Vai precisar de regra para recolar nome e limite.

### 4.3 Porto Bike (2 PDFs)
Título `COBERTURAS CONTRATADAS  NOME DA COBERTURA  L.M.I (R$)  PREÇO (R$)`: Danos à bike (POS 10% mínimo R$ 800), Subtração da bike, Danos elétricos, Responsabilidade civil, Acidentes pessoais individual. Sugestão: tratar como sub-produto "bike".

### 4.4 Mapfre e Suhai
- Mapfre (3 endossos lidos): título `COBERTURAS CONTRATADAS E LIMITES MÁXIMOS DE INDENIZAÇÃO (LMI)`. Linhas: Básica Colisão/Incêndio/Roubo/Furto (100% FIPE), RCFA Danos materiais/corporais/morais-estéticos/objetos transportados (gratuito), APP morte e invalidez por passageiro, Vidros, Extensão de reboque (300 a 600 km), assistência (gratuita). Funciona mesmo no endosso, mas a coluna de código de barras vem misturada no texto.
- Suhai: a proposta lida tem `COBERTURAS CONTRATADAS  Cobertura  LMI (R$)  Prêmio (R$)  Franquia (R$)  Vl.Franquia (R$)` com `Ind. Integral por Roubo ou Furto do Veículo`, RCF danos materiais/corporais/morais (aparecem como "Não Contratado") e Assistência 24h Plano 1. A grande maioria dos PDFs Suhai é endosso/resumo curto com `Cobertura(s): Importância Máxima Segurada: Franquia: Prêmio Líquido`, em colunas separadas e sem nome claro (ex. "EXCLUSIVA ROUBO/FURTO TOTAL"). Suhai vende produto de roubo/furto (32 vigentes), então a cobertura padrão é uma só.
- Allianz auto (4), HDI (4), Itaú (3), Bradesco (3): sem PDF.

## 5. Equipamentos portáteis (Porto)

Amostra: 4 PDFs lidos (5 mais ficaram protegidos por senha).
Título: `COBERTURAS CONTRATADAS  Plano Roubo + Quebra + Furto Simples  L.M.I (R$)  PREÇO (R$)`. O nome do plano (ex. "Plano Roubo", "Plano Roubo + Quebra + Furto Simples") vem no cabeçalho do bloco.

| Cobertura | Frequência | Observação |
|---|---|---|
| Quebra acidental | 4/4 linhas (às vezes `NAO CONTRATADA`) | POS 25% das indenizações |
| Roubo e furto mediante arrombamento | 4/4 | LMI de R$ 1,4 mil a 4,4 mil, POS 25% |
| Furto simples | 4/4 linhas (às vezes não contratada) | POS 25% |
| Transações digitais | 4/4 linhas, não contratada em todas | sem valor |

O leitor deve **descartar** linhas com `NAO CONTRATADA`. Os 5 PDFs protegidos precisam do desbloqueio por CPF (não testado).

## 6. Vida

Poucos PDFs por seguradora (1 cada), então o padrão é indicativo.

| Seguradora | Título do bloco | Coberturas vistas |
|---|---|---|
| Porto | colunas `RAMO  GARANTIAS  CAPITAIS SEGURADOS  PRÊMIOS` (dentro de `DADOS DO SEGURO`) | Morte (natural), Morte acidental, Invalidez permanente total ou parcial por acidente, Assistência funeral familiar, Diária por incapacidade temporária. Cada linha começa por código de ramo (1391, 1381, 1329, 1390) |
| Tokio | `Descrição das Coberturas  Capitais Segurados (R$)  Franquias  Prêmios Anuais (R$)` | Morte acidental, Invalidez permanente total ou parcial por acidente (amostra tinha só as duas, R$ 20 mil) |
| Sulamérica | `COBERTURA(S)  Cobertura: Carência até: Franquia: Capital - R$: Valor do Prêmio - R$:` | Morte, Morte acidental, Funeral (R$ 7,3 mil) mais bloco "ASSISTÊNCIA(S)" |
| Allianz | `CAPITAL  PRÊMIO ANUAL` | Morte, IEA (morte acidental), IPA (invalidez por acidente), IFPD (invalidez funcional por doença) |

Só há 4 PDFs (de 67 vigentes), então a cobertura de Vida só aparece para 6% dos documentos. As siglas (IEA, IPA, IFPD, DIT) merecem uma tabela de nomes por extenso.

## 7. Responsabilidade civil (RC) e Viagem

- **RC** (10 vigentes): só 1 apólice Tokio com PDF. Tem 40 páginas. Estrutura: `Cobertura Básica: Aplicação da Franquia  Sublimites  Prêmio por Cobertura` e `Coberturas Adicionais: ...`. Básica = `INDENIZAÇÃO E ACORDOS` (por reclamação, até 80% do LMG, franquia 10% das perdas com mínimo). Adicionais vistas: Despesas emergenciais (até 10% do LMI), Custos de comparecimento, Custos de publicidade. Yelum (7) e Allianz (1) sem PDF no ERP. **Padrão não fechado**: o texto extraído embaralha as colunas (limites e franquias ficam separados do nome) e a apólice RC é feita sob medida.
- **Viagem**: 1 documento (Porto), sem PDF. Não foi possível levantar.

## 8. Capitalização

Os PDFs de Capitalização (Brasilcap, Icatu, Porto, Mapfre) são certificados do título e não trazem a palavra "cobertura". Em 40 PDFs tentados de Brasilcap e 40 de Icatu nenhum trouxe tabela de coberturas (muitos eram outros anexos, como ficha de cadastro/análise cadastral do cliente, que não devem ser lidos para este fim). Recomendação: na ficha da capitalização, mostrar dados do título (modalidade, prazo, valor, resgate), não "coberturas". Esse levantamento não tem como entregar coberturas aí.

## 9. Fiança (conferência do que já existe)

Banco hoje (`apolice_documentos.coberturas`): Pottencial 854 de 1.578, Porto 643 de 1.332, Tokio 136 de 207, TOO 132 de 145, Yelum 4 de 18, sem seguradora 0 de 61, Bradesco 0 de 8.

PDFs lidos para conferir (4 por seguradora): todos têm bloco de coberturas, com nomes bem previsíveis.

| Seguradora | Título do bloco | Coberturas vistas |
|---|---|---|
| Pottencial | `COBERTURAS  VERBA DECLARADA  LIMITE COBERTO  PRÊMIO LÍQUIDO` | Aluguel + encargos (detalhando Água, Luz, Gás, IPTU, Condomínio), Danos ao imóvel, Multa por rescisão contratual, Pintura interna e externa |
| Porto | `COBERTURAS CONTRATADAS E LIMITES MÁXIMOS DE GARANTIA` | Aluguel, Desp. ord. condominiais, Danos ao imóvel, Pintura interna, Multa por rescisão contratual (+ POS: 20% da indenização, mínimo R$ 200, só em Danos ao imóvel) |
| Tokio | `Coberturas e Assistências` | Aluguel (até 30 vezes a verba), Desp. ord. condominiais, Água, Danos ao imóvel (até 6x aluguel), Pintura interna (até 3x), Multa por rescisão (até 3x), Assistência 24h plano completo |
| TOO | `COBERTURAS  VERBA DECLARADA  LIMITE DE RESPONSABILIDADE  PRÊMIO LÍQUIDO` | Aluguel, IPTU, Condomínio, (+ lista de benefícios de assistência) |

Os cinco nomes (Aluguel, Condomínio/Despesas ordinárias, Danos ao imóvel, Pintura, Multa) são compatíveis com o que a Fiança já grava. Para fechar os faltantes, vale reprocessar os PDFs dos vigentes que ainda não têm `coberturas`.

## 10. Como o leitor automático deve funcionar (recomendação)

1. **Achar o bloco** por uma destas âncoras (por seguradora, em ordem): `COBERTURAS CONTRATADAS`, `Coberturas Contratadas`, `COBERTURAS` (sozinho numa linha), `COBERTURAS/ RISCOS COBERTOS`, `Coberturas (Valores Expressos em Reais)`, `Descrição Limite Máximo Indenização` (auto Tokio), `RAMO GARANTIAS CAPITAIS SEGURADOS` (vida Porto). Em todos, o bloco termina em `Prêmio Líquido Total`, `PREÇO LÍQUIDO DAS COBERTURAS`, `TOTAL PRÊMIO COBERTURAS` ou `Prêmio Líquido`.
2. **Extrair** por linha: nome + LMI + prêmio (+ POS/franquia). Os nomes quebram em duas linhas (ex. `Incêndio, Raio, Explosão, Fumaça e Queda` / `Aeronave`): juntar quando a linha seguinte não tiver número.
3. **Descartar** linhas `Não contratada`, `NAO CONTRATADA`, `Não possui`, `Não contratado`.
4. **Normalizar** nomes por tabela de sinônimos (a mesma cobertura aparece com 3 a 5 grafias, ex. aluguel: `Perda e Pagamento de Aluguel` = `PERDA OU PAGAMENTO DO ALUGUEL` = `Despesas com Aluguel` = `Perda e/ou Pagamento de Aluguel`).
5. **Classificar** como básica (a primeira da tabela, sempre Incêndio no incêndio e no condomínio; Colisão/Incêndio/Roubo/Furto no auto) ou adicional (todo o resto). "Assistência 24h" e "Serviços contratados" ficam como serviço, sem LMI.
6. **Allianz formato E**: juntar as duas linhas repetidas pelo mesmo nome.
7. **Senhas**: Porto (residencial, empresarial, portáteis) e provavelmente outros precisam de desbloqueio com os 4 primeiros dígitos do CPF/CNPJ do segurado.
8. **Documentos sem tabela** (endosso curto, aviso de parcela, cotação): marcar "não lido", nunca inventar.

## 11. O que falta

- **Fácil e pronto para construir** (padrão claro): incêndio Porto/Tokio/Allianz/Yelum, condomínio Tokio/Allianz, portáteis Porto, auto Tokio/Porto/Azul/Mapfre.
- **Precisam de mais amostra antes de fechar o leitor**: Vida (1 PDF por seguradora), Zurich, auto Suhai, empresarial Tokio/Allianz (vários layouts), RC.
- **Sem PDF ou sem texto**: Viagem (0), RC Yelum/Allianz (0), Brad/HDI/Itaú/Alfa em todos os produtos, auto Allianz (0). Tokio incêndio: 838 de 5.933 vigentes têm PDF no ERP e outros 461 só pelo Corp; o resto (cerca de 4.600) não tem PDF.
- **PDFs protegidos por senha**: Porto residencial, empresarial e portáteis (cerca de 55% das tentativas). Nenhum PDF "escaneado sem texto" apareceu na amostra.
- **Capitalização**: não tem cobertura.
- **Cobertura por endosso**: o bloco de cobertura pode mudar com endosso; o leitor deve preferir a apólice mais recente, e nos produtos com endosso curto (Suhai, Yelum) não ler o endosso como se fosse a apólice.
