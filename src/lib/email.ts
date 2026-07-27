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
