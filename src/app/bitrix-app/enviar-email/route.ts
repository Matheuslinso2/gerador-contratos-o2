import { NextRequest, NextResponse } from "next/server";
import { enviarEmail } from "@/lib/email";
import { ccPorEntidade, gerarEnderecoRespostaCard } from "@/lib/bitrix/entidadesCard";
import { registrarAtividadeEmail } from "@/lib/bitrix/atividades";

export const dynamic = "force-dynamic";

// Recebe o envio da tela de compor e-mail dentro do card (Fase 1, ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md). Pública
// (sem sessão da Plataforma O2 -- roda dentro do iframe do Bitrix), por
// isso PRECISA validar que quem chamou realmente tem um token válido do
// Bitrix pra esse portal antes de mandar e-mail ou escrever no card --
// senão vira relay aberto pra mandar e-mail em nome da O2 pra qualquer
// endereço e gravar atividade falsa em qualquer card.
const DOMINIO_PORTAL = "o2seguros.bitrix24.com.br";

async function tokenBitrixValido(authId: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://${DOMINIO_PORTAL}/rest/profile.json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: authId }),
      signal: AbortSignal.timeout(10_000),
    });
    const dados = await resp.json();
    return resp.ok && !dados.error && Boolean(dados.result);
  } catch {
    return false;
  }
}

const O2_NAVY = "#01192e";
const O2_LARANJA = "#F8540D";
const FONTE = "'Poppins', Arial, sans-serif";
const LOGO_URL = "https://gerador-contratos-o2.vercel.app/marca-o2/o2-logo-horizontal.png";

// E-mail de pessoa pra pessoa (colaborador -> cliente), não uma
// notificação estruturada -- por isso não reaproveita envolverEmailO2
// (feito pra "card de formulário preenchido", com badge/protocolo). Só a
// identidade visual (logo, cores, fonte) é compartilhada.
function montarHtmlEmailCard(corpo: string): string {
  const paragrafos = corpo
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${O2_NAVY};font-family:${FONTE};white-space:pre-line;">${p}</p>`)
    .join("");
  return `
    <div style="background:#f4f4f4;padding:28px 12px;font-family:${FONTE};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d9d9d9;">
        <tr>
          <td style="padding:24px 28px 8px;" align="center">
            <img src="${LOGO_URL}" alt="O2 Seguros" width="140" style="display:block;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 28px;">${paragrafos}</td>
        </tr>
        <tr>
          <td style="padding:0 28px 24px;">
            <hr style="border:none;border-top:1px solid #d9d9d9;margin:0 0 16px;" />
            <p style="margin:0;font-size:11px;color:#8d8683;font-family:${FONTE};text-align:center;">
              O2 Seguros · <span style="color:${O2_LARANJA};">#SomosTodosO2</span>
            </p>
          </td>
        </tr>
      </table>
    </div>`;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: {
    authId?: string;
    entityTypeId?: number;
    itemId?: number;
    para?: string;
    assunto?: string;
    corpo?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { authId, entityTypeId, itemId, para, assunto, corpo } = body;

  if (!authId || !(await tokenBitrixValido(authId))) {
    return NextResponse.json({ ok: false, erro: "Sessão do Bitrix inválida ou expirada. Recarregue a aba e tente de novo." }, { status: 401 });
  }

  if (!entityTypeId || !itemId || !para || !assunto?.trim() || !corpo?.trim()) {
    return NextResponse.json({ ok: false, erro: "Preencha destinatário, assunto e mensagem." }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(para.trim())) {
    return NextResponse.json({ ok: false, erro: "E-mail de destino inválido." }, { status: 400 });
  }

  const cc = ccPorEntidade(entityTypeId);
  const replyTo = gerarEnderecoRespostaCard(entityTypeId, itemId);

  try {
    await enviarEmail({
      para: para.trim(),
      cc: [cc],
      assunto: assunto.trim(),
      html: montarHtmlEmailCard(corpo.trim()),
      replyTo,
      remetente: "O2 Seguros",
      throwSeFalhar: true,
    });
  } catch (erro) {
    console.error("Falha ao enviar e-mail pelo card:", erro);
    return NextResponse.json({ ok: false, erro: "Falha ao enviar o e-mail. Tente de novo em instantes." }, { status: 502 });
  }

  try {
    await registrarAtividadeEmail({
      entityTypeId,
      itemId,
      assunto: assunto.trim(),
      corpo: montarHtmlEmailCard(corpo.trim()),
      direcao: "enviado",
    });
  } catch (erro) {
    // O e-mail já saiu -- não desfaz o envio por causa disso, só avisa nos
    // logs pra investigar depois (ex: TYPE_ID=4 pode não ser válido nesse
    // portal, ver nota em atividades.ts).
    console.error("E-mail enviado, mas falhou ao registrar atividade no card:", erro);
  }

  return NextResponse.json({ ok: true });
}
