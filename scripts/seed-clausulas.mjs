import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(import.meta.dirname, "..", ".env.local");
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=").map((s) => s.trim()))
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Remove test data from Fase 1 (cascade deletes its produto/cobertura)
await supabase.from("seguradoras").delete().eq("nome", "Porto Seguro");

const { data: tiposGarantia } = await supabase.from("tipos_garantia").select("id, nome");
const fiancaId = tiposGarantia.find((t) => t.nome === "Seguro Fiança Locatícia").id;

const JUNTO_BASE = `1. O presente contrato de locação será garantido por meio de Seguro Fiança Locatícia, emitido pela Junto Seguros S.A., inscrita no CNPJ sob n° 84.948.157/0001-33, com sede na Rua Visconde de Nácar, n° 1440, 15° andar, Centro, Curitiba/PR, CEP 80410-201 ("Seguradora"), nos termos do inciso III do Art. 37 da Lei n° 8.245/91 (Lei do Inquilinato), mediante pagamento de prêmio pelo Locatário que aqui ratifica a escolha pela modalidade de garantia em comento, sendo que a apólice terá a vigência determinada em seu frontispício, observado o teor do art. 13 da Circular SUSEP nº 671/2022.

2. São de conhecimento e plenamente aceitas pelo Locador e Locatário as Condições Contratuais do Seguro Fiança Locatícia emitido pela Seguradora, nos termos do Art. 41 da Lei n° 8.245/91 (Lei do Inquilinato), sendo que para a contratação da apólice, Locador e Locatário definiram previamente, mediante acordo, a Seguradora e o corretor de seguros, conforme descrito na apólice.

3. As partes declaram expressamente que estão de acordo com as condições contratuais do Seguro Fiança Locatícia, inclusive para os fins do art. 4º, §2º da Resolução CNSP 407/2021, caso aplicável.

4. O prêmio do seguro, calculado conforme condições contratuais e legislação aplicável, deverá ser pago pelo Locatário, de acordo com o inciso XI do Art. 23 da Lei n° 8.245/91 (Lei do Inquilinato), sob pena de rescisão da locação, por infração contratual, com o consequente despejo e cancelamento da apólice.

5. Eventuais débitos decorrentes do presente contrato, não pagos pelo Locatário após regularmente instado a tanto serão comunicados às entidades mantenedoras de bancos de dados de proteção ao crédito (Serasa, SPC, etc.), quer pelos Locadores ou seus representantes, quer pela Seguradora. Tais débitos incluem todas as despesas eventualmente incorridas com as medidas extrajudiciais e/ou judiciais cabíveis adotadas para cobrança. Fica certo e acordado entre as partes que quaisquer notificações, inclusive sobre eventuais débitos decorrentes do presente contrato, poderão ser realizadas ao Locatário, via e-mail.

6. O Seguro Fiança Locatícia garantirá exclusivamente as coberturas especificadas na apólice de seguro emitida pela Junto Seguros S.A.

7. Havendo mais de um Locatário para exercer os direitos e dar cumprimento às obrigações deste contrato, ao firmarem a locação, os Locatários, declaram-se solidários entre si e constituem-se reciprocamente PROCURADORES, conferindo-se mutuamente poderes especiais para receber citações, notificações e intimações, confessar, desistir, e assinar tudo quanto se tornar necessário, transigir em Juízo ou fora dele, fazer acordos, firmar compromissos judiciais ou extrajudiciais, receber e dar quitação no âmbito deste contrato.

8. Na ocorrência de inadimplência garantida pela apólice de seguro, o Locador autoriza a [IMOBILIÁRIA / ADMINISTRADORA DE BENS – Razão social e CNPJ] a atuar perante a Junto Seguros S.A. como seu representante, conferindo-lhe poderes inclusive para receber e dar quitação, fazer acordos e firmar compromissos judiciais ou extrajudiciais relacionados à garantia em comento, em especial para os valores indenizáveis pela Seguradora.`;

const JUNTO_DANOS = `O Locatário declara, para todos os fins e efeitos de direito, que recebe o imóvel locado no estado em que se encontra de conservação e uso, identificado no relatório de vistoria prévia do imóvel, assinado por todos os contratantes, o qual é parte integrante deste contrato, obrigando-se e comprometendo-se a devolvê-lo nesse estado, independentemente de qualquer aviso ou notificação prévia e qualquer que seja o motivo de devolução, sob pena de incorrer nas cominações previstas neste contrato ou em lei, além da obrigação de indenizar por danos ou prejuízos decorrentes da inobservância dessa obrigação, salvo as deteriorações decorrentes de do uso normal do imóvel.

O Locatário declara ainda estar ciente de que, a devolução do imóvel em desconformidade com o relatório de vistoria prévia acarretará no pagamento de indenização pela Seguradora ao Locador referente aos danos materiais causados pelo Locatário, tendo a Seguradora o direito de reaver o valor que tiver sido pago, conforme previsto na Apólice.

É obrigatória a apresentação dos relatórios de vistoria prévia e final, no qual consta a identificação de todos os danos constatados, assinado pelas partes. Na vistoria final, a assinatura do Locatário será de caráter facultativo.

Para o acionamento da cobertura adicional de danos ao imóvel, fica o Locador obrigado a comunicar o sinistro à Seguradora no prazo máximo de 15 (quinze) dias, contados da desocupação do imóvel.`;

const JUNTO_MULTA = `O Locatário declara, para todos os fins e efeitos de direito, estar ciente e reconhecer que a entrega antecipada do imóvel antes do final da vigência do contrato de locação configura quebra contratual obrigando-o, portanto, ao pagamento da multa rescisória prevista no contrato. O Locatário declara ainda estar ciente de que o não pagamento da multa prevista ao Locador acarretará o pagamento da indenização pela Seguradora, desde que contratada a respectiva cobertura na apólice de seguro, tendo esta o direito de reaver o valor que tiver sido pago, nos termos da apólice. Fica o Locador obrigado a comunicar o sinistro à Seguradora no prazo máximo de 15 (quinze) dias, contados da desocupação do imóvel, para acionamento da cobertura adicional de multa por rescisão contratual.`;

const JUNTO_PINTURA_INT = `O Locatário declara, para todos os fins e efeitos de direito, que recebe o imóvel locado com pintura nova, e assim obriga-se, ao final da locação, conforme previsto neste contrato, a pintá-lo e devolvê-lo no mesmo estado em que recebeu, sob pena de incorrer nas cominações previstas neste contrato ou estipuladas em lei. O locatário declara ainda estar ciente de que, não devolvendo o imóvel pintado internamente, a Seguradora indenizará o locador pelo ônus da pintura, e terá direito de reaver o valor que tiver sido pago, nos termos da apólice. Fica o Locador obrigado a comunicar o sinistro à Seguradora no prazo máximo de 15 (quinze) dias, contados da desocupação do imóvel.`;

const JUNTO_PINTURA_EXT = `O Locatário declara, para todos os fins e efeitos de direito, que recebe o imóvel locado com pintura externa nova, e assim obriga-se, ao final da locação, a pintá-lo e devolvê-lo no mesmo estado que recebeu, sob pena de incorrer nas cominações previstas neste contrato ou estipuladas em lei. O Locatário declara ainda estar ciente de que não devolvendo o imóvel pintado externamente, a Seguradora indenizará o locador pelo ônus da pintura, e terá direito de reaver o valor que tiver sido pago, nos termos da apólice. Fica o Locador obrigado a comunicar o sinistro à Seguradora no prazo máximo de 15 (quinze) dias, contados da desocupação do imóvel.`;

const PORTO_BASE = `O seguro de Fiança Locatícia contratado pelo(s) LOCADOR(ES) junto a PORTO SEGURO CIA. DE SEGUROS GERAIS, em que a vigência inicial será a data de protocolo da proposta ou data distinta acordada entre as partes e a vigência final será a data do término do contrato de locação, garantirá está locação, nos termos do inciso III, do artigo 37 da Lei do Inquilinato, mediante pagamento de prêmio, ressalvadas as exceções previstas nas condições gerais.

A PORTO SEGURO CIA. DE SEGUROS GERAIS, disponibiliza a possibilidade de contratação de produtos com condições diferentes em relação ao Limite Máximo de Garantia (LMG). No SEGURO FIANÇA LOCATÍCIA TRADICIONAL, o LMG é a soma dos limites máximos de indenização (LMI) das coberturas contratadas.

No SEGURO FIANÇA LOCATÍCIA ESSENCIAL, o LMG da apólice é igual ao LMI da cobertura de ALUGUEL. Quando contratada apenas a Cobertura Básica - Não Pagamento de Aluguéis, o Limite Máximo de Garantia da apólice será igual ao Limite Máximo de Indenização desta mesma cobertura. Quando houver a contratação de coberturas adicionais, o Limite Máximo de Garantia da apólice será menor que a soma dos Limites Máximos de Indenização das coberturas contratadas.

São de conhecimento do(s) LOCADOR(es) e LOCATÁRIO(S) as Condições Gerais do seguro de Fiança Locatícia, sendo que para a contratação da apólice, LOCADOR(es) e LOCATÁRIO(s) definiram previamente, mediante acordo, a seguradora, o corretor de seguros e os limites da apólice. Para efeito desta garantia, LOCADOR (es) e LOCATÁRIO(s) acordam que os prêmios iniciais e renovações do seguro de fiança locatícia, calculados conforme NORMAS VIGENTES, serão pagos pelo(s) LOCATÁRIOS(s), de acordo com o inciso XI, do artigo 23 da lei do inquilinato, sob pena de rescisão desta locação, com o consequente despejo e cancelamento da apólice. Na hipótese de inadimplência do(s) LOCATÁRIO(s), o(s) LOCADOR(es) poderá(ão) efetuar o pagamento dos prêmios, para que a apólice permaneça vigente.

Em caso de prorrogação do contrato de locação, com alterações que influenciam nas condições iniciais de aceitação, a seguradora se reservará ao direito de realizar nova análise do risco. LOCADOR(ES) e LOCATÁRIO (S) declaram que até a data da contratação do seguro, todas as obrigações contratuais foram cumpridas pelas partes, tendo o (s) LOCATÁRIO (s) adimplido pontualmente todos os alugueis e encargos da locação. Declaram ainda que não há sinistro a reclamar, quanto a alugueis e encargos, bem como estão cientes que não haverá cobertura securitária para os aluguéis e encargos vencidos e vincendos, caso seja identificado que o primeiro inadimplemento tenha ocorrido antes da contratação do seguro, ficando a seguradora, desobrigada e isenta de toda e qualquer responsabilidade, ainda que haja reclamação futura de inadimplência anterior a data de contratação do seguro.

A apólice garantirá exclusivamente as coberturas especificadas na proposta de seguro. Eventuais débitos decorrentes do presente contrato, não pagos pelo(s) LOCATÁRIO (s) após regularmente instados a tanto serão comunicados às entidades mantenedoras de bancos de dados de proteção ao crédito (Serasa, SPC, etc.), quer pelos Locadores, quer pela Seguradora. Tais débitos incluem todas as despesas com as medidas judiciais cabíveis. Notificações em geral, inclusive sobre eventuais débitos decorrentes do presente contrato poderão ser realizadas ao(s) LOCATÁRIO(S), via e-mail.

As Partes convencionam que a Seguradora sub-rogar-se-á automaticamente no(s) direito(s) do(s) LOCADOR(es) pelos débitos em aberto do(s) LOCATÁRIO (s) com o pagamento do(s) adiantamento(s) da indenização ou da indenização final ao(s) LOCADOR(es).

Para exercer os direitos e dar cumprimento às obrigações desse contrato, os LOCATÁRIOS declaram-se solidários entre si e constituem-se reciprocamente PROCURADORES, conferindo-se mutuamente poderes especiais para receber citações, notificações e intimações, confessar, desistir, e assinar tudo quanto se tornar necessário, transigir em Juízo ou fora dele, fazer acordos, firmar compromissos judiciais ou extrajudiciais, receber e dar quitação. (Parágrafo aplicável a contratos firmados por pessoas físicas quando houver mais de um locatário.)`;

const PORTO_DANOS = `Quando contratada a cobertura adicional de Danos ao Imóvel, passa a ter validade a seguinte cláusula: LOCADOR (es) e LOCATÁRIO(s) declara(m) que o Laudo de Vistoria Inicial, com descrição do estado do imóvel, foi elaborado antes da posse do imóvel, bem como o(s) LOCATÁRIO(s) concorda(m) com o conteúdo do laudo. O(s) LOCATÁRIO(s) declaram para todos os fins e efeitos de direito que recebe(m) o imóvel locado no estado em que se encontra de conservação e uso, identificado no Relatório referente ao estado de uso e conservação do imóvel o qual é parte integrante deste contrato, assinado por todos os contratantes, obrigando-se e comprometendo-se a devolvê-lo nesse estado, independentemente de qualquer aviso ou notificação prévia, e qualquer que seja o motivo de devolução, sob pena de incorrer nas cominações previstas neste contrato ou estipuladas em lei, além da obrigação de indenizar por danos ou prejuízos decorrentes da inobservância dessa obrigação, salvo as deteriorações decorrentes do uso normal do imóvel.`;

const PORTO_PINTURA_INT = `Quando contratada a cobertura adicional de Pintura Interna, passa a ter validade a seguinte cláusula: LOCADOR (es) e LOCATÁRIO(s) declara(m) que o Laudo de Vistoria Inicial, com descrição do estado do imóvel, foi elaborado antes da posse do imóvel, bem como o(s) LOCATÁRIO(s) concorda(m) com o conteúdo do laudo. Declara(m) o(s) locatário(s), para todos os fins e efeitos de direito, que recebe(m) o imóvel locado com Pintura Interna NOVA, e assim obriga-se, ao final da locação, a pintá-lo e devolvê-lo no mesmo estado em que recebeu, sob pena de incorrer nas cominações previstas neste contrato ou estipuladas em lei. O(s) locatário(s) declara(m) ainda estar ciente de que, não devolvendo o imóvel pintado internamente, a Seguradora indenizará o locador pelo ônus da pintura, e terá direito de reaver o valor que tiver sido pago, nos termos da apólice. O Segurado poderá comunicar o Sinistro a Porto Seguro no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel.`;

const PORTO_PINTURA_EXT = `Quando contratada a cobertura adicional de Pintura Externa, passa a ter validade a seguinte cláusula: LOCADOR (es) e LOCATÁRIO(s) declara(m) que o Laudo de Vistoria Inicial, com descrição do estado do imóvel, foi elaborado antes da posse do imóvel, bem como o(s) LOCATÁRIO(s) concorda(m) com o conteúdo do laudo. Declara(m) o(s) locatário(s), para todos os fins e efeitos de direito, que recebe(m) o imóvel locado com Pintura Externa NOVA, e assim obriga-se, ao final da locação, a pintá-lo e devolvê-lo no mesmo estado que recebeu, sob pena de incorrer nas cominações previstas neste contrato ou estipuladas em lei. O(s) locatário(s) declara(m) ainda estar ciente de que não devolvendo o imóvel pintado externamente, a Seguradora indenizará o locador pelo ônus da pintura, e terá direito de reaver o valor que tiver sido pago, nos termos da apólice.`;

const POTTENCIAL_BASE = `As Partes anuem com a emissão de seguro fiança locatícia para garantia do presente contrato, nos termos do art. 37, III da Lei nº 8.245/1991 (Lei de Locações), a ser contratado pelo(a) LOCATÁRIO(A), junto à Pottencial Seguradora S.A., tendo como Segurado o LOCADOR e declaram ter negociado e anuído com a indicação do corretor de seguros, as coberturas e limites de indenização contratados, cujos termos e condições do contrato de seguro estão disponíveis para consulta através do link https://pottencial.com.br/certidoes-legais/condicoes-gerais/.

O seguro estará vigente pelo período previsto na apólice emitida. Ocorrendo prorrogação de prazo do presente contrato de locação com alteração das condições anteriormente estabelecidas entre as partes, mediante formalização de aditivo ou em razão de prorrogação por prazo indeterminado por força de lei ou ato normativo, a Seguradora deverá ser comunicada para reanálise de aceitação do risco.

Para efeito desta garantia, os prêmios iniciais e de renovações do seguro fiança serão pagos pelo LOCATÁRIO(A), de acordo com o inciso XI, do artigo 23 da lei do inquilinato. Exclusivamente em caso de o pagamento do prêmio ser efetivada através de fatura, o LOCATÁRIO desde já anui com a realização do pagamento do prêmio à IMOBILIÁRIA para posterior repasse da quantia à Seguradora.

A apólice garantirá exclusivamente as coberturas especificadas na proposta de seguro.

Inadimplência - Em caso de inadimplência do LOCATÁRIO(A), a SEGURADORA concederá prazo ao LOCADOR(A) para pagamento do prêmio, nos termos previstos nas Condições Gerais do seguro, sob pena de cancelamento do seguro e rescisão desta locação por infração contratual, com o consequente despejo.

Notificações – O(A) LOCADOR(A) e LOCATÁRIO(A) declara(m) que todos os dados informados para contratação do seguro estão corretos, estando cientes de que serão considerados pela SEGURADORA para envio de quaisquer notificações e/ou comunicações previstas na legislação vigente e Condições Gerais do seguro, sendo presumidos válidos para todos os fins de direito. O (A) LOCADOR(A) e o(a) LOCATÁRIO(A) poderão outorgar poderes à terceiros para recebimento de tais notificações e/ou comunicações, inclusive o(a) corretor/corretora de seguros ou a imobiliária, hipótese em que serão indicados os dados destes terceiros para contratação do seguro. Sendo necessário ajuste de qualquer dado, o(a) LOCADOR(A) ou o(a) LOCATÁRIO(A) deverão, a qualquer momento, entrar em contato com a SEGURADORA através da Central de Atendimento 0800 606 7688 ou pelo e-mail atendimento.corretora@pottencial.com.br para alteração ou correção.

Pagamento de indenizações e Sub-rogação. Em caso de pagamento de qualquer indenização securitária, a SEGURADORA sub-rogar-se-á automaticamente no direito do LOCADOR(A) de cobrar os débitos em aberto em face do(a) LOCATÁRIO(A).

Restrição Financeira. Eventuais débitos decorrentes do presente contrato ou do contrato de seguro não pagos pelo LOCATÁRIO(A) serão comunicados às entidades mantenedoras de bancos de dados de proteção ao crédito (Serasa, SPC, etc.), quer pelo LOCADOR(A), quer pela SEGURADORA, inclusive de todas as despesas havidas com as medidas judiciais cabíveis.

Locatário Solidário – Havendo mais de um LOCATÁRIO(A) para exercer os direitos e dar cumprimento às obrigações desse contrato, ao firmarem esta locação, os LOCATÁRIOS(AS) declaram-se solidários entre si e constituem-se reciprocamente PROCURADORES, conferindo-se mutuamente poderes especiais para receber citações, notificações e intimações, confessar, desistir, e assinar tudo quanto se tornar necessário, transigir em juízo ou fora dele, fazer acordos, firmar compromissos judiciais ou extrajudiciais, receber e dar quitação, no âmbito deste contrato.`;

const POTTENCIAL_MULTA = `Cobertura adicional de Multa Rescisória (contratação opcional) – Em caso de contratação desta cobertura adicional, o(a) LOCATÁRIO(A) reconhece que a entrega antecipada do imóvel antes da vigência final do contrato de locação configura quebra contratual, estando, portanto, obrigado ao pagamento de multa por rescisão que, caso não adimplida, poderá ensejar o pagamento da indenização securitária pela SEGURADORA. O(A) LOCATÁRIO(A) declara, ainda, estar ciente de que, não realizando o pagamento da multa prevista ao(a) LOCADOR(A), a SEGURADORA efetuará a indenização, com consequente pedido de ressarcimento em face do(a) LOCATÁRIO(A). O Segurado deverá comunicar o Sinistro à Pottencial no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel.`;

const POTTENCIAL_DANOS = `Cobertura adicional de Danos ao Imóvel (contratação opcional) – Em caso de contratação desta cobertura adicional, o(a) LOCATÁRIO(A) declara para todos os fins e efeitos de direito, que recebe o imóvel locado no estado em que se encontra de conservação e uso, identificado no Laudo (Relatório) de Vistoria Inicial assinado por todos os contratantes, o qual é parte integrante deste contrato, obrigando-se e comprometendo-se o(a) LOCATÁRIO(A) a devolvê-lo nesse estado, independentemente de qualquer aviso ou notificação prévia e qualquer que seja o motivo de devolução, sob pena de incorrer nas cominações previstas neste contrato ou estipuladas em lei, além da obrigação de indenizar por danos ou prejuízos decorrentes da inobservância dessa obrigação, salvo as deteriorações decorrentes do uso normal do imóvel. O(A) LOCATÁRIO(A) declara, ainda, estar ciente de que, não realizando o pagamento dos prejuízos ao(a) LOCADOR(A), a SEGURADORA efetuará a indenização nos termos dos limites e condições contratuais do seguro, com consequente pedido de ressarcimento em face do(a) LOCATÁRIO(A). LOCADOR(A) e LOCATÁRIO(A) declaram que o Laudo (Relatório) de Vistoria Inicial com descrição do estado do imóvel foi elaborado antes da posse do imóvel, estando de acordo com todo o conteúdo do laudo. É imprescindível e obrigatória a apresentação do Relatório do Estado do Uso de Conservação do imóvel, assinado pelo Locador(a) e Locatário(a) como condição para pagamento de indenização pela SEGURADORA. O Segurado deverá comunicar o Sinistro à Pottencial no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel.`;

const POTTENCIAL_PINTURA_INT = `Cobertura adicional de Pintura Interna Nova (contratação opcional) – Caso contratada esta cobertura, declara o(a) LOCATÁRIO (A), para todos os fins e efeitos de direito, que recebe o imóvel locado com Pintura Interna NOVA e, assim, obriga-se, ao final da locação, a pintá-lo e devolvê-lo no mesmo estado em que recebeu, sob pena de arcar com os valores devidos ao(a) LOCADOR(A) para realização de nova pintura. O(A) LOCATÁRIO(A) declara ainda estar ciente de que, não devolvendo o imóvel pintado internamente, e estando a respectiva cobertura contratada na proposta de seguro, a SEGURADORA indenizará o(a) LOCADOR(A) pelos prejuízos havidos com a nova pintura, e terá direito de reaver o valor que tiver sido pago, nos termos dos limites e condições contratuais do seguro, em face do(a) LOCATÁRIO(A). O Segurado deverá comunicar o Sinistro à Pottencial no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel.`;

const POTTENCIAL_PINTURA_EXT = `Cobertura adicional de Pintura Externa Nova (cobertura opcional) – A cobertura é exclusiva para imóveis residenciais e não residenciais (casas para fins comerciais), na qual o locatário ocupa a área global do imóvel alugado. Declara o(a) LOCATÁRIO(A), para todos os fins e efeitos de direito, que recebe o imóvel locado com Pintura Externa NOVA, e assim obriga-se, ao final da locação, a pintá-lo e devolvê-lo no mesmo estado que recebeu, sob pena de arcar com os valores devidos ao(a) LOCADOR(A) para realização de nova pintura. O(A) LOCATÁRIO(A) declara ainda estar ciente de que, não devolvendo o imóvel pintado internamente, e estando a respectiva cobertura contratada na proposta de seguro, a SEGURADORA indenizará o(a) LOCADOR(A) pelos prejuízos havidos com a nova pintura, e terá direito de reaver o valor que tiver sido pago, nos termos dos limites e condições contratuais do seguro, em face do(a) LOCATÁRIO(A). O(A) Segurado(a) deverá comunicar o Sinistro a Pottencial no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel.`;

const TOKIO_BASE = `CLÁUSULA OBRIGATÓRIA Nº 1 – DA GARANTIA LOCATÍCIA (Obrigatória em todas as contratações)
O seguro de Fiança Locatícia contratado pelo LOCADOR junto a TOKIO MARINE SEGURADORA, cuja vigência inicial será a data de protocolo da proposta e a vigência final será a data do término do contrato de locação ou a data do próximo reajuste do aluguel, garantirá esta locação, nos termos do inciso III, do artigo 37 da Lei do Inquilinato, mediante pagamento de prêmio. Para a presente contratação, ficou acordado que a vigência do seguro será pelo prazo do contrato. Havendo a realização de novo contrato, prorrogação deste ou decorridos 5 anos do contrato a aceitação do seguro ficará sujeita à nova análise do risco, ressalvadas as exceções previstas nas condições gerais. São de conhecimento do LOCADOR e LOCATÁRIO(S) as Condições Gerais do seguro de Fiança Locatícia. Para efeito desta garantia, os prêmios iniciais e renovações, calculados conforme NORMAS VIGENTES, serão pagos pelo(s) Locatário(s), de acordo com o inciso XI, do artigo 23 da lei do inquilinato, sob pena de rescisão desta locação, com o consequente despejo e cancelamento da apólice. A apólice garantirá exclusivamente as coberturas especificadas na proposta de seguro. Eventuais débitos decorrentes do presente contrato, não pagos pelo(s) Locatário(s) após regularmente instados a tanto serão comunicados às entidades mantenedoras de bancos de dados de proteção ao crédito (Serasa, SPC, etc.), quer pelo Locador(a), quer pela Seguradora. Tais débitos incluem todas as despesas com as medidas judiciais cabíveis.

Frase variável que deve aparecer nos contratos de locação firmados por pessoas físicas, quando houver mais de um locatário:
Para exercer os direitos e dar cumprimento às obrigações desse contrato, os LOCATÁRIOS declaram-se solidários entre si e constituem-se reciprocamente PROCURADORES, conferindo-se mutuamente poderes especiais para receber citações, notificações e intimações, confessar, desistir, e assinar tudo quanto se tornar necessário, transigir em Juízo ou fora dele, fazer acordos, firmar compromissos judiciais ou extrajudiciais, receber e dar quitação.`;

const TOKIO_DANOS = `CLÁUSULA ESPECIAL Nº 2 – DANOS AO IMÓVEL (quando contratada a cobertura de danos ao imóvel)
O locatário declara para todos os fins e efeitos de direito, que recebe o imóvel locado no estado em que se encontra de conservação e uso, identificado no Laudo de Vistoria Inicial o qual é parte integrante deste contrato, assinado por todos os contratantes, obrigando-se e comprometendo-se a devolvê-lo nesse estado, independentemente de qualquer aviso ou notificação prévia e qualquer que seja o motivo de devolução, sob pena de incorrer nas cominações previstas neste contrato ou estipuladas em lei, além da obrigação de indenizar por danos ou prejuízos decorrentes da inobservância dessa obrigação, salvo as deteriorações decorrentes do uso normal do imóvel.`;

const TOKIO_PINTURA_INT = `CLÁUSULA ESPECIAL Nº 3 – PINTURA INTERNA (quando contratada a cobertura de pintura interna)
Declara o locatário, para todos os fins e efeitos de direito, que recebe o imóvel locado com Pintura Interna NOVA, e assim obriga-se, ao final da locação, a pintá-lo e devolvê-lo no mesmo estado em que recebeu, sob pena de incorrer nas cominações previstas neste contrato ou estipuladas em lei. O locatário declara ainda estar ciente de que, não devolvendo o imóvel pintado internamente, a Seguradora indenizará o locador pelo ônus da pintura, e terá direito de reaver o valor que tiver sido pago. O Segurado deverá comunicar o Sinistro a TOKIO MARINE no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel.`;

const TOKIO_PINTURA_EXT = `CLÁUSULA ESPECIAL Nº 4 – PINTURA EXTERNA (quando contratada a cobertura de pintura externa)
Declara o locatário, para todos os fins e efeitos de direito, que recebe o imóvel locado com Pintura Externa NOVA, e assim obriga-se, ao final da locação, a pintá-lo e devolvê-lo no mesmo estado que recebeu, sob pena de incorrer nas cominações previstas neste contrato ou estipuladas em lei. O locatário declara ainda estar ciente de que não devolvendo o imóvel pintado externamente, a Seguradora indenizará o locador pelo ônus da pintura, e terá direito de reaver o valor que tiver sido pago. O Segurado deverá comunicar o Sinistro a TOKIO MARINE no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel. Esta cobertura é válida somente para imóveis residenciais e não residenciais do tipo "casa", onde o locatário ocupa a totalidade do imóvel alugado.`;

const TOO_BASE = `1. O Seguro de Fiança Locatícia será contratado junto à TOO SEGUROS S.A., pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 33.245.762/0001-07, com sede na Avenida Paulista, 1374, 13º andar, Bela Vista, São Paulo/SP, CEP 01.310-100 ("SEGURADORA"), cuja vigência seguirá o disposto na Proposta de Contratação do Seguro, garantirá esta locação, nos termos do inciso III do art. 37 da Lei do Inquilinato, mediante pagamento de Prêmio.

1.1. LOCADOR e LOCATÁRIO declaram que conhecem e aceitam as Condições Gerais do Seguro Fiança Locatícia.

1.2. O Prêmio do Seguro, calculado conforme suas Condições Gerais e legislação aplicável, será pago pelo LOCATÁRIO, de acordo com o inciso XI do art. 23 da Lei do Inquilinato, sob pena de rescisão desta locação, com o consequente despejo e cancelamento da apólice.

1.3. A Apólice garantirá exclusivamente as coberturas especificadas na Proposta de Contratação. As Partes reconhecem e aceitam que a responsabilidade da SEGURADORA em relação à cobertura Multas Contratuais estará limitada ao valor previsto na Apólice de Seguro.

1.4. Eventuais débitos decorrentes do presente Contrato, não pagos pelo LOCATÁRIO após regularmente instado para tanto, serão comunicados às entidades mantenedoras de bancos de dados de proteção ao crédito (Serasa, SPC, etc.), quer pelo LOCADOR, quer pela SEGURADORA.

1.4.1. Os débitos mencionados no item anterior incluem todas as despesas com as medidas judiciais cabíveis.

1.4.2. Havendo mais de um LOCATÁRIO, declaram-se solidários entre si, concedendo uns aos outros poderes para recebimento de citação.

Na ocorrência de inadimplência garantida pela Apólice de Seguro, o LOCADOR poderá autorizar a imobiliária/administradora (razão social e CNPJ/CPF do procurador) a receber e dar quitação para os valores apurados e indenizáveis pela Seguradora. Este parágrafo é opcional e deve ser preenchido apenas quando o LOCADOR outorgar procuração a terceiros.`;

const TOO_DANOS = `Quando contratada a cobertura adicional de Danos ao Imóvel: O LOCATÁRIO declara, para todos os fins e efeitos de direito, que recebe o imóvel locado no estado de conservação e uso em que se encontra, identificado no relatório referente ao estado de uso e conservação do imóvel, o qual é parte integrante deste Contrato, assinado por todos os contratantes, obrigando-se e comprometendo-se a devolvê-lo nesse estado, independentemente de qualquer aviso ou notificação prévia, e qualquer que seja o motivo de devolução, sob pena de incorrer nas cominações previstas neste Contrato ou estipuladas em lei, além da obrigação de indenizar o LOCADOR por danos ou prejuízos decorrentes da inobservância dessa obrigação, salvo as deteriorações decorrentes do uso normal do imóvel.`;

const TOO_PINTURA_INT = `Quando contratada a cobertura adicional de Pintura Interna: Declara o LOCATÁRIO, para todos os fins e efeitos de direito, que recebe o imóvel locado com pintura interna nova e assim obriga-se, ao final da locação, a pintá-lo e devolvê-lo no mesmo estado que recebeu, sob pena de incorrer nas cominações previstas neste Contrato ou estipuladas em lei. O LOCATÁRIO declara ainda estar ciente de que não devolvendo o imóvel pintado internamente, a SEGURADORA indenizará o LOCADOR pelo ônus da pintura, e terá direito de reaver o valor que tiver sido pago. O LOCADOR deverá comunicar o Sinistro à SEGURADORA no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel.`;

const TOO_PINTURA_EXT = `Quando contratada a cobertura adicional de Pintura Externa: Declara o locatário, para todos os fins e efeitos de direitos, que recebe o imóvel com pintura externa nova e assim obriga-se, ao final da locação, a pintá-lo e devolvê-lo no mesmo estado que recebeu, sob pena de incorrer nas cominações previstas neste Contrato ou estipulados em lei. O LOCATÁRIO declara ainda estar ciente de que não devolvendo o imóvel pintado externamente a SEGURADORA indenizará o LOCADOR pelo ônus da pintura e terá direito de reaver o valor que tiver sido pago. O LOCADOR deverá comunicar o Sinistro à SEGURADORA no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel.`;

const TOO_DANOS_MOVEIS = `Quando contratada a cobertura adicional de Danos aos Móveis: O LOCATÁRIO declara, para todos os fins e efeitos de direito, que os móveis existentes no imóvel locado se encontram no estado de conservação e uso identificado no relatório referente ao estado de uso e conservação dos móveis, o qual é parte integrante deste Contrato, assinado por todos os contratantes, obrigando-se e comprometendo-se a devolvê-los nesse estado, independentemente de qualquer aviso ou notificação prévia, e qualquer que seja o motivo de devolução, sob pena de incorrer nas cominações previstas neste Contrato ou estipuladas em lei, além da obrigação de indenizar o LOCADOR por danos ou prejuízos decorrentes da inobservância dessa obrigação, salvo as deteriorações decorrentes do uso normal dos móveis.`;

async function seguradora(nome) {
  const { data, error } = await supabase
    .from("seguradoras")
    .insert({ nome })
    .select("id")
    .single();
  if (error) throw new Error(`seguradora ${nome}: ${error.message}`);
  return data.id;
}

async function produto(seguradora_id, nome, clausula_base) {
  const { data, error } = await supabase
    .from("produtos")
    .insert({ seguradora_id, tipo_garantia_id: fiancaId, nome, clausula_base })
    .select("id")
    .single();
  if (error) throw new Error(`produto ${nome}: ${error.message}`);
  return data.id;
}

async function cobertura(produto_id, nome, texto) {
  const { error } = await supabase
    .from("coberturas_adicionais")
    .insert({ produto_id, nome, texto });
  if (error) throw new Error(`cobertura ${nome}: ${error.message}`);
}

// Junto Seguros
{
  const seguradoraId = await seguradora("Junto Seguros");
  const produtoId = await produto(seguradoraId, "Fiança Locatícia", JUNTO_BASE);
  await cobertura(produtoId, "Danos ao Imóvel", JUNTO_DANOS);
  await cobertura(produtoId, "Multa Rescisória", JUNTO_MULTA);
  await cobertura(produtoId, "Pintura Interna", JUNTO_PINTURA_INT);
  await cobertura(produtoId, "Pintura Externa", JUNTO_PINTURA_EXT);
  console.log("Junto Seguros ok");
}

// Porto Seguro (Tradicional + Essencial, mesmo texto-base)
{
  const seguradoraId = await seguradora("Porto Seguro");
  for (const nomeProduto of ["Fiança Locatícia Tradicional", "Fiança Locatícia Essencial"]) {
    const produtoId = await produto(seguradoraId, nomeProduto, PORTO_BASE);
    await cobertura(produtoId, "Danos ao Imóvel", PORTO_DANOS);
    await cobertura(produtoId, "Pintura Interna", PORTO_PINTURA_INT);
    await cobertura(produtoId, "Pintura Externa", PORTO_PINTURA_EXT);
  }
  console.log("Porto Seguro ok");
}

// Pottencial (Tradicional + Taxa Fixa, mesmo texto-base)
{
  const seguradoraId = await seguradora("Pottencial Seguradora");
  for (const nomeProduto of ["Fiança Locatícia Tradicional", "Fiança Locatícia Taxa Fixa"]) {
    const produtoId = await produto(seguradoraId, nomeProduto, POTTENCIAL_BASE);
    await cobertura(produtoId, "Multa Rescisória", POTTENCIAL_MULTA);
    await cobertura(produtoId, "Danos ao Imóvel", POTTENCIAL_DANOS);
    await cobertura(produtoId, "Pintura Interna Nova", POTTENCIAL_PINTURA_INT);
    await cobertura(produtoId, "Pintura Externa Nova", POTTENCIAL_PINTURA_EXT);
  }
  console.log("Pottencial ok");
}

// Tokio Marine
{
  const seguradoraId = await seguradora("Tokio Marine Seguradora");
  const produtoId = await produto(seguradoraId, "Fiança Locatícia", TOKIO_BASE);
  await cobertura(produtoId, "Danos ao Imóvel", TOKIO_DANOS);
  await cobertura(produtoId, "Pintura Interna", TOKIO_PINTURA_INT);
  await cobertura(produtoId, "Pintura Externa", TOKIO_PINTURA_EXT);
  console.log("Tokio Marine ok");
}

// TOO Seguros
{
  const seguradoraId = await seguradora("TOO Seguros");
  const produtoId = await produto(seguradoraId, "Fiança Locatícia", TOO_BASE);
  await cobertura(produtoId, "Danos ao Imóvel", TOO_DANOS);
  await cobertura(produtoId, "Pintura Interna", TOO_PINTURA_INT);
  await cobertura(produtoId, "Pintura Externa", TOO_PINTURA_EXT);
  await cobertura(produtoId, "Danos aos Móveis", TOO_DANOS_MOVEIS);
  console.log("TOO Seguros ok");
}

console.log("Cadastro completo.");
