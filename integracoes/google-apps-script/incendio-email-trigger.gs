// Monitora a caixa de Gmail (instalado numa conta de verdade que RECEBE as
// mensagens do grupo incendio@o2seguros.com.br -- um Grupo do Google não
// tem caixa própria pra instalar script, então isso roda na conta de um
// membro real do grupo) em busca de e-mails de confirmação de
// contratação/apólice emitida/cancelamento, e manda cada um pra Plataforma
// O2 avaliar e cruzar com a planilha de cotação diária do mês.
//
// Duas formas de descobrir e-mail relevante:
// 1. processarEmailsIncendio -- busca por frases prontas ("CONTRATAÇÃO
//    CONFIRMADA" etc.), roda a cada poucos minutos.
// 2. buscarNegociosParados -- pergunta pra Plataforma O2 quais negócios
//    estão parados e sem nenhum e-mail casado ainda, e busca no Gmail por
//    nome do segurado + data (em vez de por frase pronta) -- cobre o caso
//    de uma negociação que só teve troca de e-mail sem ninguém nunca
//    escrever a frase-gatilho (ex: cliente só respondeu "pode seguir com a
//    contratação" e ninguém confirmou depois). Roda 1x por dia (é mais
//    pesado, várias buscas por execução).
//
// Direção igual ao capitalizacao.gs (nesta mesma pasta): um script "solto"
// (não vinculado a nenhuma planilha) que EMPURRA dados pra dentro da
// Plataforma O2 via HTTP.
//
// Configuração (uma vez só):
// 1. script.google.com > Novo projeto. Cole este arquivo inteiro.
// 2. Troque o valor de TOKEN abaixo por um texto secreto (qualquer string
//    longa e aleatória) -- o mesmo texto vai pra variável de ambiente
//    INCENDIO_EMAIL_INTEGRACAO_SECRET no Vercel.
// 3. Rode a função `processarEmailsIncendio` uma vez manualmente (▷ no
//    editor) pra autorizar o script a acessar seu Gmail -- primeira vez
//    sempre pede permissão, precisa ser feito no seu navegador real.
// 4. Editar > Gatilhos do projeto atual > Adicionar gatilho -- duas vezes:
//    a) função `processarEmailsIncendio`, evento "temporizado", "baseado em
//       minutos", a cada 10 minutos (ou o intervalo que preferir).
//    b) função `buscarNegociosParados`, evento "temporizado", "baseado em
//       dias", 1x por dia (horário comercial, ex: 8h-9h).

const TOKEN = "TROQUE-POR-UM-TEXTO-SECRETO-LONGO";
const API_URL = "https://gerador-contratos-o2.vercel.app/api/integracoes/incendio-email";
const API_URL_PENDENTES = API_URL + "/pendentes";
const LABEL_PROCESSADO = "IA-Processado-Incendio";

// Só busca e-mails que pareçam ser confirmação de status -- evita mandar
// TODO e-mail da caixa (cobrança, renovação futura, spam) pra IA sem
// necessidade. O filtro fino de verdade (é ou não é uma confirmação
// relevante, e se é do produto certo) é feito pela IA do lado da
// Plataforma O2. IMPORTANTE: exige incendio@ nos destinatários (to/cc) --
// essa caixa de e-mail também recebe Seguro Fiança e outros produtos que
// não são Ramos Elementares, então sem essa exigência o robô ia processar
// confirmação de coisa que não é da conta dele.
const QUERY =
  '(to:incendio@o2seguros.com.br OR cc:incendio@o2seguros.com.br) ("CONFIRMAÇÃO DE CONTRATAÇÃO" OR "CONTRATAÇÃO CONFIRMADA" OR "APÓLICE EMITIDA" OR "CANCELAMENTO CONFIRMADO" OR "Apólice Digital" OR "Apolice Digital") in:inbox -label:' +
  LABEL_PROCESSADO +
  " newer_than:60d";

function processarEmailsIncendio() {
  const label = GmailApp.getUserLabelByName(LABEL_PROCESSADO) || GmailApp.createLabel(LABEL_PROCESSADO);
  const threads = GmailApp.search(QUERY, 0, 50);
  processarThreads(threads, label);
}

// Pergunta pra Plataforma O2 quais negócios estão em andamento, parados há
// alguns dias e sem nenhum e-mail casado ainda -- pra cada um, busca no
// Gmail por nome do segurado/imobiliária a partir da data conhecida daquele
// negócio (com uma margem de segurança), em vez de depender de uma frase
// pronta aparecer em algum e-mail da thread.
function buscarNegociosParados() {
  const label = GmailApp.getUserLabelByName(LABEL_PROCESSADO) || GmailApp.createLabel(LABEL_PROCESSADO);

  const resposta = UrlFetchApp.fetch(API_URL_PENDENTES, {
    method: "get",
    headers: { "x-o2-integracao-token": TOKEN },
    muteHttpExceptions: true,
  });
  if (resposta.getResponseCode() >= 300) {
    Logger.log("Falha ao buscar negócios parados: " + resposta.getContentText());
    return;
  }

  let dados;
  try {
    dados = JSON.parse(resposta.getContentText());
  } catch (erro) {
    Logger.log("Resposta inválida de " + API_URL_PENDENTES + ": " + erro);
    return;
  }
  const pendentes = dados.pendentes || [];

  pendentes.forEach(function (item) {
    if (!item.dataReferencia) return;
    const nomeBusca = (item.segurado || item.nomePrincipal || "").replace(/"/g, "").trim();
    if (!nomeBusca) return;

    // Margem de 5 dias antes da data conhecida do negócio, pra não perder o
    // início da troca de e-mails caso a data registrada seja de um contato
    // um pouco posterior ao primeiro e-mail da thread.
    const dataAncora = new Date(item.dataReferencia + "T00:00:00");
    dataAncora.setDate(dataAncora.getDate() - 5);
    const dataFormatada = Utilities.formatDate(dataAncora, "America/Sao_Paulo", "yyyy/MM/dd");

    const query =
      '"' +
      nomeBusca +
      '" after:' +
      dataFormatada +
      " (to:incendio@o2seguros.com.br OR cc:incendio@o2seguros.com.br) in:inbox -label:" +
      LABEL_PROCESSADO;

    const threads = GmailApp.search(query, 0, 10);
    processarThreads(threads, label);
  });
}

// Compartilhado pelas duas buscas acima: manda cada mensagem de cada thread
// pra Plataforma O2 e só marca a thread como processada se TODAS as
// mensagens foram aceitas (2xx) -- se alguma falhou (ex: token errado, API
// fora do ar), a thread continua sem a etiqueta e entra de novo na busca do
// próximo disparo, em vez de ficar perdida pra sempre. A rota do lado da
// Plataforma O2 também ignora mensagem repetida (pelo id do Gmail), então
// não tem problema a mesma thread ser encontrada pelas duas buscas.
function processarThreads(threads, label) {
  threads.forEach(function (thread) {
    let todasEnviadasComSucesso = true;

    thread.getMessages().forEach(function (message) {
      try {
        const payload = {
          token: TOKEN,
          messageId: message.getId(),
          threadId: thread.getId(),
          remetente: message.getFrom(),
          assunto: message.getSubject(),
          corpo: message.getPlainBody().slice(0, 8000),
          dataRecebida: message.getDate().toISOString(),
        };
        const resposta = UrlFetchApp.fetch(API_URL, {
          method: "post",
          contentType: "application/json",
          headers: { "x-o2-integracao-token": TOKEN },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
        if (resposta.getResponseCode() >= 300) {
          Logger.log("Falha ao processar mensagem " + message.getId() + ": " + resposta.getContentText());
          todasEnviadasComSucesso = false;
        }
      } catch (erro) {
        Logger.log("Erro ao enviar mensagem " + message.getId() + ": " + erro);
        todasEnviadasComSucesso = false;
      }
    });

    if (todasEnviadasComSucesso) thread.addLabel(label);
  });
}
