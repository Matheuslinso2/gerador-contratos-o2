// Monitora a caixa de Gmail (instalado numa conta de verdade que RECEBE as
// mensagens do grupo incendio@o2seguros.com.br -- um Grupo do Google não
// tem caixa própria pra instalar script, então isso roda na conta de um
// membro real do grupo) em busca de e-mails de confirmação de
// contratação/apólice emitida/cancelamento, e manda cada um pra Plataforma
// O2 avaliar e cruzar com a planilha de cotação diária do mês.
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
// 4. Editar > Gatilhos do projeto atual > Adicionar gatilho: função
//    `processarEmailsIncendio`, evento "temporizado", "baseado em minutos",
//    a cada 10 minutos (ou o intervalo que preferir).

const TOKEN = "TROQUE-POR-UM-TEXTO-SECRETO-LONGO";
const API_URL = "https://gerador-contratos-o2.vercel.app/api/integracoes/incendio-email";
const LABEL_PROCESSADO = "IA-Processado-Incendio";

// Só busca e-mails que pareçam ser confirmação de status -- evita mandar
// TODO e-mail da caixa (cobrança, renovação futura, spam) pra IA sem
// necessidade. O filtro fino de verdade (é ou não é uma confirmação
// relevante) é feito pela IA do lado da Plataforma O2.
const QUERY =
  '("CONFIRMAÇÃO DE CONTRATAÇÃO" OR "CONTRATAÇÃO CONFIRMADA" OR "APÓLICE EMITIDA" OR "CANCELAMENTO CONFIRMADO" OR "Apólice Digital" OR "Apolice Digital") in:inbox -label:' +
  LABEL_PROCESSADO +
  " newer_than:60d";

function processarEmailsIncendio() {
  const label = GmailApp.getUserLabelByName(LABEL_PROCESSADO) || GmailApp.createLabel(LABEL_PROCESSADO);
  const threads = GmailApp.search(QUERY, 0, 50);

  threads.forEach(function (thread) {
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
        }
      } catch (erro) {
        Logger.log("Erro ao enviar mensagem " + message.getId() + ": " + erro);
      }
    });
    // Marca a thread inteira como processada só depois de tentar mandar
    // todas as mensagens -- evita reprocessar a thread inteira de novo no
    // próximo disparo (a Plataforma O2 também ignora mensagem repetida,
    // esse label é só uma otimização pra não reler a mesma thread sempre).
    thread.addLabel(label);
  });
}
