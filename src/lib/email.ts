import nodemailer from "nodemailer";

export type AnexoEmail = { nome: string; conteudo: Buffer; tipo?: string; cid?: string };

// Envia e-mail via Gmail/Google Workspace (SMTP com senha de app). Falha
// silenciosamente (só loga) se não estiver configurado — nunca deve travar
// o cadastro da imobiliária por causa disso. Já quem chama com `throw:
// true` (ex: envio de fatura, onde o usuário precisa saber na hora se
// falhou) recebe o erro de volta pra decidir o que fazer.
export async function enviarEmail({
  para,
  cc,
  assunto,
  html,
  anexos,
  remetente = "Workspace O2",
  throwSeFalhar = false,
}: {
  para: string;
  cc?: string[];
  assunto: string;
  html: string;
  anexos?: AnexoEmail[];
  remetente?: string;
  throwSeFalhar?: boolean;
}) {
  const usuario = process.env.GMAIL_USER;
  const senha = process.env.GMAIL_APP_PASSWORD;

  if (!usuario || !senha) {
    const msg = "Envio de e-mail não configurado: faltam GMAIL_USER/GMAIL_APP_PASSWORD.";
    console.error(msg);
    if (throwSeFalhar) throw new Error(msg);
    return;
  }

  try {
    const transportador = nodemailer.createTransport({
      service: "gmail",
      auth: { user: usuario, pass: senha },
    });

    await transportador.sendMail({
      from: `${remetente} <${usuario}>`,
      to: para,
      cc: cc?.length ? cc : undefined,
      subject: assunto,
      html,
      attachments: anexos?.map((a) => ({
        filename: a.nome,
        content: a.conteudo,
        contentType: a.tipo,
        cid: a.cid,
        contentDisposition: a.cid ? "inline" : "attachment",
      })),
    });
  } catch (erro) {
    console.error("Falha ao enviar e-mail:", erro);
    if (throwSeFalhar) throw erro;
  }
}

// Temporário: enquanto ainda estamos em fase de teste (e o Matheus não tem
// acesso à caixa comercial@ no momento), os alertas vão pro e-mail dele
// direto. Trocar de volta pra comercial@o2seguros.com.br quando encerrar
// os testes.
const EMAIL_ALERTA_ADMIN = "matheus@o2seguros.com.br";

// Notifica a O2 quando algo dá erro de verdade no sistema, pra permitir
// acompanhar sem precisar ficar checando os logs do Vercel. Reusa o mesmo
// SMTP de enviarEmail — se não estiver configurado, só loga (não trava nada).
export async function alertarAdmin({
  contexto,
  detalhe,
  quem,
}: {
  contexto: string;
  detalhe: string;
  quem?: string;
}) {
  await enviarEmail({
    para: EMAIL_ALERTA_ADMIN,
    assunto: `🚨 Erro no sistema${quem ? ` — ${quem}` : ""}`,
    html: `
      <div style="max-width: 560px; margin: 0 auto; font-family: Arial, sans-serif;">
        <div style="background: #00213a; padding: 16px 20px; border-radius: 10px 10px 0 0;">
          <p style="margin: 0; color: #fff; font-size: 16px; font-weight: bold;">⚠️ Erro no Workspace O2</p>
        </div>
        <div style="border: 1px solid #eee; border-top: none; border-radius: 0 0 10px 10px; padding: 20px;">
          ${
            quem
              ? `<div style="background: #fff3f0; border: 1px solid #ff5a3b; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
                  <p style="margin: 0; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Quem foi afetado</p>
                  <p style="margin: 4px 0 0; font-size: 16px; font-weight: bold; color: #ff5a3b;">${quem}</p>
                </div>`
              : ""
          }
          <p style="margin: 0 0 4px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Contexto</p>
          <p style="margin: 0 0 16px; font-size: 14px; color: #00213a;">${contexto}</p>
          <p style="margin: 0 0 4px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Detalhe técnico</p>
          <pre style="white-space: pre-wrap; font-family: monospace; font-size: 12px; background: #f5f5f5; padding: 12px; border-radius: 6px; margin: 0;">${detalhe}</pre>
        </div>
        <p style="text-align: center; color: #aaa; font-size: 11px; margin-top: 12px;">Enviado automaticamente pelo sistema.</p>
      </div>
    `,
  });
}
