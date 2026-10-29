# Levantamento: Condições Gerais no Google Drive e regras de inadimplência

Data: 29/10/2026. Somente leitura: nada foi gravado em banco, nada foi enviado, nada foi alterado no Drive, sem commit.
Complementa o arquivo `LEVANTAMENTO-REGRAS-INADIMPLENCIA-SEGURADORAS.md` (que olhou PDFs de apólices e e-mails). Aqui a fonte são as Condições Gerais (CG) e manuais guardados no Drive do Matheus.

## Resumo em linguagem simples

1. **A regra quase igual em todas as seguradoras:** parcela única ou 1ª parcela não paga = a apólice é cancelada automaticamente, valendo desde o início. Isso agora tem prova escrita em Porto, Tokio, Pottencial, Too, Allianz, Yelum, HDI e Azul.
2. **Para as demais parcelas, as CG quase nunca falam "X dias de atraso".** Elas usam a **Tabela de Prazo Curto**: a cobertura passa a durar só um número de dias, contado **desde o início da vigência**, que depende de quanto do prêmio já foi pago (exemplo: 13% pago = 15 dias de cobertura; 50% pago = 120 dias; 100% = 365). Passado esse prazo sem pagar, a apólice é cancelada. Ou seja, a data do cancelamento sai de "início de vigência + dias da tabela", e **não** de "vencimento da parcela + N dias". Isso resolve a dúvida da "cláusula de fracionamento" da Porto: é a Tabela de Prazo Curto.
3. **Únicas exceções com prazo em dias escrito:** Porto Fiança (aviso com no mínimo 15 dias para pagar, e cancelamento só depois de no mínimo 30 dias da suspensão), Tokio Vida Individual (45 dias úteis), Porto Vida Individual (90 dias de tolerância) e o aviso da Porto Bank de 10 dias corridos (manual do corretor).
4. **Os "20 dias" da Allianz e os "30 dias" da Too que apareceram em e-mails NÃO estão nas Condições Gerais.** São prática comercial da seguradora (a Allianz pode conceder "nova data limite"; a Too repete o aviso toda semana). Não devem virar regra fixa no ERP sem confirmar com a seguradora.
5. **Capitalização (Brasilcap e Icatu, "Instrumento de Garantia"):** contribuição única, então não existe parcela em atraso. Só há regra de resgate.
6. **Duas versões diferentes da mesma seguradora existem no Drive** (Tokio Empresarial e Pottencial Fiança). Ver a seção "Atenção: versões diferentes".

---

## 1. Documentos encontrados

Links: `https://drive.google.com/file/d/<ID>/view`. A coluna "Data" é a data de modificação do arquivo no Drive (a data da versão da seguradora vem na coluna seguinte quando o documento informa).

| Seguradora | Produto | Arquivo | Data no Drive | Versão / Processo SUSEP | ID do Drive (para o link) |
|---|---|---|---|---|---|
| Porto Seguro | Fiança Locatícia e Essencial | CONDIÇÕES GERAIS PORTO ATUALIZADA.pdf | 10/04/2026 (cópia de 08/05/2026 na pasta MATERIAL DE SEGURO FIANÇA) | Código 010068071, DEZ/25; Proc. 15414.602624/2020-23 | 1iTtvjWusAg5hrY9PjdP8PAB_DdY31xmJ (cópia: 1MaZnO0ro783T9cOAr9dtv8ynSNmwhalP) |
| Porto Seguro | Fiança (manual do corretor) | MANUAL DO CORRETOR ATUALIZADO.pdf | 10/09/2024 | Agosto/2024; Fiança 15414.602624/2020-23, Essencial 15414.611834/2020-11 | 1MDsOBZo9VUfKarbIroMDQ8sFgoWJWo3k |
| Porto Seguro | Fiança (cláusula do contrato de locação) | CLAUSULA ATUALIZADA PORTO SEGUROS 2026 (2).pdf | 08/05/2026 | Anexo I do manual (não traz regra de dias) | 1rdlNU9Ula_0CH3wEraM8_ybgMv5FCmFD |
| Porto Seguro | Residência Fácil e Essencial | PORTO - RESIDENCIA FÁCIL E ESSENCIAL - CONDIÇÕES GERAIS.pdf | 08/05/2026 | CGRES 20/09/2024 | 1__p-yPvz6OuTsY81k2JkJwvtKH8Eyrk0 |
| Porto Seguro | Imobiliária (imóveis residenciais) | PORTO - IMOBILIÁRIA IMÓVEIS RESIDENCIAIS - GUIA PRÁTICO DO SEGURADO.pdf | 08/05/2026 | Versão set/2024; Proc. 15414.000573/2006-42 | 1eMdKoB66dj3IjmwGuz5SjiijPM1gjxJw |
| Porto Seguro | Condomínio | PORTO - CONDOMÍNIO - MANUAL DO SEGURADO.pdf | 08/05/2026 | CGRE36COND 18/12/2024 | 1gmcxA2ynRehXr-s-R40-1J_TU7SK_I_y |
| Porto Seguro | Empresa | PORTO - EMPRESA - MANUAL DO SEGURADO.pdf | 08/05/2026 | CGRE39EMP 18/12/2024 | 1p7qMa419fFCRYwlAnzAkI-YjGbD5w_DV |
| Porto Seguro | Equipamentos Portáteis | PORTO - EQUIPAMENTOS PORTÁTEIS - CONDIÇÕES GERAIS.pdf | 08/05/2026 | Proc. 15414.002547/2012-05 | 1cWP9XGahiGlNxS1KYp8Od9xatI12Mjh8 |
| Porto Seguro | Vida Individual | PORTO - VIDA INDIVIDUAL - CONDIÇÕES GERAIS.pdf | 08/05/2026 | "3383 CG Porto Vida Individual" (sem processo legível) | 1u9SmudtApU_Nxo6Gm0ur-SJe4p2B-v40 |
| Pottencial | Fiança (Aluguel) — mais recente | CONDIÇÕES GERAIS POTTENCIAL ATUALIZADA.pdf (cópia da pasta POTTENCIAL) | 08/05/2026 | **Versão 12/2025**; Proc. 15414.635415/2022-28 | 1TPK4t7IqF32nUJ6VbL1Nv3aaX4i8t2OP |
| Pottencial | Fiança (Aluguel) — versão anterior | CONDIÇÕES GERAIS POTTENCIAL ATUALIZADA.pdf | 26/11/2024 | Versão anterior, com Tabela de Prazo Curto | 1XUZmahhcs7isbo0O0x8qgVvJrfkV6lMs |
| Pottencial | Fiança (cláusula do contrato de locação) | CLAUSULA POTTENCIAL ATUALIZADA 2026.pdf | 08/05/2026 | Versão 12/2025 (sem número de dias) | 1u4MviEeCMnMq_iz_adwUQ53sUk9iSr-8 |
| Tokio Marine | Fiança (Aluguel) | CONDIÇÕES GERAIS TOKIO.pdf / CONDIÇÕES GERAIS TOKIO ATUALIZADA 2024- novembro.pdf | 11/06/2025 e 08/05/2026 (mesmo arquivo) | Versão 02 de Nov/2024; Proc. 15414.626840/2019-21 | 1IdbIrAGjotHD_YAGQo1IXynZzgh5bibJ (cópia: 1Q8NtMLpVToRETlpyuDa-BMxtxGExqFH2) |
| Tokio Marine | Fiança (manual do corretor) | Manual do Corretor_Aluguel- v16 112024 - versão final.pdf | 10/12/2024 | v16, Nov/2024 (não traz regra de dias) | 18y8bsM9fGjsk7atWVSjXLGSmc295LwWJ |
| Tokio Marine | Condomínio | TOKIO - CONDOMÍNIO - CONDIÇÕES GERAIS e GUIA DE SERVIÇOS.pdf | 08/05/2026 | Versão 08/02/2025; Proc. 15414.004366/2006-67 | 1VI0oRmXuH6cv-xF3GsbFZh3r0xKGa8mX |
| Tokio Marine | Empresarial (e Vida em Grupo) | TOKIO - EMPRESARIAL - CONDIÇÕES GERAIS e GUIA DE SERVIÇOS.pdf | 08/05/2026 | Versão 04/2025; Proc. 15414.900584/2018-68 | 1KZTauZrr6HiZRm55O8OuBDy4InikQoB9 |
| Tokio Marine | Imobiliário (incêndio de imobiliária) | TOKIO - CONDIÇÕES GERAIS - IMOBILIÁRIO.pdf | 08/05/2026 | Proc. 15414.900298/2015-50 | 1CXhBcfbE1_lQsHfr2X3sF3VCbsVSTXTX |
| Tokio Marine | Residencial (Premiado) | CONDIÇÕES GERAIS - RESIDENCIAL TOKIO - 202502-CG-Residencial-Premiado.pdf | 08/05/2026 | fev/2025; Proc. 15414.100910/2004-39 | 1z_pW_0kN3Idsneag3YhzxI8X7cUOTyrj |
| Tokio Marine | Vida Individual | TOKIO - VIDA INDIVIDUAL - CONDIÇÕES GERAIS.pdf | 08/05/2026 | Proc. 15414.900142/2017-31 | 1Tn_HAigDoY8WdzEEy9Hp4K4NrUxHNlG5 |
| Too Seguros | Fiança Locatícia | CONDIÇÃO GERAL ATUALIZADA TOO Seguro-Fianca-Too-032023-Susep.pdf | 16/10/2024 (cópia 08/05/2026) | Versão março/2023; Proc. 15414.601304/2020-56 | 1By480N1ZWFJ4GYYfMUrul3xdNrz0jfBF (cópia: 1dZ574idf6f6wUwjeb4nuprjxnCiwaxjS) |
| Allianz | Residência | ALLIANZ - RESIDÊNCIA - MANUAL DO SEGURADO.pdf | 08/05/2026 | Condições Gerais 02/2025; Proc. 15414.100898/2004-62 | 1uESvtBJ-D4wc1ApdmTy2L5FT4_x67Rlb |
| Allianz | Condomínio | ALLIANZ - CONDOMÍNIO - MANUAL DO SEGURADO.pdf | 08/05/2026 | Versão 04/2025; Proc. 15414.000310/2005-52 | 1a04zfFm86UgBCggZ_9rB31EOo7U6Hkhz |
| Allianz | Empresarial (Empresa PME) | ALLIANZ - EMPRESARIAL - MANUAL DO SEGURADO.pdf | 08/05/2026 | 10/2024; Proc. 15414.641843/2024-51 | 1-y__2CtxCDe4JD_n9rvHjbs3Ul7SdU10 |
| Yelum | Residência | YELUM - RESIDÊNCIA - CONDIÇÕES GERAIS.pdf | 08/05/2026 | Seguros com início de vigência a partir de 05/10/2024; Proc. 15414.004633/2004-34 | 1jUqUuec2dx7odlfM4eeTnu5fz8qPEide |
| Yelum | RC Geral | YELUM - RC GERAL - CONDIÇÕES GERAIS.pdf | 08/05/2026 | A partir de 05/10/2024; Proc. 15414.900721/2013-50 | 18Qk8Ts4D2TznK5H8XKGJqGDb58xWV_vN |
| HDI | Residência Fácil | HDI - RESIDÊNCIA FÁCIL - CONDIÇÕES GERAIS.pdf | 08/05/2026 | Proc. 15414.002160/2005-11 | 1uZb0ZHubGSxpI2giFdgEWph_eg7a1Nkv |
| HDI | Condomínio | HDI - CONDOMÍNIO - CONDIÇÕES GERAIS.pdf | 08/05/2026 | Versão 1.2 – 12/24; Proc. 15414.652484/2023-87 | 1l7pNZ9WpnC4ch51SjtV975XW8VCHEM2f |
| HDI | Empresa | HDI - EMPRESA - CONDIÇÕES GERAIS.pdf | 08/05/2026 | Proc. 15414.652173/2023-18 | 1LRNMP-DkaxayWFi8bnSk_AspXRFD7maJ |
| Azul | Auto | AZUL - AUTO - MANUAL DO SEGURADO.pdf | 16/04/2025 | Versão 03/2025 | 1dKMUXB0TbG5jJfG-c9r1SpPGcNC9NeXW |
| Brasilcap | Capitalização, Instrumento de Garantia (12 meses) | CONDIÇÕES GERAIS 12 MESES (1).pdf (pasta BRASILCAP) | 08/05/2026 | PU12GAR_22; Proc. 15414.606509/2022-90 | 14jQAYrvPNts83Epnavd0Xq-t1BfTzTdr |
| Icatu | Capitalização, Instrumento de Garantia (12 meses) | CONDIÇÕES GERAIS 12 MESES - ICATU.pdf | 08/05/2026 | Versão 004/2018; Proc. 15414.901276/2018-50 | 1ii6j8hX12AM9u2QU3_2P3d_2JmhFlmU3 |

Existem também, **não lidos** (não são mais recentes que os acima): CGs de 15/18/24/30 meses da Brasilcap, Porto e Icatu (capitalização), CG Pottencial Aluguel 2020, CG Liberty (2017 a 2023) e "CG Susep Fiança Out19" (Liberty Fiança, anterior à Yelum), Manual Fiança Bradesco (2015/2021), CGs Tokio 2017/2023, Porto 2022, Sul América 2019, e as CGs de HDI Em Casa, HDI Riscos Diversos, Yelum Máquinas, Tokio RC Obras, Tokio Riscos de Engenharia, Porto RC, Porto Eventos.

### O que NÃO foi encontrado no Drive

| Seguradora / produto | Situação |
|---|---|
| Alfa (Incêndio, Residencial Mensal) | Só existe "CG Assistência 24 horas" (sem regra de pagamento). CG do seguro: **não encontrado**. |
| Suhai (Auto) | Só extratos e planilhas. CG: **não encontrado**. |
| Zurich | Só pastas de operação. CG: **não encontrado**. |
| Mapfre | Só propostas e capitalização. CG de seguro: **não encontrado**. |
| Bradesco Seguros (Incêndio/Residencial) | Só manuais antigos (2015 a 2021). CG de incêndio: **não encontrado** (o texto que o levantamento anterior citou veio do PDF da apólice). |
| Sulamérica | Só manual e CG de capitalização de 2019. Seguro: **não encontrado**. |
| Allianz Auto; Tokio Auto; Tokio RC Geral; Porto Auto; Yelum Auto; Liberty/Yelum Fiança | **não encontrado** como CG. Há apenas o "MANUAL SEGURO AUTO.docx" (material operacional) e manuais do corretor de Auto (Azul, HDI), não lidos. |
| Mitsui | **não encontrado**. |

---

## 2. Cláusulas por seguradora e produto

Notação: "prazo curto" = Tabela de Prazo Curto (explicada abaixo). Citações com até 25 palavras, literais.

### Porto Seguro: Fiança Locatícia (e Essencial) — a mais completa

Arquivo: CG Porto Fiança DEZ/25 (código 010068071), cláusulas 10.7, 17.5 e 19. Manual do Corretor ago/2024, itens 8.5 e 9.5.
- **1ª parcela ou à vista:** cancelamento imediato. "A falta de pagamento do prêmio à vista ou da primeira parcela no prazo concedido acarretará no cancelamento integral e automático do seguro." (10.7.4)
- **Demais parcelas:** a vigência é reduzida pela tabela de prazo curto (10.7.5).
- **Aviso e prazo para pagar:** "concedendo-lhe prazo não inferior a 15 (quinze) dias, contados do recebimento, para a purgação da mora" (10.7.6). Conta da data em que o segurado **recebe** a notificação, não do vencimento.
- **Quando cancela:** "cancelará o contrato em prazo não inferior a 30 (trinta) dias após a suspensão da garantia ou no fim da vigência definida pela tabela, o que for mais benéfico ao segurado" (10.7.6). Ou seja, vale o que for mais longo para o segurado.
- **Comunicação prévia do cancelamento:** obrigatória (10.7.2).
- **Reativação:** pagar dentro da vigência ajustada, com juros de 2% ao mês, restabelece o prazo original (10.7.9). Depois disso a seguradora "poderá autorizar a reativação" com nova análise de risco (10.7.10).
- **Fatura mensal da imobiliária (estipulante):** a imobiliária paga a fatura nos vencimentos (10.7.3.1). O manual diz que o aviso de 10 dias corridos da Porto Bank "não é aplicado" quando a forma de pagamento é fatura mensal.
- **Manual do corretor (prática):** "a Porto Bank enviará um comunicado por e-mail ao segurado ... com o aviso de inadimplência e pedido de regularização em até 10 dias corridos".
- **Sinistro durante a mora:** a indenização é paga e o prêmio devido é deduzido (10.7.3, 10.7.12).

### Porto Seguro: Residência, Imobiliária, Condomínio, Empresa e Portáteis (incêndio)

Arquivos: Residência Fácil/Essencial (CGRES 20/09/2024, cl. 14.2), Imobiliária (set/2024, cl. 16.2), Condomínio (CGRE36COND 18/12/2024, cl. 16.2), Empresa (CGRE39EMP 18/12/2024, cl. 17.2), Portáteis (cl. 14.2).
- 1ª parcela: "cancelamento integral e automático do seguro". Condomínio e Empresa: "o segurado não terá direito a qualquer tipo de cobertura".
- Demais parcelas: "o seguro terá sua vigência ajustada/reduzida, considerando prêmio já pago aplicado na Tabela de Prazo Curto".
- **Não há prazo em dias de atraso, nem notificação com prazo.** A "cláusula de fracionamento" que o levantamento anterior procurava é a Tabela de Prazo Curto.
- Reativação: não descrita nesses produtos. O boleto aceito "até 55 dias após o vencimento" é regra do banco, não da CG.

### Porto Seguro: Vida Individual

Cláusula 10: "permanecerão cobertas pelo período de tolerância de 90 (noventa) dias". Conta "a partir do dia imediatamente posterior à data de vencimento do primeiro Prêmio vencido e não pago". Depois cancela. Pode reabilitar antes do fim, pagando com juros (10.4). Certeza alta.

### Pottencial: Fiança (Aluguel)

- **1ª parcela:** "A falta de pagamento da primeira parcela ou do Prêmio à vista implicará no Cancelamento da Apólice, desde o início da vigência." (8.3)
- **Aviso:** a seguradora "fará a comunicação da falta de pagamento de qualquer parcela" e avisa sobre possível cancelamento por "comunicação prévia" (8.4, versão 12/2025).
- **Demais parcelas (versão 12/2025, mais nova):** "o prazo de vigência da Cobertura será ajustado Pro Rata Temporis, ou seja, de forma proporcional ao prêmio efetivamente pago" (8.8). **Sem tabela e sem número de dias.** Pagando o prêmio em aberto com juros de 1% ao mês, a vigência original volta (8.9). Depois do novo prazo, só com "nova análise do Risco" (8.10). Sem reativação, a apólice é extinta (8.10.1).
- **Versão anterior (nov/2024):** igual, mas com Tabela de Prazo Curto no item 8.8 e "mais de 15 dias de utilização" cobrado integralmente na fatura (8.9, só cobertura de inadimplência de aluguéis e encargos).
- A cláusula padrão do contrato de locação (12/2025) só diz que a seguradora "concederá prazo ... nos termos previstos nas Condições Gerais".

### Too Seguros: Fiança Locatícia (versão mar/2023)

- 1ª parcela: "implicará o cancelamento da apólice" (12.14).
- Demais: "o prazo de vigência da cobertura será ajustado em função do prêmio efetivamente pago, tomando-se por base, no mínimo, a tabela de prazo curto" (12.15). **Não se aplica a prêmio mensal** (12.15.1).
- Aviso: "informar ao Segurado ... por meio de comunicação prévia sobre o eventual cancelamento" (12.13), mas sem prazo em dias.
- Pagando dentro da vigência ajustada, com juros de mora, o prazo original volta (12.17). Depois, nova análise para reativar (12.18).
- **Os "30 dias de atraso" dos e-mails da Too não aparecem nas CG.** Continua prática comercial (certeza média).

### Tokio Marine: Fiança (Aluguel, versão 02 Nov/2024)

- Cláusula 14: "Na ausência do pagamento da primeira parcela ou do prêmio à vista, após o segurado ser comunicado previamente ficará de pleno direito cancelado desde o início da vigência."
- Demais parcelas: "o contrato de seguro será cancelado, após o segurado ser comunicado previamente". **Sem dias e sem tabela de prazo curto.**
- Pagando depois: restabelece com "multa de 2% ... juros simples de mora de 0,116667% ao dia" e atualização pelo IPCA.
- O manual do corretor (v16) não traz regra de dias. Os comunicados de 1º/2º/3º (levantamento anterior) são a única referência prática.

### Tokio Marine: Condomínio (08/02/2025), Imobiliário e Residencial Premiado (02/2025)

- 1ª parcela: "O não pagamento da primeira parcela implicará no cancelamento da apólice de pleno direito desde o início de vigência."
- Demais parcelas: vigência ajustada pela tabela de prazo curto, com "comunicação escrita" do novo prazo; se a tabela não mudar nada, cancela de pleno direito.
- Restabelecer: multa de 2% e juros de 0,116667% ao dia, dentro do prazo estabelecido.
- Prêmio único: a seguradora manda comunicação "e decurso de novo prazo para quitação" antes de cancelar (sem número de dias).

### Tokio Marine: Empresarial (versão 04/2025)

- 1ª parcela: "implicará no cancelamento da apólice ... independentemente de qualquer interpelação" (16.9).
- Demais parcelas: tabela de prazo curto (16.11), comunicação escrita da nova vigência (16.12), restabelece pagando as parcelas vencidas corrigidas dentro da vigência ajustada (16.13).
- **Esta versão não traz a regra de "15 dias de purgação + 30 dias" que o levantamento anterior viu no PDF de uma apólice.** Ver "Atenção: versões diferentes".

### Tokio Marine: Vida Individual

"o não pagamento da parcela em até 45 (quarenta e cinco) dias acarretará o cancelamento automático da apólice" (12.1). O prazo é de "até 45 dias úteis" (11.1.2.1), sem suspender a cobertura; multa de 2% e juros de 0,116667% ao dia. 1ª parcela: cancela desde o início. Certeza alta.

### Allianz: Residência (02/2025), Condomínio (04/2025) e Empresarial (10/2024)

- 1ª parcela: "o não pagamento do prêmio ou da primeira parcela ... acarretará a extinção automática do contrato desde seu início de vigência."
- Demais: "o prazo de vigência da cobertura será ajustado em função do prêmio efetivamente pago, tomando-se por base, no mínimo, a tabela de prazo curto".
- Nova data: "fica facultado à seguradora conceder ou não uma nova data limite para regularização". A carta de cobrança indica "o prazo máximo para pagamento"; sem pagar nesse prazo, cancela com aplicação da tabela.
- Depois do prazo da tabela: "a apólice será cancelada de pleno direito, independentemente de qualquer interpelação".
- Restabelecer: pagar a parcela vencida dentro do prazo da tabela, com juros de mercado (Residência 15.3.1).
- **Os "20 dias após o vencimento" do e-mail da Residência Digital não estão nas CG.** São a "nova data limite" que a Allianz escolhe conceder (certeza média).

### Yelum: Residência e RC Geral (início de vigência a partir de 05/10/2024)

- 1ª parcela: "o cancelamento do seguro desde o início de vigência".
- Demais: tabela de prazo curto. A seguradora informa "a nova data de vencimento para parcela em mora" para regularizar sem cancelar.
- **Prêmio mensal (Residência):** "a Seguradora irá suspender a cobertura durante o período de inadimplência, conforme critérios definidos pela Seguradora especificado na apólice. Após o prazo de suspensão ... a apólice será cancelada automaticamente." O número de dias fica na apólice, não na CG.

### HDI: Residência Fácil, Condomínio e Empresa

- 1ª parcela: Residência Fácil: "configurará, com comunicação prévia ao segurado ... a não formalização do presente contrato"; Condomínio e Empresa: cancelamento da apólice (desde o início, na Empresa).
- Demais: tabela de prazo curto. Residência Fácil: pode retomar pagando com encargos, "condicionado ou não ... na realização de nova inspeção de risco".
- Data limite da 1ª parcela: no máximo 30 dias da emissão (Condomínio e Empresa).

### Azul: Auto (versão 03/2025)

- 1ª parcela: "a apólice ou o endosso ficará automaticamente cancelado e sem efeito".
- Demais: redução de vigência pela tabela de prazo curto, com comunicação escrita do novo prazo.
- Reativação: a seguradora decide; se aceita, paga o prêmio em aberto com correção IPCA e juros de 2% a.m. "dentro do prazo e das condições negociadas". Menciona um "prazo de tolerância concedido" sem número.

### Brasilcap e Icatu: Capitalização (Instrumento de Garantia)

- Contribuição única; não há parcelas, então não há inadimplência de parcela.
- Brasilcap (PU12GAR_22): carência de resgate 0 meses; pagamento do resgate em até 15 dias corridos após os documentos (9.4). Icatu (v004/2018): carência de resgate antecipado de 1 mês (8.1); também até 15 dias corridos (10.3).
- Resgate depende da extinção do contrato de locação ou de anuência do terceiro garantido (Brasilcap 9.2; Icatu 10.1.1).

### Tabela de Prazo Curto (igual em todas, salvo pequenas diferenças)

| % do prêmio pago | Dias de cobertura | % do prêmio pago | Dias de cobertura |
|---|---|---|---|
| 13% | 15 | 73% | 195 |
| 20% | 30 | 75% | 210 |
| 27% | 45 | 78% | 225 |
| 30% | 60 | 80% | 240 |
| 37% | 75 | 83% | 255 |
| 40% | 90 | 85% | 270 |
| 46% | 105 | 88% | 285 |
| 50% | 120 | 90% | 300 |
| 56% | 135 | 93% | 315 |
| 60% | 150 | 95% | 330 |
| 66% | 165 | 98% | 345 |
| 70% | 180 | 100% | 365 |

Percentual que não está na tabela usa a faixa de cima. A Porto Fiança estende a tabela para vigências acima de 1 ano (até 500% e 1.825 dias). Na Yelum o percentual é sobre o prêmio **líquido**. Os dias contam do **início da vigência**.

Exemplo de leitura (para conferir antes de programar): apólice de 12 parcelas, só a 1ª paga (8,3%) cai na faixa de 13%, ou seja, 15 dias de cobertura a partir do início da vigência. Se esse prazo já passou quando a 2ª parcela vence sem pagamento, a apólice já está no fim da vigência ajustada, e a Porto ainda exige aviso de no mínimo 15 dias e cancelamento só 30 dias após a suspensão.

---

## Atenção: versões diferentes no Drive

1. **Pottencial Fiança:** a cópia mais nova (versão 12/2025) trocou a tabela por "Pro Rata Temporis" e baixou os juros de mora para 1% ao mês. A cópia de nov/2024 tem a tabela. Apólices antigas seguem a versão da data da contratação.
2. **Tokio Empresarial:** a CG de 04/2025 usa tabela de prazo curto. O texto "15 dias de purgação da mora + 30 dias após a suspensão", visto antes no PDF de uma apólice, é de uma versão de CG anterior. O ERP deve registrar a versão da CG por apólice e não aplicar um único valor por seguradora.
3. **Porto Fiança:** o mesmo código "010068071 DEZ/25" vale para Tradicional e Essencial; o manual de ago/2024 ainda fala em "Porto Bank".

---

## 3. Regras com evidência (tabela final)

Certeza alta = frase explícita na Condição Geral vigente. Média = vem só de e-mail ou manual. Baixa = inferido. O CSV ao lado tem a mesma tabela.

| Seguradora | Produto | Dias | Conta de quando | Aviso prévio? | Certeza | Arquivo e cláusula |
|---|---|---|---|---|---|---|
| Porto | Fiança (Tradicional e Essencial) | 1ª parcela: 0 (cancela). Demais: prazo da tabela de prazo curto; aviso de no mínimo 15 dias para pagar; cancelamento no mínimo 30 dias após a suspensão ou fim da vigência da tabela (vale o mais favorável ao segurado) | Aviso: do recebimento da notificação. Cancelamento: da suspensão da garantia. Tabela: do início da vigência | Sim, obrigatório (10.7.2 e 10.7.6) | Alta | CG Porto Fiança DEZ/25, cl. 10.7.4 a 10.7.11, 17.5 e 19; Manual do Corretor ago/2024, 8.5 e 9.5 |
| Porto | Fiança, fatura mensal da imobiliária | Imobiliária paga a fatura no vencimento; sem aviso de 10 dias | Do vencimento da fatura | Não (manual) | Média | Manual do Corretor ago/2024, 8.5 e 9.5; CG 10.7.3.1 |
| Porto | Residência Fácil/Essencial, Imobiliária residencial, Condomínio, Empresa, Portáteis | 1ª parcela: 0 (cancela). Demais: tabela de prazo curto (sem dias de atraso) | Início da vigência | Não descrito | Alta | CGRES 20/09/2024 cl. 14.2; Imobiliária set/2024 cl. 16.2; CGRE36COND cl. 16.2; CGRE39EMP cl. 17.2; Portáteis cl. 14.2 |
| Porto | Vida Individual | 90 dias de tolerância, depois cancela | Dia seguinte ao vencimento da 1ª parcela vencida | Não descrito | Alta | CG Porto Vida Individual, cl. 10.1 a 10.4 |
| Pottencial | Fiança (CG 12/2025) | 1ª parcela: 0. Demais: vigência ajustada pro rata temporis, sem número de dias | Início da vigência | Sim, comunicação prévia (8.4) | Alta (regra) / sem dias | CG Pottencial versão 12/2025, cl. 8.3 a 8.10 |
| Pottencial | Fiança (CG nov/2024) | 1ª parcela: 0. Demais: tabela de prazo curto | Início da vigência | Não descrito | Alta | CG Pottencial (cópia 26/11/2024), cl. 8.3 a 8.11 |
| Too | Fiança (mar/2023) | 1ª parcela: 0. Demais: tabela de prazo curto (não vale para prêmio mensal) | Início da vigência | Sim, comunicação prévia (12.13), sem prazo | Alta (CG). "30 dias" do e-mail: Média | CG Too Fiança mar/2023, cl. 12.12 a 12.19 |
| Tokio | Fiança (nov/2024) | 1ª parcela: 0. Demais: cancelamento após comunicação prévia, sem dias | Da comunicação (sem número) | Sim, comunicação prévia | Alta (1ª) / Baixa (demais) | CG Tokio Aluguel v02 nov/2024, cl. 14 |
| Tokio | Condomínio, Imobiliário, Residencial Premiado | 1ª parcela: 0. Demais: tabela de prazo curto, restabelece com multa 2% e juros 0,116667%/dia | Início da vigência | Sim, comunicação escrita do novo prazo | Alta | Condomínio 08/02/2025 cl. 21.6; Imobiliário cl. 20.2; Residencial 02/2025 cl. 21.5 |
| Tokio | Empresarial (CG 04/2025) | 1ª parcela: 0. Demais: tabela de prazo curto | Início da vigência | Sim, comunicação escrita (16.12) | Alta | CG Tokio Empresarial 04/2025, cl. 16.9 a 16.14 |
| Tokio | Empresarial (CG anterior, vista na apólice) | 15 dias de purgação após a notificação + 30 dias após a suspensão | Da notificação / da suspensão | Sim | Alta (levantamento anterior) | Levantamento anterior, cl. 16.9 a 16.11 do PDF da apólice |
| Tokio | Vida Individual | Até 45 dias úteis; depois cancela, sem suspender cobertura antes | Do vencimento | Sim, notificação | Alta | CG Tokio Vida Individual, cl. 11.1.2 e 12.1 |
| Allianz | Residência, Condomínio, Empresarial | 1ª parcela: 0. Demais: tabela de prazo curto; seguradora pode dar nova data limite (carta com prazo máximo) | Início da vigência; nova data: da carta | Sim, carta de cobrança (15.6 a 15.7) | Alta (CG). "20 dias" do e-mail: Média | CG Allianz Residência 02/2025 cl. 15.2 a 15.9; Condomínio 04/2025 cl. 15.x; Empresarial 10/2024 cl. 15.x |
| Yelum | Residência, RC Geral | 1ª parcela: 0. Demais: tabela de prazo curto com nova data para a parcela em mora. Mensal: suspensão por prazo definido na apólice, depois cancela | Início da vigência / da suspensão | Sim, comunicação escrita | Alta (regra) / dias da apólice: não encontrado | CG Yelum Residência (a partir de 05/10/2024) cl. 12.8 a 12.13; RC cl. 17.5 |
| HDI | Residência Fácil, Condomínio, Empresa | 1ª parcela: 0 (Residência Fácil: com comunicação prévia). Demais: tabela de prazo curto | Início da vigência | Residência Fácil: sim (1ª parcela) | Alta | HDI Residência Fácil cl. 18.5 a 18.10; Condomínio 12/24 cl. 13.4 e 13.5; Empresa cl. 12.3 e 12.4 |
| Azul | Auto (03/2025) | 1ª parcela: 0. Demais: tabela de prazo curto; "prazo de tolerância" a critério, sem número | Início da vigência | Sim, comunicação escrita | Alta (regra) / tolerância sem dias | Manual do Segurado Azul Auto 03/2025, cl. 14.3 |
| Brasilcap / Icatu | Capitalização (Instrumento de Garantia) | Não se aplica (contribuição única). Resgate em até 15 dias corridos após os documentos | Da entrega dos documentos | Não se aplica | Alta | Brasilcap PU12GAR_22 cl. 6.1 e 9.4; Icatu v004/2018 cl. 7.1 e 10.3 |
| Alfa, Suhai, Zurich, Mapfre, Bradesco (incêndio), Sulamérica, Mitsui, Tokio Auto/RC, Allianz Auto, Yelum Auto, Porto Auto | Diversos | Não encontrado | n/a | n/a | n/a | Sem CG no Drive |

## 4. O que pedir às seguradoras e próximos passos

1. **Alfa, Suhai, Zurich, Mapfre, Bradesco, Sulamérica:** pedir as Condições Gerais vigentes do Incêndio/Residencial (e Auto no caso de Suhai, Allianz, Tokio, Yelum, Porto) e arquivar na pasta de CGs com data e processo SUSEP.
2. **Yelum Residência mensal:** perguntar quantos dias dura a "suspensão" antes do cancelamento (está só na apólice).
3. **Too e Pottencial:** perguntar o prazo real que praticam hoje (a CG usa tabela/pro rata, não número de dias).
4. **Tokio Fiança:** perguntar quanto tempo após o 3º comunicado a apólice é cancelada (a CG só diz "após comunicação prévia").
5. **Tokio Empresarial e Pottencial:** confirmar qual versão da CG vale para cada apólice (data de emissão).
6. **Para o ERP (`erp_regras_cancelamento`):** guardar, por seguradora e produto, o tipo de regra (1ª parcela cancela / tabela de prazo curto / tolerância em dias) e a **versão da CG**, em vez de um único "N dias". Regras com número de dias escrito: Porto Fiança (15 + 30), Tokio Vida (45 dias úteis), Porto Vida (90 dias). Não cadastrar Allianz 20 dias nem Too 30 dias como regra de CG.
