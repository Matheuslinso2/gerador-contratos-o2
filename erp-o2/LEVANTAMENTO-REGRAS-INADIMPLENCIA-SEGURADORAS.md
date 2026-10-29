# Levantamento: parcelas em aberto, avisos e extratos por seguradora

Data do levantamento: 29/10/2026. Somente leitura: nada foi gravado no banco, nada foi enviado, nenhum commit ou push.
Serve de base para a aba "Parcelas · cobrança" do ERP (atenção / urgente / risco de cancelamento). A tabela `erp_regras_cancelamento` continua vazia: este documento diz o que tem prova e o que não tem.

## Resumo em linguagem simples

- A regra que cada seguradora usa para cancelar por falta de pagamento quase nunca aparece com um número de dias nos PDFs que temos. Os PDFs das apólices (Fiança, Incêndio, etc.) trazem a apólice e, em alguns casos, só um resumo; as Condições Gerais completas só vieram em poucos casos (Tokio Empresarial, Bradesco, Yelum, Alfa).
- Regra com frase explícita e número de dias em Condições Gerais: Tokio (Incêndio/Empresarial) e Bradesco (Incêndio residencial). Para a 1ª parcela, várias seguradoras dizem "cancela automático, sem dias" (Tokio, Yelum, Suhai, Bradesco, Alfa).
- Onde os números de dias vêm só dos e-mails oficiais (certeza média): Too Fiança (mais de 30 dias de atraso fica passível de cancelamento; aviso formal dá 7 dias), Allianz Residência (20 dias após o vencimento), Yelum (cerca de 14 dias entre a carta de cobrança e a data de cancelamento, 1ª parcela).
- Porto (Fiança, Incêndio, Condomínio, Portáteis), Pottencial (Fiança), Zurich, HDI, Mapfre, Liberty: nenhum número de dias de cancelamento foi encontrado.
- Os avisos por e-mail existem para Tokio, Suhai, Too, Yelum, Alfa, Allianz, Pottencial e, de outro tipo, Porto. Só Allianz (zip) e Pottencial (xlsx) mandam planilha; os demais mandam um e-mail por segurado, por título ou por apólice.
- Nos extratos de comissão, só Bradesco tem linhas de parcela paga com comissão zerada. Alfa, Icatu, Mapfre, HDI, Azul, Zurich e Sulamérica quase não ligam às parcelas e não servem para concluir inadimplência.

---

## PARTE A: condições gerais (PDFs)

Como foi feito: baixei do Storage (`anexos-documentos` e `corp-anexos`) uma amostra de PDFs por seguradora e produto (cerca de 6 a 10 por grupo, mais os maiores arquivos, que costumam trazer as Condições Gerais), extraí o texto e procurei: falta de pagamento, inadimplência, não pagamento, atraso, cancelamento, suspensão, mora, parcela, prazo de tolerância.
Cobertura da amostra: 20 grupos seguradora × produto, cerca de 230 PDFs lidos. Amostra, não leitura de tudo: um grupo pode ter outro PDF com texto diferente.

### Tokio Marine

**Incêndio / Empresarial (Tokio Marine Empresarial), certeza alta.** Fonte: Condições Gerais dentro do PDF da apólice completa (cerca de 170 páginas), item 16.
- 1ª parcela (ou prêmio à vista): "configurada a inadimplência ... implicará no cancelamento automático da apólice". Sem dias.
- Demais parcelas: a seguradora notifica e dá "prazo de 15 (quinze) dias para a purgação da mora"; se não pagar, suspende a garantia e "após 30 (trinta) dias da suspensão da garantia, o contrato será automaticamente resolvido". Soma: cerca de 45 dias contados da notificação (não do vencimento).
- Frase que prova: "concedendo-lhe prazo de 15 (quinze) dias para a purgação da mora ... APÓS 30 (TRINTA) DIAS DA SUSPENSÃO DA GARANTIA, O CONTRATO SERÁ AUTOMATICAMENTE RESOLVIDO".

**Fiança (Tokio Aluguel), certeza alta só para a 1ª parcela.** Fonte: apólice Tokio Fiança, rodapé do carnê. Frase: "A mora relativa à prestação única ou à primeira parcela do prêmio resolve de pleno direito o contrato". Para as demais: "serão cobrados multa e juros de mora conforme estabelecido nas Condições Gerais". As Condições Gerais da Fiança não vieram nos PDFs lidos: dias não encontrado.

**Condomínio e RC.** Condomínio: "falta de pagamento da primeira parcela ou de qualquer uma das subsequentes poderá implicar o cancelamento da apólice" (sem dias). RC: falta da 1ª parcela, "a Seguradora poderá cancelar"; nas demais, a vigência é reduzida pela tabela de prazo curto (sem dias).

**Automóvel.** Apólices dizem que cartão sem limite pode gerar "cancelamento por falta de pagamento" (sem dias).

### Yelum (ex-Liberty)

**Incêndio, certeza alta para a 1ª parcela.** Fonte: apólice Yelum (parceiro de locação). Frases: "A falta de pagamento da prestação única ou da primeira parcela implicará no automático cancelamento da apólice desde o inicio de vigência" e, para as demais, "implicará na suspensão das garantias ... Se o Segurado, notificado para regularização da parcela não o fizer, ... ocorrendo a resolução do contrato". Número de dias para as demais parcelas: não encontrado. Outro texto (cláusula do correntista): atraso "implicará na suspensão imediata das coberturas".

### Suhai

**Automóvel.** Apólice: "A inadimplência da 1.a parcela da apólice implica no cancelamento automático da cobertura do seguro" (sem dias; certeza alta para 1ª parcela). Demais parcelas: o e-mail de aviso remete à Lei 15.040/2024 e às Condições Gerais ("Permanecendo o não pagamento, a apólice será posteriormente cancelada"). Dias: não encontrado.

### Alfa

**Incêndio (certificados Empresarial, Residencial, Imobiliárias), certeza alta pelo texto.** Frase: "O não pagamento do prêmio mensal na data indicada no respectivo documento de cobrança implicará no cancelamento automático do seguro". Complemento: a Seguradora "poderá propor nova data de vencimento" e, se não pagar nessa nova data, o cancelamento automático vale. Na prática a Alfa manda avisos "pendente há 2 e 4 dias" sem cancelar de imediato, então o texto é mais duro que a prática. Não há número de dias de tolerância.

### Bradesco (1 apólice no ERP)

**Seguro Residencial Sob Medida, certeza alta.** "O não pagamento ... da primeira parcela ... ensejará automaticamente ... o cancelamento da apólice". Demais: a resolução "está condicionada a notificação prévia e não poderá ocorrer em prazo inferior a 30 (trinta) dias após a suspensão da garantia".

### Allianz

Incêndio (59 apólices) e Condomínio: os PDFs lidos (apólice + boleto) não trazem cláusula de cancelamento por falta de pagamento. Só aparece no boleto "Juros por atraso: Seguros - 0,27% ao dia ... e Multa de 2%". Condições Gerais: não encontrado. O número de dias vem de e-mail (ver Parte B).

### Porto Seguro

- **Fiança (Porto Fiança e Fiança Locatícia Essencial):** lido o PDF da apólice (com glossário das CG) e documentos anexos. Sem número de dias. Frases úteis: "CONFORME CONTRATO, O SEGURO PODERÁ SER SUSPENSO OU CANCELADO CASO O BOLETO NÃO SEJA PAGO ATÉ O VENCIMENTO" e "Havendo inadimplência o pagamento deverá ser efetuado na seguradora, acrescido de uma taxa de 2% a.m. A reativação da cobertura ficará sujeita a ... nova análise do risco. Havendo cancelamento não será admitida". Definição de cancelamento: dissolução do contrato por "inadimplência do Segurado". Dias: não encontrado.
- **Incêndio e Condomínio:** "A FALTA DE PAGAMENTO DE QUALQUER UMA DAS DEMAIS PARCELAS SUBSEQUENTES À PRIMEIRA PODERÁ IMPLICAR O CANCELAMENTO DA APÓLICE, NOS TERMOS DA CLÁUSULA DE FRACIONAMENTO DE PRÊMIO". A cláusula de fracionamento (onde estariam os dias) não veio nos PDFs: não encontrado. Os boletos da Porto trazem "AUTORIZADO O RECEBIMENTO DO BOLETO ATÉ 55 DIAS APÓS O VENCIMENTO, ACRESCIDO DE JUROS DE 0,0666% AO DIA ... PODE ACARRETAR A SUSPENSÃO DA COBERTURA ... E/OU CANCELAMENTO". Isso é prazo para o banco receber o boleto, não regra de cancelamento (certeza baixa).
- **Portáteis:** 4 apólices lidas, nenhuma cláusula de pagamento. Não encontrado.

### Pottencial

- **Fiança:** textos curtos: "A falta de pagamento dos prêmios poderá acarretar o ajuste do prazo de vigência da apólice, a suspensão da cobertura ou até o cancelamento"; "Em caso de inadimplência ... a SEGURADORA concederá prazo ao LOCADOR ... nos termos previstos nas Condições Gerais". Dias: não encontrado. Há, num documento de Fiança Pottencial, um anexo de seguro incêndio com o mesmo texto da Alfa ("cancelamento automático" do prêmio mensal); não vale como regra da Fiança.

### Too

- **Fiança:** 10 PDFs (apólice e contratos anexos). Nenhuma cláusula de cancelamento por falta de pagamento nas Condições Gerais. Só os e-mails dão os números (ver Parte B). Condições Gerais da Fiança Too: não encontrado.

### Zurich, HDI, Mapfre, Azul, Mitsui, Sulamérica, Liberty

- Zurich (incêndio, 3 PDFs), HDI, Mapfre, Azul e Mitsui (automóvel, 1 PDF cada), Sulamérica (vida, boletos): nenhuma cláusula de cancelamento por falta de pagamento nos PDFs lidos. Não encontrado.
- Capitalização (Brasilcap, Icatu, Mapfre Cap): não pesquisei Condições Gerais; título de capitalização não é apólice com cancelamento por parcela da mesma forma. Não levantado.

---

## PARTE B: e-mails (últimos 6 meses)

Como foi feito: 12 caixas (matheus, nathalie, william, patricia, vanessa, fabricio, henrique, kamila, bruna, kelly, victoria, viniciusmaia), só leitura, 12.254 mensagens de seguradoras com termos de parcela/cancelamento/atraso; agrupei por remetente e assunto e li o corpo de uma amostra de cada tipo. Os mesmos e-mails chegam em várias caixas (grupos de e-mail), então os números de mensagens são inflados; use só como ordem de grandeza. Nenhum dado pessoal foi copiado para este relatório.

### Tokio Marine (a que mais manda)
- **Comunicados 1º, 2º e 3º por título.** Remetente automático da Tokio. Formato: corpo do e-mail (HTML) com carta e boleto/QR Pix; sem anexo útil. Traz: nº da apólice, parcela "X de Y", vencimento, valor, produto (Automóvel, Residencial, Empresarial, Aluguel/Fiança, Vida) e, para imobiliárias, a fatura por "lote" (mês de faturamento).
- Ritmo observado: 1º comunicado cerca de 2 a 9 dias após o vencimento; 2º cerca de 2 dias depois; 3º cerca de 4 dias depois do 2º (cartão recusado: 7 e 11 dias). Algumas apólices recebem "COMUNICADO ÚNICO" (Aluguel, cartão indisponível).
- Texto fixo: "O não pagamento dentro do prazo indicado nesta notificação resultará na suspensão automática das coberturas, e não haverá cobertura para sinistros ocorridos após o vencimento original ... Caso a inadimplência persista, o contrato de seguro será cancelado, nos termos da legislação vigente." **Não cita número de dias até o cancelamento.** Para fatura de imobiliária: "os contratos de seguro serão cancelados" (idem, sem dias).
- **Lista "Parcelas Inadimplentes"** (e-mail com tabela): atraso "entre 11 e 29 dias", todos os valores de risco decorrido e parcelas acima de R$ 500 de risco a decorrer. Só 3 envios (24/06, 01/07, 29/07); depois a Tokio avisou um painel no portal ("Dashboard de Inadimplência", 02/07) e uma função digital de regularização (20/05). Prazo de cancelamento: não cita.
- Cancelamentos efetivados chegam como "Endosso Digital".

### Suhai
- **Aviso por segurado, automático**, corpo do e-mail, com cópia ao corretor. Assuntos: "PARCELA EM ABERTO HÁ 3 DIAS" (cerca de 180 mensagens) e "HÁ 20 DIAS" (cerca de 20). Traz: nº da apólice, endosso, parcela, valor, vencimento. Não traz data de cancelamento.
- Texto: 1ª parcela não paga suspende a cobertura; demais seguem a Lei 15.040/2024 e as CG; "Permanecendo o não pagamento, a apólice será posteriormente cancelada". Sem prazo em dias.
- Quando cancela, manda "CANCELAMENTO DO SEGURO ... APÓLICE/ENDOSSO" com link do endosso.

### Too Seguros
- **"Comunicado de Parcelas em Atraso"** (já tratado pelo trabalho do Nibo): tabela no corpo, por corretora. Frase: "apólices inadimplentes há mais de 30 dias são passíveis de cancelamento" (de acordo com as condições gerais do produto). Cerca de semanal (06/10, 14/10, 20/10).
- **"Seguro Fiança Locatícia | Aviso de cancelamento por inadimplência"**: um e-mail por apólice, no corpo. Traz as parcelas em atraso (nº, vencimento, valor) e uma data limite: "Se o pagamento não for regularizado até DD/MM, a apólice será cancelada por inadimplência". A data limite é sempre 7 dias depois do envio (06/10 para 13/10; 14/10 para 21/10; 20/10 para 27/10). **As mesmas parcelas (vencidas desde agosto) receberam três avisos seguidos com a data empurrada**, então a data limite não é cancelamento automático.
- Também: "Apólice cancelada" (endosso no Portal Parceiro) e "pendência no cancelamento (pagamento de fatura)".

### Yelum
- **"Carta de Cobrança - Yelum Seguros"**: corpo HTML, irregular (10 datas em 6 meses). Traz apólice, parcela (nas lidas, a 1ª), valor e "DATA DE CANCELAMENTO". Datas lidas: carta 22/09 para cancelar 05/10; 16/10 para 30/10; 20/10 para 04/11 (13 a 15 dias depois). Texto: "o não pagamento da 1º parcela implica no automático cancelamento da apólice, retroativo à data de início de vigência".
- **"Relatório Parcelas Vencidas"**: toda quinta-feira, anexo PDF protegido por senha (não consegui abrir; formato e colunas não verificados). Corpo: as parcelas vencidas podem ser consultadas e reprogramadas no Espaço Corretor.
- Notificações de caso do sistema DSO (cobrança, reprogramação de parcela): resolução caso a caso.

### Alfa
- **"Parcelas Pendentes de Pagamento Há N Dia(s)"**: tabela no corpo (produto, apólice/endosso, parcela, vencimento, segurado, valor), "vencidas há 2 ou 4 dia(s)", duas vezes por semana. Remete ao relatório de inadimplência do portal. Uma vez (01/06) mandaram "URGENTE - inadimplência" por imobiliária com prazo de retorno e bloqueio de novas emissões; não é prazo de cancelamento.

### Allianz
- **"Inadimplência - Corretor" diário** (zip com .xls, já tratado). A coluna "Previsão Cancelamento" é quase sempre igual ao vencimento (às vezes anterior): não serve como prazo em dias.
- **"Ainda não identificamos o pagamento do seu seguro" (Allianz Brasil / Residência Digital)**: e-mail ao cliente com cópia a quem cobra. Frase: "É importante que o pagamento seja realizado até 20 dias após o vencimento. Caso contrário, a cobertura do seu seguro será suspensa a partir da data de vencimento original" e informa "sua apólice será cancelada em DD/MM". Vem com boleto, Pix e cartão. Há também "Pré-cancelamento" (última chance) e "Seu seguro foi cancelado por falta de pagamento". Datas lidas: 16/06, 12/08, 26/08, 17/09, 17/10. A Allianz também anunciou avisos de inadimplência pelo WhatsApp oficial.

### Pottencial
- **"URGENTE! Não deixe a apólice dos seus clientes cancelar!" e "[Prêmios Pendentes]"** (xlsx, já tratado). Frases: "produto que é cancelado por inadimplência"; "boleto original permanece válido para pagamento por 30 dias"; "para os produtos de Garantia, ... prêmios com atraso superior a 45 dias ... estão sujeitos à negativação junto ao Serasa". Sem data de cancelamento.

### Porto Seguro
- Não encontrei aviso de inadimplência com prazo de cancelamento. O que chega: "Porto Seguro - Boleto Bancário!" (fatura em PDF), "Segunda Via de Boleto", "Documento para pagamento", "Comunicado Financeiro" (cerca de mensal: PDF com parcela de débito em conta recusado e nova tentativa agendada, sem prazo de cancelamento), "Regularização / Débito em conta corrente não autorizado" (boleto anexo) e "Tudo certo com seu pagamento" (confirmação de pagamento). Dias até cancelar: não encontrado.

### Zurich
- "Seu seguro foi cancelado" (e-mail ao cliente): "cancelada por falta de pagamento dentro do prazo, mesmo após nossas tentativas de regularização". Sem número de dias. Só 2 mensagens.

### HDI, Mapfre, Liberty
- HDI: "Carta de Cobrança HDI" (6, junho; texto não legível no HTML lido), "Próxima parcela" e "Confirmação de pagamento" (lembretes). Prazo de cancelamento: não encontrado.
- Mapfre e Liberty: nenhum aviso de inadimplência de parcela encontrado (só resgate de capitalização e cancelamento a pedido).

### E-mails que citam PRAZO em dias até o cancelamento
| Seguradora | Prazo citado | Observação |
|---|---|---|
| Allianz (Residência Digital) | pagar até 20 dias após o vencimento | depois suspende a cobertura e informa a data do cancelamento |
| Too (Fiança) | mais de 30 dias de atraso = passível de cancelamento; data limite 7 dias após o aviso | prazo foi reaberto semanalmente |
| Yelum | data de cancelamento cerca de 14 dias após a carta | cartas lidas eram de 1ª parcela |
| Pottencial | 30 dias de validade do boleto; 45 dias para Serasa (Garantia) | não é prazo de cancelamento |
| Tokio, Suhai, Porto, Zurich, Alfa | nenhum | Alfa: "pendente há 2 ou 4 dias" é só idade da parcela |

---

## PARTE C: extratos de comissão

Lidos no ERP (`erp_extratos_seguradora` e `erp_extrato_linhas`), de agosto a outubro/2026 (corte `ERP_EXTRATOS_DESDE`).

| Seguradora | Fonte | Linhas | Ligadas a uma parcela | Comissão negativa (estorno) | Linhas zeradas | Serve para concluir inadimplência? |
|---|---|---|---|---|---|---|
| Tokio | portal (PDF "Extrato do Corretor"), pasta do Drive; resumo mensal por e-mail só traz o total | 7.018 | 97% | 306 | 0 | Sim, para parcela paga |
| Porto | portal e Drive (PDF "Analítico de Pagamentos de Comissões") | 3.652 | 98% | 24 | 0 | Sim, para parcela paga |
| Pottencial | e-mail mensal (xls "Dem Com") e Drive | 2.248 | 99,7% | 62 | 0 | Sim |
| Too | e-mail semanal (xls) e Drive | 590 | 99,8% | 11 | 0 | Sim |
| Yelum | Drive | 369 | 98% | 18 | 0 | Sim |
| Bradesco | Drive | 42 | 100% | 0 | 5 | Sim (único com parcela paga e comissão zero) |
| Brasilcap | Drive | 232 | 94% | 0 | 0 | Em parte (capitalização) |
| Suhai | Drive | 22 | 100% | 2 | 0 | Pouco volume |
| Allianz | Drive ("Comissões Pagas" diário por e-mail ainda não lido) | 177 | 46% | 3 | 0 | Parcial |
| Sulamérica | Drive | 78 | 24% | 0 | 0 | Não |
| Alfa | Drive | 315 | 0,6% (2 linhas) | 0 | 0 | Não |
| Icatu | Drive | 46 | 0% | 2 | 0 | Não |
| Mapfre | Drive | 9 | 0% | 1 | 0 | Não |
| HDI | Drive | 8 | 0% | 0 | 0 | Não |
| Azul | Drive | 3 | 0% | 0 | 0 | Não |
| Zurich | Drive | 3 | 0% (sem nº de parcela) | 0 | 0 | Não |

Conclusões:
- Extrato só mostra parcela PAGA. Parcela não paga nunca aparece. Faltar a linha numa competência não prova inadimplência: a comissão chega com atraso e pode haver esgotamento.
- Linhas de parcela paga com comissão zerada (esgotamento): no que já foi lido, só o Bradesco (5 linhas). Nas demais não há linha zerada; quem estiver em esgotamento simplesmente não aparece. Para essas, a prova de pagamento tem de vir de outra fonte (aviso, baixa assistida ou o relatório de inadimplência da seguradora).
- Alfa, Icatu, Mapfre, HDI, Azul, Zurich e Sulamérica: extrato pouco ligado às parcelas; não permite concluir inadimplência.
- A Allianz tem o relatório de inadimplência diário (Parte B), que é mais confiável que o extrato para saber quem está devendo.

---

## Regras com evidência (tabela final)

Ordem de confiança: alta (frase explícita nas Condições Gerais ou na apólice), média (só e-mails oficiais), baixa (inferido). "Dias" é o prazo do atraso até o cancelamento ou a suspensão, como a seguradora escreveu. Observação importante para o ERP: a regra da Tokio conta a partir da notificação, não do vencimento.

| Seguradora | Produto | Dias até cancelar | Aviso prévio? | Certeza | Fonte |
|---|---|---|---|---|---|
| Tokio | Incêndio / Empresarial | 1ª parcela: 0 (automático). Demais: 15 dias para pagar após a notificação + 30 dias após a suspensão (cerca de 45 dias da notificação) | Sim, notificação por escrito | Alta | Condições Gerais Tokio Marine Empresarial, itens 16.9 a 16.11 (PDF da apólice) |
| Bradesco | Incêndio residencial | 1ª parcela: 0. Demais: no mínimo 30 dias após a suspensão da garantia | Sim, notificação prévia | Alta | Condições Gerais Bradesco Residencial Sob Medida (PDF da apólice) |
| Alfa | Incêndio (Empresarial, Residencial, Imobiliárias) | 0 (cancelamento automático no vencimento; a seguradora pode propor nova data) | Não formal (manda aviso "há 2/4 dias") | Alta (texto), mas a prática é mais branda | Certificado de seguro Alfa |
| Yelum | Incêndio | 1ª parcela: 0 (cancela desde o início da vigência). Demais: não encontrado | Sim, "notificado para regularização" | Alta (1ª parcela); dias das demais não encontrado | Apólice Yelum, cláusulas I e II |
| Suhai | Automóvel | 1ª parcela: 0. Demais: não encontrado | Sim (aviso aos 3 e 20 dias, sem prazo) | Alta (1ª parcela); demais não encontrado | Apólice Suhai e e-mails |
| Tokio | Fiança | 1ª parcela: 0 (resolve de pleno direito). Demais: não encontrado | Sim (1º, 2º, 3º comunicado) | Alta (1ª parcela); demais não encontrado | Apólice Tokio Aluguel (rodapé do carnê) e e-mails |
| Too | Fiança | Mais de 30 dias de atraso = passível de cancelamento; aviso formal dá 7 dias | Sim (aviso com data limite) | Média | E-mails Too ("Comunicado de Parcelas em Atraso", "Aviso de cancelamento por inadimplência"); Condições Gerais não localizadas |
| Allianz | Residência Digital (incêndio) | Pagar até 20 dias após o vencimento; sem isso, suspensão desde o vencimento e cancelamento na data informada | Sim (inadimplência, pré-cancelamento, cancelamento) | Média | E-mails Allianz Brasil; Condições Gerais não localizadas |
| Yelum | Incêndio | Cerca de 14 dias entre a carta de cobrança e o cancelamento (13 a 15 nas cartas lidas, 1ª parcela) | Sim, carta | Média | E-mails "Carta de Cobrança - Yelum Seguros" |
| Pottencial | Fiança (Garantia) | Não encontrado para cancelamento. Boleto vale 30 dias; mais de 45 dias de atraso = Serasa | Sim (Prêmios Pendentes / URGENTE) | Média (só prazos de cobrança) | E-mails Pottencial |
| Tokio | Condomínio, RC, Automóvel, Residencial, Vida | Não encontrado (texto: poderá cancelar / suspensão automática) | Sim (1º, 2º, 3º comunicado) | Baixa (sem dias) | Apólices e e-mails Tokio |
| Porto | Fiança | Não encontrado (apólice: "poderá ser suspenso ou cancelado" se o boleto não for pago) | Não achei aviso de cancelamento | Baixa | Apólice Porto Fiança |
| Porto | Incêndio / Condomínio | Não encontrado (cláusula de fracionamento não veio nos PDFs). Boleto aceito até 55 dias após o vencimento | Não achei | Baixa | Apólice e boletos Porto |
| Porto | Portáteis | Não encontrado | Não achei | n/a | PDF da apólice sem cláusula |
| Allianz | Incêndio / Condomínio (demais ramos) | Não encontrado (o prazo de 20 dias vem de e-mail da Residência Digital) | Sim, no relatório diário | n/a | PDF sem cláusula |
| Zurich | Incêndio | Não encontrado ("cancelada por falta de pagamento dentro do prazo") | Não achei | n/a | E-mail Zurich |
| HDI, Mapfre, Liberty, Azul, Mitsui, Sulamérica | Diversos | Não encontrado | Não achei | n/a | PDFs sem cláusula e e-mails sem prazo |
| Capitalização (Brasilcap, Icatu, Mapfre Cap) | Capitalização | Não levantado | Não levantado | n/a | |

## O que ainda falta

1. Condições Gerais completas de Fiança (Porto, Pottencial, Too, Tokio), Porto Incêndio/Condomínio (cláusula de fracionamento), Allianz, Zurich, HDI e Mapfre. Os PDFs da apólice não trazem. Sugestão: pegar as Condições Gerais nos portais das seguradoras ou no site da SUSEP e arquivar como "condições gerais" no ERP.
2. Confirmar com cada seguradora (ou com o gerente de contas) o prazo real de cancelamento por parcela em aberto, principalmente Porto, Pottencial e Too (Fiança), que são o maior volume.
3. Abrir o PDF protegido do "Relatório Parcelas Vencidas" da Yelum (semanal) e ver as colunas; descobrir a senha.
4. Ler o conteúdo da "Carta de Cobrança HDI" (HTML que não consegui decodificar).
5. Capitalização: levantar se há regra de parcela em aberto.
6. A Lei 15.040/2024 é citada nos avisos da Suhai para parcelas seguintes à 1ª; vale uma conferência jurídica antes de fixar regra de dias para todas as seguradoras.
7. Sugestão para `erp_regras_cancelamento`: só cadastrar, com a fonte escrita, Tokio Incêndio/Empresarial (cuidado: conta da notificação), Bradesco Incêndio e, se o Matheus aprovar, Too Fiança (30 dias) e Allianz Residência (20 dias) como regras de certeza média. Nada foi gravado.

Arquivos de apoio: tabela em `erp-o2/LEVANTAMENTO-REGRAS-INADIMPLENCIA-SEGURADORAS.csv`. Scripts temporários foram apagados do repositório.
