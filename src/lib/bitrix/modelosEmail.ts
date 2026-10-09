// Modelos de e-mail prontos para a aba "E-mail" dentro dos cards do Bitrix
// (src/app/bitrix-app/card-email/route.ts). Ao escolher um modelo, o assunto e
// o corpo são preenchidos e a pessoa edita o que precisar antes de enviar.
//
// Os textos NÃO são inventados: foram tirados de e-mails reais enviados pela
// equipe de Fiança da O2 (Victoria, Cassia, Brenda, Kelly, Carlos) em
// outubro/2026, mantendo as palavras originais. O que muda de um envio pro
// outro virou trecho entre colchetes, ex: [NOME DO LOCATÁRIO].
//
// Placeholders (substituídos no navegador com os dados do card; quando o card
// não tem o dado, vira um trecho entre colchetes pra pessoa completar):
//   {{responsavel}} -> responsável/contato do card
//   {{empresa}}     -> empresa ou imóvel do card
//   {{card}}        -> título do card
//
// O corpo é HTML simples (p, ul/li, b) -- o mesmo que o editor da tela produz.
// `entidades` limita o modelo a certos tipos de card (entityTypeId); sem esse
// campo o modelo aparece em qualquer card. Pra incluir um modelo novo, é só
// acrescentar um item na lista abaixo.

import { ENTITY_TYPE_ID_CAPITALIZACAO, ENTITY_TYPE_ID_SEGURO_FIANCA } from "./entidadesCard";

export type ModeloEmail = {
  id: string;
  nome: string;
  assunto: string;
  corpoHtml: string;
  entidades?: number[];
};

const FIANCA = [ENTITY_TYPE_ID_SEGURO_FIANCA];
const CAPITALIZACAO = [ENTITY_TYPE_ID_CAPITALIZACAO];

// Destaques usados pela equipe nos e-mails do Gmail (Verdana, azul-escuro
// #073763 como cor base; destaque = negrito branco sobre laranja #ff9900;
// ou só texto laranja). Mantidos aqui pra o e-mail sair igual ao original.
const LARANJA = "#ff9900";
const dest = (t: string) => `<b><span style="background-color:${LARANJA};color:#ffffff;">${t}</span></b>`;
const destSub = (t: string) => `<b><u><span style="background-color:${LARANJA};color:#ffffff;">${t}</span></u></b>`;
const laranja = (t: string) => `<b><span style="color:${LARANJA};">${t}</span></b>`;
const laranjaNeg = (t: string) => `<b><span style="color:${LARANJA};">${t}</span></b>`;
const laranjaSub = (t: string) => `<b><u><span style="color:${LARANJA};">${t}</span></u></b>`;

export const MODELOS_EMAIL: ModeloEmail[] = [
  {
    id: "fianca-renovacao-conferir-valores",
    nome: "Fiança — Renovação: conferir valores",
    entidades: FIANCA,
    assunto: "⚠️ RENOVAÇÃO SEGURO FIANÇA - [MÊS/ANO] - {{empresa}}",
    corpoHtml: [
      "<p>Prezados, bom dia!<br>Tudo bem?</p>",
      "<p>Segue em anexo relatório com informações dos valores para verificação referentes às renovações do mês de " + dest("[MÊS/ANO]") + ".</p>",
      "<p>Solicitamos que os valores sejam devidamente verificados e atualizados, caso haja correção para atualização e envio das novas cotações.</p>",
      "<p>Seguem abaixo, importantes considerações sobre a renovação da apólice de seguro fiança.</p>",
      "<ul style=\"font-style:italic;\">",
      "<li><b>Caso tenha boletos em aberto, peço que nos notifiquem, pois a renovação não poderá ser concluída.</b></li>",
      "<li>Vale ressaltar que os valores do reajuste <b>não poderão ser maiores que 10%</b> do valor informado no ano anterior. (Salvo taxa do IGPM)</li>",
      "<li>A renovação do seguro não é automática. O Locador/Representante Legal deve confirmar os valores atualizados da locação, para que a renovação seja realizada.</li>",
      "<li>Ultrapassado o prazo de vigência, a Seguradora poderá aceitar ou não a renovação deste seguro, e poderá exigir novos documentos cadastrais para tanto.</li>",
      "<li>" + laranja("Ressaltamos que após a data de fim de vigência, caso haja alguma inadimplência ou entrega de chaves com débitos, a apólice não estará concedendo cobertura. ") + destSub("Favor nos sinalizar o mais breve possível para verificarmos se deve seguir ou não com a renovação.") + "</li>",
      "</ul>",
      "<p>Qualquer dúvida estou à disposição.</p>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "fianca-renovacao-cotacao",
    nome: "Fiança — Renovação: cotação com parcelamento",
    entidades: FIANCA,
    assunto: "⚠️ RENOVAÇÃO SEGURO FIANÇA - [MÊS/ANO] - {{empresa}} X [NOME DO LOCATÁRIO]",
    corpoHtml: [
      "<p>Olá {{responsavel}}, boa tarde!</p>",
      "<p>Segue cotação para a Renovação do Seguro Fiança do cliente <b>[NOME DO LOCATÁRIO]</b>.</p>",
      "<p style=\"font-style:italic;background-color:#eeeeee;\">Por força das Circulares 587 e 594 da SUSEP (Superintendência de Seguros Privados), a garantia de Seguro Fiança Locatícia sofreu alteração referente ao prazo de vigência. As contratações realizadas a partir deste mês (março) deverão possuir o mesmo prazo de vigência equivalente ao Contrato de Locação. Para renovação, após fim de Contrato, será efetivado Seguro com prazo de 12 meses. Para renovações com o prazo maior que os 12 meses será necessário o envio do aditivo informando o novo prazo ou o envio do contrato de locação renovado.</p>",
      "<p>Vale ressaltar que o seguro atual possui " + destSub("fim de vigência dia [DD/MM].") + "</p>",
      "<p><u>Segue cotação com parcelamento:</u></p>",
      "<ul><li>" + dest("[11x]") + " – <b>sem juros</b> " + dest("R$ [VALOR DA PARCELA]") + " -&gt; <i>opção na fatura imobiliária sem entrada</i></li></ul>",
      "<p>" + destSub("OBS.: Ressaltamos que o ressarcimento da parcela para a administradora, em caso de sinistro, somente será garantido caso o parcelamento seja feito no máximo de vezes e na fatura imobiliária.") + "</p>",
      "<p>" + destSub("ATENÇÃO!") + "</p>",
      "<p><b><u>Seguem abaixo, importantes considerações sobre a renovação da apólice de seguro fiança.</u></b></p>",
      "<p><b>Ressaltamos que após a data de fim de vigência, caso haja alguma inadimplência ou entrega de chaves com débitos, a apólice não estará concedendo cobertura.</b></p>",
      "<p><b>A renovação do seguro não é automática. O Locador/Representante Legal deve confirmar os valores atualizados da locação, para que a renovação seja realizada.</b></p>",
      "<p><b>Ultrapassado o prazo de vigência, a Seguradora poderá aceitar ou não a renovação deste seguro, e poderá exigir novos documentos cadastrais para tanto.</b></p>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "fianca-recusado",
    nome: "Fiança — Recusado (com sugestão de Capitalização)",
    entidades: FIANCA,
    assunto: "ANÁLISE FIANÇA - [NOME DO PRETENDENTE] - RECUSADO",
    corpoHtml: [
      "<p>Prezados, bom dia<br>Tudo bem?</p>",
      "<p>" + dest("RECUSADO! 😓") + "</p>",
      "<p>Infelizmente o " + laranja("[NOME DO PRETENDENTE]") + ", foi recusado.</p>",
      "<p>Seguem cartas recusas.</p>",
      "<p><b>Para maiores esclarecimentos, por gentileza, entrar em contato com a </b>" + laranjaSub("[SEGURADORA]") + "<b> através do telefone [TELEFONE DA SEGURADORA].</b></p>",
      "<p>De modo a orientar e viabilizar a locação, mediante a recusa, sugerimos o " + laranjaSub("Título de Capitalização") + ".</p>",
      "<p>Garantia sem perda pecuniária para o locatário, pois, o mesmo resgata o valor corrigido ao fim da locação.</p>",
      "<p>Vale ressaltar que a partir de R$ 6.000,00, a Seguradora atua com seu jurídico, no tocante à ação de despejo. O que de certa forma é muito conveniente para a imobiliária e locador, que não se preocuparão com a demanda judicial.</p>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "fianca-em-emissao",
    nome: "Fiança — Em emissão",
    entidades: FIANCA,
    assunto: "SEGURO FIANÇA - EM EMISSÃO - [NOME DO LOCATÁRIO]",
    corpoHtml: [
      "<p>{{responsavel}}, boa tarde!</p>",
      "<p><b>Em emissão! 😎</b></p>",
      "<p>Informamos que o processo encontra-se em emissão e a cobrança iniciará junto ao faturamento de " + dest("[MÊS/ANO]") + "</p>",
      "<ul>",
      "<li>Forma de Pagamento: <b>Fatura Imobiliária</b></li>",
      "<li>Locatário: <b>[NOME DO LOCATÁRIO]</b></li>",
      "<li>Parcelamento: " + dest("[11X]") + "</li>",
      "<li>Valor da Parcela: " + dest("R$ [VALOR DA PARCELA]") + "</li>",
      "</ul>",
      "<p><b>⚠️ </b>" + dest("Lembrando que na modalidade de fatura imobiliária a cobrança do seguro deverá ser inclusa no boleto de aluguel do locatário.") + "</p>",
      "<p><b>🚨 Atenção: Informamos que o prazo para o envio da apólice é de até 15 dias, contados a partir da presente data.</b></p>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "fianca-reversao-recusa",
    nome: "Fiança — Reversão de recusa (para a seguradora)",
    entidades: FIANCA,
    assunto: "REVERSÃO DE RECUSA - [NOME DO PRETENDENTE] - Nº [NÚMERO DA ANÁLISE]",
    corpoHtml: [
      "<p>Prezados, bom dia!<br>Tudo bem?</p>",
      "<p>Poderiam, por gentileza, nos auxiliar com a reanálise da pretendente <b>[NOME DO PRETENDENTE]</b>?</p>",
      "<p>Durante a análise realizada via portal, obtivemos uma recusa junto à seguradora. No entanto, ao avaliarmos novamente o perfil dos pretendentes e as particularidades da oportunidade, identificamos a importância de buscarmos uma reavaliação do caso.</p>",
      "<p>Dessa forma, gostaríamos de contar com o apoio dos senhores e solicitar, se possível, uma nova análise do perfil, considerando as particularidades apresentadas e, eventualmente, a possibilidade de reversão da recusa inicialmente apresentada.</p>",
      "<p><b>⚠️ Em anexo documentos de comprovação de renda encaminhados pelo pretendente.</b></p>",
      "<p>Entendemos que uma nova avaliação poderá contribuir para uma melhor apreciação do caso e, consequentemente, para a conclusão dessa negociação, que é de grande importância para nós.</p>",
      "<p>Desde já, agradecemos pela atenção, parceria e pela possibilidade de avaliação especial deste caso.</p>",
      "<p><b>Ficamos no aguardo de um retorno, se possível, com a maior brevidade.</b></p>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "cap-proposta-transmitida",
    nome: "Capitalização — Proposta transmitida",
    entidades: CAPITALIZACAO,
    assunto: "{{empresa}} - EMISSÃO TITULO DE CAPITALIZAÇÃO - [NOME DO LOCATÁRIO]",
    corpoHtml: [
      "<p>{{responsavel}}, boa tarde!</p>",
      "<p><b>Proposta TRANSMITIDA! 🙌</b></p>",
      "<p>Segue em anexo a documentação abaixo referente ao processo de contratação do Título de Capitalização na <b>[SEGURADORA]</b> para o Locatário <b>[NOME DO LOCATÁRIO]</b>, com vencimento do boleto em <b>[DD/MM] (podendo ser pago antecipadamente)</b>.</p>",
      "<p><b><u>" + laranjaNeg("EM ANEXO:") + "</u></b></p>",
      "<ul>",
      "<li><b>Proposta nº [NÚMERO DA PROPOSTA] - Deve ser assinada por ambos envolvidos: Locatário e Locador</b> (assinatura comum ou eletrônica com certificado) ⚠️</li>",
      "<li>Manual Assistência de Serviços Emergenciais;</li>",
      "<li><b>Cláusulas para inserção ao Contrato de Locação (OBRIGATÓRIO); ⚠️</b></li>",
      "<li>Condições Gerais CAPFIADOR.</li>",
      "</ul>",
      "<p><b><u>" + laranjaNeg("OBSERVAÇÕES:") + "</u></b></p>",
      "<ul>",
      "<li>Indicamos que cada envolvido possua uma cópia assinada dos documentos para eventuais necessidades futuras;</li>",
      "<li>Sempre oriente ao locatário a leitura das condições gerais, com atenção ao processo das tabelas de RESGATE;</li>",
      "<li>\"Subscritor\" e \"Titular\" = <b>LOCATÁRIO</b>.</li>",
      "<li>O locatário (a) deve assinar nos campos de Subscritor/Titular e Locatário.</li>",
      "<li>Verificar as informações presentes na proposta. Caso encontre alguma divergência ou informação incorreta, peço que nos sinalize para que possamos providenciar a correção.</li>",
      "</ul>",
      "<p><b><u>" + laranjaNeg("ATENÇÃO!") + "</u></b> ⚠️</p>",
      "<p>É imprescindível o envio do seguintes documentos (digitalizados):</p>",
      "<ul>",
      "<li><b>PROPOSTA</b> devidamente assinada;</li>",
      "<li><b>CONTRATO DE LOCAÇÃO</b> com inserção das " + laranjaNeg("CLÁUSULAS OBRIGATÓRIAS") + " devidamente assinado;</li>",
      "</ul>",
      "<p>Ressaltando nossa total disponibilidade para esclarecer qualquer dúvida.</p>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "cap-resgate-documentos",
    nome: "Capitalização — Resgate antecipado: documentos necessários",
    entidades: CAPITALIZACAO,
    assunto: "Resgate de titulo de capitalização - [NOME DO LOCATÁRIO]",
    corpoHtml: [
      "<p>{{responsavel}}, boa tarde! 🍀☀🌠</p>",
      "<p><b>RESGATE ANTECIPADO [SEGURADORA] 💻</b></p>",
      "<p>Abaixo, documentos necessários para prosseguir:</p>",
      "<ul>",
      "<li><b>CARTA DE EXECUÇÃO (em anexo) - necessário o reconhecimento de firma das assinaturas ou assinatura eletrônica com certificado;</b></li>",
      "<li><b>COMPROVANTE DE ENDEREÇO DA IMOBILIÁRIA (com vencimento não anterior a 90 dias)</b>;</li>",
      "</ul>",
      "<p>As assinaturas utilizadas nos documentos devem estar de acordo com os de identificação.<br><b><u>" + laranjaNeg("*Recebemos os documentos apenas digitalizados, documentos físicos são solicitados em caso de exceção e enviaremos aviso.") + "</u></b></p>",
      "<p><b>ATENÇÃO!<br>ORIENTAÇÕES E INFORMAÇÕES IMPORTANTES:</b></p>",
      "<ul>",
      "<li><b>O resgate será realizado </b>" + laranjaNeg("ANTECIPADAMENTE") + "<b>, conforme solicitado, </b>" + laranjaNeg("havendo penalidade de acordo com as condições gerais do produto.") + "</li>",
      "<li><b>O prazo para retorno de análise da documentação é de 10 DIAS ÚTEIS, podendo gerar pendência ou previsão para pagamento que ocorre em 4 dias úteis em caso de aprovação. No caso de retorno de pendência, a análise volta para a fila de espera e ocorrerá dentro de 10 DIAS ÚTEIS.</b></li>",
      "<li><b>Verificar orientação no rodapé da Carta de Liberação referente ao reconhecimento de assinaturas, caso necessário;</b></li>",
      "<li><b>Todos os documentos são imprescindíveis.</b></li>",
      "</ul>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "cap-resgate-endereco-pendente",
    nome: "Capitalização — Resgate: comprovante de endereço em nome da imobiliária",
    entidades: CAPITALIZACAO,
    assunto: "Resgate de titulo de capitalização - [NOME DO LOCATÁRIO]",
    corpoHtml: [
      "<p>{{responsavel}}, boa tarde!</p>",
      "<p>Obrigada pelo envio, porém o comprovante de endereço precisa estar em nome da imobiliária. Caso não tenha um comprovante em nome da imobiliária, pode ser enviada uma declaração de endereço datada e assinada pelo responsável, seguindo em anexo um modelo aceito pela seguradora.</p>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "cap-resgate-documentos-enviados",
    nome: "Capitalização — Resgate: documentos enviados",
    entidades: CAPITALIZACAO,
    assunto: "Resgate de titulo de capitalização - [NOME DO LOCATÁRIO]",
    corpoHtml: [
      "<p>{{responsavel}}, boa tarde!</p>",
      "<p>Obrigada pelo envio, " + laranjaNeg("Documentos ENVIADOS! 💻") + "</p>",
      "<p>O prazo para retorno de análise da documentação é de <b>10 dias úteis</b>, podendo gerar pendência ou previsão para pagamento que ocorre em 4 dias úteis em caso de aprovação.</p>",
      "<p>No caso de retorno de pendência, a análise volta para a fila de espera e ocorrerá dentro de <b>10 dias úteis</b>.</p>",
      "<p>Caso haja retorno antecipado ao prazo informado, sinalizaremos de imediato. 📆</p>",
      "<p>Estamos à disposição.</p>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "cap-resgate-aprovado",
    nome: "Capitalização — Resgate aprovado",
    entidades: CAPITALIZACAO,
    assunto: "Resgate de titulo de capitalização - [NOME DO LOCATÁRIO]",
    corpoHtml: [
      "<p>{{responsavel}}, boa tarde!</p>",
      "<p>" + laranjaNeg("Resgate APROVADO de [NOME DO LOCATÁRIO]! 😉") + "</p>",
      "<p><b>[Representante do Locador] =&gt; Crédito previsto para ocorrer no dia [DD/MM/AAAA], no valor de R$ [VALOR].</b></p>",
      "<p><b>ATENÇÃO ⚠️</b></p>",
      "<p>Sinalizar caso o pagamento não seja efetuado até às 10:00 do dia seguinte da data prevista. Caso o saldo capitalizado já apresente rendimentos, será aplicada uma retenção de 20% sobre o valor desses rendimentos, para fins de imposto de renda.</p>",
      "<p>Para verificação mais específica referente ao cálculo da Seguradora ou quaisquer dúvidas neste sentido, o titular pode entrar em contato com a <b>[SEGURADORA]</b> pelo canal de atendimento <b>[TELEFONE DA SEGURADORA]</b> ou através da \"Área do Cliente\" no site da seguradora, pois não temos acesso aos cálculos internos e/ou extratos da aplicação.</p>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
  {
    id: "cap-resgate-reaplicado",
    nome: "Capitalização — Título reaplicado: prazo de 30 dias para resgate integral",
    entidades: CAPITALIZACAO,
    assunto: "Resgate de titulo de capitalização - [NOME DO LOCATÁRIO]",
    corpoHtml: [
      "<p>{{responsavel}}, boa tarde!</p>",
      "<p>O título em questão teve o final da vigência em <b>[DD/MM/AAAA]</b>, porém como os documentos para o resgate ainda não foram enviados, o mesmo reaplicou automaticamente.</p>",
      "<p>Mas fique tranquilo, temos o prazo de 30 dias após a reaplicação para enviar os documentos e realizar o resgate do valor integral do título. Então os documentos precisam ser enviados até o dia <b>[DD/MM]</b> para que seja possível seguir com a solicitação de resgate integral, após esse prazo o resgate passa a ser antecipado onde há penalidade no pagamento.</p>",
      "<p>Permanecemos no aguardo dos documento de resgate para seguir com a solicitação, são eles:</p>",
      "<ul>",
      "<li><b>CARTA DE LIBERAÇÃO (em anexo);</b></li>",
      "<li><b>DISTRATO;</b></li>",
      "<li><b>DOCUMENTO DE IDENTIFICAÇÃO DO LOCADOR;</b></li>",
      "<li><b>DOCUMENTO DE IDENTIFICAÇÃO DA LOCATÁRIA;</b></li>",
      "<li><b>COMPROVANTE DE RESIDÊNCIA LOCATÁRIA (com vencimento não anterior a 90 dias);</b></li>",
      "<li><b>COMPROVANTE DA CONTA BANCÁRIA INFORMADA PARA PAGAMENTO;</b></li>",
      "</ul>",
      "<p>Caso a imobiliária realize a assinatura dos documentos representando o Locador, enviar também:</p>",
      "<ul><li>Contrato de Administração;</li></ul>",
      "<p>Atenciosamente,</p>",
    ].join(""),
  },
];
