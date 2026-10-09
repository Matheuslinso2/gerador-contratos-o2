// Modelos de e-mail prontos para a aba "E-mail" dentro dos cards do Bitrix
// (src/app/bitrix-app/card-email/route.ts). Ao escolher um modelo, o assunto e
// o corpo são preenchidos e a pessoa edita o que precisar antes de enviar.
//
// Placeholders (substituídos no navegador com os dados do card; quando o card
// não tem o dado, vira um trecho entre colchetes pra pessoa completar):
//   {{responsavel}} -> responsável/contato do card
//   {{empresa}}     -> empresa ou imóvel do card
//   {{card}}        -> título do card
//
// O corpo é HTML simples (p, ul/li, b) -- o mesmo que o editor da tela produz.
// Pra incluir um modelo novo, é só acrescentar um item na lista abaixo.

export type ModeloEmail = {
  id: string;
  nome: string;
  assunto: string;
  corpoHtml: string;
};

export const MODELOS_EMAIL: ModeloEmail[] = [
  {
    id: "acompanhamento-proposta",
    nome: "Acompanhamento de proposta",
    assunto: "Acompanhamento da sua proposta — {{empresa}}",
    corpoHtml: [
      "<p>Olá, {{responsavel}}!</p>",
      "<p>Tudo bem? Estou entrando em contato para acompanhar a proposta de <b>{{empresa}}</b> que enviamos.</p>",
      "<p>Ficou alguma dúvida sobre coberturas, valores ou condições? Se preferir, podemos agendar uma conversa rápida para esclarecer tudo e, se estiver de acordo, já avançar com a contratação.</p>",
      "<p>Fico à disposição.</p>",
      "<p>Atenciosamente,<br>Equipe O2 Seguros</p>",
    ].join(""),
  },
  {
    id: "solicitacao-documentos",
    nome: "Solicitação de documentos",
    assunto: "Documentos para dar andamento — {{empresa}}",
    corpoHtml: [
      "<p>Olá, {{responsavel}}!</p>",
      "<p>Para darmos andamento ao processo de <b>{{empresa}}</b>, precisamos dos documentos abaixo:</p>",
      "<ul><li>[documento 1]</li><li>[documento 2]</li><li>[documento 3]</li></ul>",
      "<p>Pode responder este e-mail anexando os arquivos (PDF ou foto legível). Assim que recebermos, seguimos com a análise.</p>",
      "<p>Qualquer dúvida, é só chamar.</p>",
      "<p>Atenciosamente,<br>Equipe O2 Seguros</p>",
    ].join(""),
  },
  {
    id: "contratacao-concluida",
    nome: "Contratação concluída / envio de apólice",
    assunto: "Contratação concluída — {{empresa}}",
    corpoHtml: [
      "<p>Olá, {{responsavel}}!</p>",
      "<p>Temos uma ótima notícia: a contratação de <b>{{empresa}}</b> foi concluída com sucesso.</p>",
      "<p>Estamos enviando em anexo os documentos da contratação. Recomendamos conferir os dados e guardar o arquivo. Se encontrar qualquer divergência, avise-nos para corrigirmos o quanto antes.</p>",
      "<p>Obrigado pela confiança! Seguimos à disposição para o que precisar.</p>",
      "<p>Atenciosamente,<br>Equipe O2 Seguros</p>",
    ].join(""),
  },
  {
    id: "renovacao-a-vencer",
    nome: "Renovação a vencer",
    assunto: "Renovação do seu seguro — {{empresa}}",
    corpoHtml: [
      "<p>Olá, {{responsavel}}!</p>",
      "<p>A vigência do seguro de <b>{{empresa}}</b> está chegando ao fim e já estamos cuidando da renovação para que não haja interrupção na cobertura.</p>",
      "<p>Se houve alguma mudança (valores, endereços, inclusões ou exclusões), nos informe até <b>[data]</b> para que a renovação já saia atualizada.</p>",
      "<p>Atenciosamente,<br>Equipe O2 Seguros</p>",
    ].join(""),
  },
];
