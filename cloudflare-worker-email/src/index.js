import PostalMime from "postal-mime";

// Fase 2 do "E-mail no Card" -- ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md.
// Cloudflare Email Routing entrega aqui todo e-mail recebido em
// *@notificacoes.o2seguros.com.br (regra configurada no dashboard, não
// neste arquivo). Este Worker só extrai remetente/assunto/corpo e repassa
// pro webhook da Plataforma O2, que decide o que fazer.
export default {
  async email(message, env, ctx) {
    // message.to é o endereço de ENVELOPE (pra quem o e-mail foi
    // efetivamente entregue) -- mais confiável que o cabeçalho "To" parseado
    // do MIME, que pode ter nome de exibição ou múltiplos destinatários.
    const para = message.to;

    const email = await PostalMime.parse(message.raw);

    const payload = {
      messageId: email.messageId || `sem-message-id-${Date.now()}-${Math.random()}`,
      para,
      remetente: email.from?.address || message.from,
      assunto: email.subject || "(sem assunto)",
      texto: email.text || "",
    };

    const resposta = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-o2-integracao-token": env.BITRIX_EMAIL_RESPOSTA_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!resposta.ok) {
      // Loga mas não rejeita o e-mail -- rejeitar (message.setReject) faz o
      // remetente receber bounce, o que é pior do que só perder o registro
      // no card. O log fica visível em `wrangler tail`.
      console.error("Webhook da Plataforma O2 respondeu com erro:", resposta.status, await resposta.text());
    }
  },
};
