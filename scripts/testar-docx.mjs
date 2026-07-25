import { gerarContratoDocx } from "../src/lib/gerarContratoDocx.ts";
import fs from "node:fs";

const textoBase = `1. DAS PARTES E DO OBJETO: Pelo presente instrumento particular de locação, as partes acima qualificadas ajustam a locação do imóvel descrito nos Dados da Locação, nos termos da Lei nº 8.245/91 (Lei do Inquilinato) e das cláusulas a seguir.

2. DO PRAZO: O prazo de locação é o indicado nos Dados da Locação, contado a partir da data de início ali informada, findando-se automaticamente ao seu término, independentemente de aviso, notificação ou interpelação judicial ou extrajudicial. Findo o prazo, se o LOCATÁRIO permanecer no imóvel por mais de 30 (trinta) dias sem oposição do LOCADOR, a locação prorrogar-se-á por prazo indeterminado, nas mesmas condições ora ajustadas.

3. DO VALOR DO ALUGUEL, PAGAMENTO E REAJUSTE: O aluguel mensal é o indicado nos Dados da Locação e deverá ser pago até o dia informado no cadastro da imobiliária, mediante boleto bancário emitido pela HORIZONTE IMÓVEIS. O valor será reajustado anualmente pelo índice indicado nos Dados da Locação, incidindo sempre sobre o último aluguel vigente, sem redução em caso de variação negativa do índice.

4. DOS ENCARGOS: Correm por conta exclusiva do LOCATÁRIO todas as despesas ordinárias de condomínio, IPTU, taxas de água, esgoto e lixo, bem como as contas de energia elétrica e gás, que deverão ser transferidas para o nome do LOCATÁRIO em até 30 (trinta) dias do início da locação. As despesas extraordinárias de condomínio, nos termos do art. 22 da Lei do Inquilinato, correm por conta do LOCADOR.

5. DA MULTA POR ATRASO, JUROS E HONORÁRIOS: O atraso no pagamento do aluguel ou de qualquer encargo sujeitará o LOCATÁRIO à multa de 10% (dez por cento) sobre o valor devido, acrescida de juros de mora de 1% (um por cento) ao mês, calculados pro rata die. Encaminhado o débito para cobrança judicial ou extrajudicial, incidirão honorários advocatícios de 20% (vinte por cento) sobre o valor cobrado.

6. DA CONSERVAÇÃO E DAS BENFEITORIAS: O LOCATÁRIO obriga-se a manter o imóvel em perfeito estado de conservação e limpeza, restituindo-o ao final da locação nas mesmas condições em que o recebeu, conforme laudo de vistoria inicial, ressalvados os desgastes decorrentes do uso normal. Nenhuma obra, reforma ou benfeitoria poderá ser realizada sem prévia autorização escrita do LOCADOR, incorporando-se estas ao imóvel sem direito a retenção ou indenização, salvo disposição em contrário.

7. DA FINALIDADE E DO USO: O imóvel destina-se exclusivamente ao uso indicado nos Dados da Locação, não podendo o LOCATÁRIO alterar sua destinação sem prévia autorização escrita do LOCADOR, nem utilizá-lo de forma que prejudique o sossego, a segurança ou a salubridade do imóvel e da vizinhança.

8. DA VISTORIA: O imóvel é entregue ao LOCATÁRIO no estado descrito no laudo de vistoria inicial, parte integrante deste contrato. Eventuais divergências deverão ser apontadas por escrito no prazo de 7 (sete) dias contados do recebimento das chaves, sob pena de aceitação tácita do laudo.

9. DA CESSÃO E SUBLOCAÇÃO: É vedado ao LOCATÁRIO ceder, sublocar ou emprestar o imóvel, no todo ou em parte, sem o prévio e expresso consentimento por escrito do LOCADOR.

10. DO SINISTRO E DA DESAPROPRIAÇÃO: Em caso de sinistro ou desapropriação, total ou parcial, que torne o imóvel inabitável, o presente contrato ficará automaticamente rescindido, independentemente de aviso ou notificação, sem ônus para qualquer das partes.

11. DA VENDA DO IMÓVEL: Em caso de alienação do imóvel durante a vigência da locação, fica assegurado ao LOCATÁRIO o direito de preferência na aquisição, em igualdade de condições com terceiros, nos termos do art. 27 da Lei do Inquilinato.

12. DA RESCISÃO E DAS MULTAS: A infração de qualquer cláusula deste contrato sujeitará a parte infratora ao pagamento de multa equivalente a 3 (três) alugueis vigentes, sem prejuízo da rescisão contratual e demais perdas e danos cabíveis. A devolução antecipada do imóvel pelo LOCATÁRIO sujeitará este ao pagamento de multa compensatória proporcional ao período restante do contrato, nos termos do art. 4º da Lei do Inquilinato.

13. DAS DISPOSIÇÕES GERAIS E DA LGPD: Este contrato obriga as partes, seus herdeiros e sucessores. Em conformidade com a Lei nº 13.709/2018 (LGPD), os dados pessoais das partes são tratados de forma confidencial, sendo seu uso autorizado exclusivamente para o fiel cumprimento deste instrumento.

14. DO FORO: Fica eleito o foro da comarca da situação do imóvel para dirimir quaisquer questões oriundas deste contrato, renunciando as partes a qualquer outro, por mais privilegiado que seja.`;

const buffer = await gerarContratoDocx({
  imobiliaria: {
    nome: "Horizonte Imóveis Administração de Locações Ltda",
    cnpj: "41.982.630/0001-17",
    creci: "11234-J",
    endereco: "Avenida Presidente Vargas, 1200, sala 804, Centro, Rio de Janeiro/RJ, CEP 20071-000",
    texto_base_contrato: textoBase,
    indice_reajuste: "IGPM",
    percentual_multa_atraso: 10,
    percentual_juros_mora: 1,
    percentual_honorarios_advocaticios: 20,
    dia_vencimento_aluguel: 10,
    plataforma_assinatura: "Clicksign",
    logo_url: "https://pcmfnqkxqbfyzppnbvms.supabase.co/storage/v1/object/public/logos/teste-horizonte-imoveis.png",
  },
  tipoGarantiaNome: "Seguro Fiança Locatícia",
  seguradoraNome: "Pottencial Seguradora",
  produtoNome: "Fiança Locatícia Taxa Fixa",
  clausulaBase: `As Partes anuem com a emissão de seguro fiança locatícia para garantia do presente contrato, nos termos do art. 37, III da Lei nº 8.245/1991 (Lei de Locações), a ser contratado pelo(a) LOCATÁRIO(A), junto à Pottencial Seguradora S.A., tendo como Segurado o LOCADOR e declaram ter negociado e anuído com a indicação do corretor de seguros, as coberturas e limites de indenização contratados, cujos termos e condições do contrato de seguro estão disponíveis para consulta através do link https://pottencial.com.br/certidoes-legais/condicoes-gerais/.

O seguro estará vigente pelo período previsto na apólice emitida. Ocorrendo prorrogação de prazo do presente contrato de locação com alteração das condições anteriormente estabelecidas entre as partes, mediante formalização de aditivo ou em razão de prorrogação por prazo indeterminado por força de lei ou ato normativo, a Seguradora deverá ser comunicada para reanálise de aceitação do risco.

Para efeito desta garantia, os prêmios iniciais e de renovações do seguro fiança serão pagos pelo LOCATÁRIO(A), de acordo com o inciso XI, do artigo 23 da lei do inquilinato.

Locatário Solidário – Havendo mais de um LOCATÁRIO(A) para exercer os direitos e dar cumprimento às obrigações desse contrato, ao firmarem esta locação, os LOCATÁRIOS(AS) declaram-se solidários entre si e constituem-se reciprocamente PROCURADORES, conferindo-se mutuamente poderes especiais para receber citações, notificações e intimações, confessar, desistir, e assinar tudo quanto se tornar necessário, transigir em juízo ou fora dele, fazer acordos, firmar compromissos judiciais ou extrajudiciais, receber e dar quitação, no âmbito deste contrato.`,
  coberturas: [
    {
      nome: "Danos ao Imóvel",
      texto: "Cobertura adicional de Danos ao Imóvel (contratação opcional) – Em caso de contratação desta cobertura adicional, o(a) LOCATÁRIO(A) declara para todos os fins e efeitos de direito, que recebe o imóvel locado no estado em que se encontra de conservação e uso, identificado no Laudo (Relatório) de Vistoria Inicial assinado por todos os contratantes, o qual é parte integrante deste contrato, obrigando-se e comprometendo-se o(a) LOCATÁRIO(A) a devolvê-lo nesse estado. O Segurado deverá comunicar o Sinistro à Pottencial no prazo máximo de 15 (quinze) dias a contar da desocupação do imóvel.",
    },
    {
      nome: "Multa Rescisória",
      texto: "Cobertura adicional de Multa Rescisória (contratação opcional) – Em caso de contratação desta cobertura adicional, o(a) LOCATÁRIO(A) reconhece que a entrega antecipada do imóvel antes da vigência final do contrato de locação configura quebra contratual, estando, portanto, obrigado ao pagamento de multa por rescisão que, caso não adimplida, poderá ensejar o pagamento da indenização securitária pela SEGURADORA.",
    },
  ],
  seguroIncendio: null,
  locador: "Ricardo Almeida Souza, CPF 123.456.789-00",
  locadorProcurador: false,
  locatario: "Camila Ferreira Rocha, CPF 987.654.321-00",
  ocupantesAdicionais: "Beatriz Rocha Lima (filha)",
  enderecoImovel: "Rua das Laranjeiras, 480, apto 302, Laranjeiras, Rio de Janeiro/RJ, CEP 22240-004",
  finalidade: "residencial",
  valorAluguel: 3200,
  dataInicio: "2026-09-01",
  prazoMeses: 30,
  laudoVistoriaUrl: "https://horizonteimoveis.com.br/laudos/laranjeiras-480-302.pdf",
});

fs.writeFileSync("scripts/contrato-teste-horizonte.docx", buffer);
console.log("gerado, bytes:", buffer.length);
