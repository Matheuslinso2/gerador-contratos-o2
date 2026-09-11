import { NextRequest, NextResponse } from "next/server";
import { enviarEmail } from "@/lib/email";
import { ccPorEntidade, gerarEnderecoRespostaCard } from "@/lib/bitrix/entidadesCard";
import { registrarAtividadeEmail } from "@/lib/bitrix/atividades";
import { tokenBitrixValido, buscarInfoCardParaEmail } from "@/lib/bitrix/emailNoCard";

export const dynamic = "force-dynamic";

// Recebe o envio da tela de compor e-mail dentro do card (Fase 1, ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md). Pública
// (sem sessão da Plataforma O2 -- roda dentro do iframe do Bitrix), por
// isso PRECISA validar que quem chamou realmente tem um token válido do
// Bitrix pra esse portal antes de mandar e-mail ou escrever no card --
// senão vira relay aberto pra mandar e-mail em nome da O2 pra qualquer
// endereço e gravar atividade falsa em qualquer card.

const O2_NAVY = "#01192e";
const O2_LARANJA = "#F8540D";
const O2_CINZA_CLARO = "#d9d9d9";
const O2_CINZA_MEDIO = "#8d8683";
const FONTE = "'Poppins', Arial, sans-serif";
const LOGO_URL = "https://gerador-contratos-o2.vercel.app/marca-o2/o2-logo-horizontal.png";

// Bloco "sobre este card" -- contexto pra quem recebe uma cópia (CC) ou lê o
// e-mail depois, sem precisar abrir o Bitrix pra saber do que se trata.
// Best-effort: qualquer campo que não vier (empresa/responsável) some da
// lista em vez de mostrar "undefined" ou travar o envio.
function montarBlocoInfoCard(linhas: { rotulo: string; valor: string }[], link: string): string {
  const linhasHtml = linhas
    .filter((l) => l.valor)
    .map(
      (l) => `
      <tr>
        <td style="padding:6px 0;font-size:12px;color:${O2_CINZA_MEDIO};font-family:${FONTE};width:110px;vertical-align:top;">${l.rotulo}</td>
        <td style="padding:6px 0;font-size:13px;color:${O2_NAVY};font-family:${FONTE};font-weight:600;">${l.valor}</td>
      </tr>`
    )
    .join("");
  return `
    <tr>
      <td style="padding:0 28px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f7;border-radius:10px;padding:14px 16px;border-collapse:collapse;">
          ${linhasHtml}
          <tr>
            <td colspan="2" style="padding:10px 0 0;">
              <a href="${link}" style="font-size:12px;color:${O2_LARANJA};font-family:${FONTE};font-weight:700;text-decoration:none;">Abrir card no Bitrix →</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// E-mail de pessoa pra pessoa (colaborador -> cliente), não uma notificação
// estruturada de formulário -- por isso não reaproveita envolverEmailO2
// integralmente (feito pra "card de formulário preenchido", com badge fixo
// de produto + protocolo). Aqui o corpo já vem em HTML (editado na tela de
// composição), então é inserido direto, sem reprocessar quebra de linha.
function montarHtmlEmailCard(params: { corpoHtml: string; badge: string; blocoInfo: string }): string {
  return `
    <div style="background:#f4f4f4;padding:28px 12px;font-family:${FONTE};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${O2_CINZA_CLARO};">
        <tr>
          <td style="padding:24px 28px 8px;" align="center">
            <img src="${LOGO_URL}" alt="O2 Seguros" width="140" style="display:block;" />
          </td>
        </tr>
        <tr>
          <td style="padding:14px 28px 4px;" align="center">
            <span style="display:inline-block;background:${O2_LARANJA};color:#ffffff;font-family:${FONTE};font-weight:700;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;padding:6px 16px;border-radius:999px;">${params.badge}</span>
          </td>
        </tr>
        ${params.blocoInfo}
        <tr>
          <td style="padding:4px 28px 24px;font-size:14px;line-height:1.6;color:${O2_NAVY};font-family:${FONTE};">${params.corpoHtml}</td>
        </tr>
        <tr>
          <td style="padding:0 28px 24px;">
            <hr style="border:none;border-top:1px solid ${O2_CINZA_CLARO};margin:0 0 16px;" />
            <p style="margin:0;font-size:11px;color:${O2_CINZA_MEDIO};font-family:${FONTE};text-align:center;">
              O2 Seguros · <span style="color:${O2_LARANJA};">#SomosTodosO2</span>
            </p>
          </td>
        </tr>
      </table>
    </div>`;
}

// Sanitização leve, não uma lib completa: o corpo já passa por uma tela
// autenticada (token do Bitrix validado antes de chegar aqui) escrita por
// colaborador da O2, não por qualquer visitante da internet -- o risco real
// aqui é conteúdo colado (Word/site) trazendo <script>/handlers por
// acidente, não um ataque deliberado. Mesmo assim, nunca confiar cegamente.
function sanitizarHtmlSimples(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
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

  // Melhor esforço: busca título/empresa/responsável do card pra dar
  // contexto no e-mail (quem recebe em cópia não precisa abrir o Bitrix pra
  // saber do que se trata). Se falhar por qualquer motivo, o e-mail ainda
  // sai -- só sem esse bloco, nunca bloqueia o envio por causa disso.
  const info = await buscarInfoCardParaEmail(entityTypeId, itemId);
  const badge = info?.badge ?? "O2 Seguros";
  const blocoInfo = info
    ? montarBlocoInfoCard(
        [
          { rotulo: "Card", valor: info.tituloCard ? `#${itemId} · ${info.tituloCard}` : `#${itemId}` },
          { rotulo: "Empresa/Imóvel", valor: info.empresa ?? "" },
          { rotulo: "Responsável", valor: info.responsavel ?? "" },
        ],
        info.link
      )
    : "";

  const html = montarHtmlEmailCard({ corpoHtml: sanitizarHtmlSimples(corpo), badge, blocoInfo });

  try {
    await enviarEmail({
      para: para.trim(),
      cc: [cc],
      assunto: assunto.trim(),
      html,
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
      corpo: html,
      direcao: "enviado",
      enderecoEnvolvido: para.trim(),
    });
  } catch (erro) {
    // O e-mail já saiu -- não desfaz o envio por causa disso, só avisa nos
    // logs pra investigar depois (ex: TYPE_ID=4 pode não ser válido nesse
    // portal, ver nota em atividades.ts).
    console.error("E-mail enviado, mas falhou ao registrar atividade no card:", erro);
  }

  return NextResponse.json({ ok: true });
}
