import { NextRequest, NextResponse } from "next/server";
import { enviarEmail, type AnexoEmail } from "@/lib/email";
import { ccPorEntidade, gerarEnderecoRespostaCard } from "@/lib/bitrix/entidadesCard";
import { registrarAtividadeEmail } from "@/lib/bitrix/atividades";
import { tokenBitrixValido, BUCKET_ANEXOS } from "@/lib/bitrix/emailNoCard";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// Recebe o envio da tela de compor e-mail dentro do card (Fase 1, ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md). Pública
// (sem sessão da Plataforma O2 -- roda dentro do iframe do Bitrix), por
// isso PRECISA validar que quem chamou realmente tem um token válido do
// Bitrix pra esse portal antes de mandar e-mail ou escrever no card --
// senão vira relay aberto pra mandar e-mail em nome da O2 pra qualquer
// endereço e gravar atividade falsa em qualquer card.

// Mesmo texto do AVISO LEGAL que a equipe já usa na assinatura dos e-mails
// do Gmail. Vai sempre no final, fora do corpo editável, pra não depender
// de a pessoa lembrar de colar e não duplicar quando ela edita a mensagem.
const AVISO_LEGAL =
  "Esta mensagem é destinada exclusivamente para a(s) pessoa(s) a quem é dirigida, podendo conter informação confidencial e/ou legalmente privilegiada. Se você não for o destinatário desta mensagem, desde já fica notificado de abster-se a divulgar, copiar, distribuir, examinar ou, de qualquer forma, utilizar a informação contida nesta mensagem, por ser ilegal. Caso você tenha recebido esta mensagem por engano, pedimos que nos retorne este E-Mail, promovendo, desde logo, a eliminação do seu conteúdo em sua base de dados, registros ou sistema de controle.";

// Mesma aparência dos e-mails que a equipe de Fiança já manda pelo Gmail
// (pedido do Matheus, 09/10/2026): sem logo, selo, caixa de dados do card
// nem moldura -- só Verdana pequena em azul-escuro (#073763), com os
// destaques em laranja que cada pessoa aplica no próprio texto, e o AVISO
// LEGAL em itálico no final. O corpo já vem em HTML (editado na tela de
// composição), então é inserido direto, sem reprocessar quebra de linha.
function montarHtmlEmailCard(params: { corpoHtml: string }): string {
  return `
    <div style="font-family:verdana,sans-serif;font-size:small;line-height:1.5;color:#073763;">
      ${params.corpoHtml}
      <br />
      <div style="font-family:verdana,sans-serif;font-size:small;color:#073763;"><i><b>AVISO LEGAL</b> ${AVISO_LEGAL}</i></div>
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
    anexos?: { caminho: string; nome: string }[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { authId, entityTypeId, itemId, para, assunto, corpo, anexos: anexosRecebidos } = body;

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

  const html = montarHtmlEmailCard({ corpoHtml: sanitizarHtmlSimples(corpo) });

  // Anexos sobem direto pro Storage a partir do navegador (ver
  // anexo-upload-url/route.ts) -- aqui só baixamos de volta (chamada de
  // servidor pro Storage, não passa pelo limite de 4,5MB do Vercel) pra
  // montar o e-mail de verdade. Uma falha aqui bloqueia o envio: o colaborador escolheu
  // esse anexo de propósito, mandar sem ele silenciosamente seria enganoso.
  const caminhosAnexos: string[] = [];
  let anexos: AnexoEmail[] | undefined;
  if (anexosRecebidos?.length) {
    const supabase = createServiceClient();
    anexos = [];
    for (const anexo of anexosRecebidos) {
      const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).download(anexo.caminho);
      if (error || !data) {
        console.error("Falha ao baixar anexo do Storage pro envio:", anexo.caminho, error);
        return NextResponse.json({ ok: false, erro: `Falha ao processar o anexo "${anexo.nome}". Tente anexar de novo.` }, { status: 502 });
      }
      anexos.push({ nome: anexo.nome, conteudo: Buffer.from(await data.arrayBuffer()), tipo: data.type || undefined });
      caminhosAnexos.push(anexo.caminho);
    }
  }

  try {
    await enviarEmail({
      para: para.trim(),
      cc: [cc],
      assunto: assunto.trim(),
      html,
      anexos,
      replyTo,
      remetente: "O2 Seguros",
      throwSeFalhar: true,
    });
  } catch (erro) {
    console.error("Falha ao enviar e-mail pelo card:", erro);
    return NextResponse.json({ ok: false, erro: "Falha ao enviar o e-mail. Tente de novo em instantes." }, { status: 502 });
  }

  // Arquivo temporário só existia pra sustentar este envio -- limpeza
  // best-effort (aguarda terminar antes da função serverless encerrar, mas
  // não afeta a resposta se falhar: o e-mail já saiu de qualquer forma, e
  // um arquivo órfão no Storage não é crítico o bastante pra travar a
  // resposta de sucesso por causa disso).
  if (caminhosAnexos.length) {
    try {
      await createServiceClient().storage.from(BUCKET_ANEXOS).remove(caminhosAnexos);
    } catch (erro) {
      console.warn("Falha ao limpar anexo temporário do Storage:", erro);
    }
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
