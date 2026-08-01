import nodemailer from "nodemailer";

// Envia e-mail via Gmail/Google Workspace (SMTP com senha de app). Falha
// silenciosamente (só loga) se não estiver configurado ou se o envio der
// errado — nunca deve travar o cadastro da imobiliária por causa disso.
export async function enviarEmail({
  para,
  assunto,
  html,
}: {
  para: string;
  assunto: string;
  html: string;
}) {
  const usuario = process.env.GMAIL_USER;
  const senha = process.env.GMAIL_APP_PASSWORD;

  if (!usuario || !senha) {
    console.error("Envio de e-mail não configurado: faltam GMAIL_USER/GMAIL_APP_PASSWORD.");
    return;
  }

  try {
    const transportador = nodemailer.createTransport({
      service: "gmail",
      auth: { user: usuario, pass: senha },
    });

    await transportador.sendMail({
      from: `Gerador de Contratos O2 <${usuario}>`,
      to: para,
      subject: assunto,
      html,
    });
  } catch (erro) {
    console.error("Falha ao enviar e-mail:", erro);
  }
}

const EMAIL_ALERTA_ADMIN = "matheus@o2seguros.com.br";

// Notifica a O2 quando algo dá erro de verdade no sistema, pra permitir
// acompanhar sem precisar ficar checando os logs do Vercel. Reusa o mesmo
// SMTP de enviarEmail — se não estiver configurado, só loga (não trava nada).
export async function alertarAdmin({
  contexto,
  detalhe,
}: {
  contexto: string;
  detalhe: string;
}) {
  await enviarEmail({
    para: EMAIL_ALERTA_ADMIN,
    assunto: `[Gerador de Contratos] Erro: ${contexto}`,
    html: `
      <p><strong>Contexto:</strong> ${contexto}</p>
      <p><strong>Detalhe:</strong></p>
      <pre style="white-space: pre-wrap; font-family: monospace; font-size: 13px; background: #f5f5f5; padding: 12px; border-radius: 6px;">${detalhe}</pre>
      <p style="color: #888; font-size: 12px;">Enviado automaticamente pelo sistema.</p>
    `,
  });
}
