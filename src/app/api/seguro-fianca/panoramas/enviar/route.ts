import { NextRequest, NextResponse } from "next/server";
import { autorizarPanorama } from "@/lib/panoramaAutorizacao";
import { enviarEmail } from "@/lib/email";
import { ENTITY_TYPE_ID_SEGURO_FIANCA, gerarEnderecoRespostaCard } from "@/lib/bitrix/entidadesCard";
import { registrarAtividadeEmail } from "@/lib/bitrix/atividades";
import {
  EMAIL_FIANCA,
  montarHtmlEmailPanorama,
  type BiometriaSeguradora,
  type StatusEmail,
} from "@/lib/panoramaFiancaEmail";
import type { CabecalhoPanorama } from "@/lib/panoramaFiancaConstantes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Envio do Panorama de Preços por e-mail (Fase 2, 16/10/2026). Mesmo
// mecanismo do "E-mail no card" (bitrix-app/enviar-email): Resend + atividade
// de e-mail no card do Bitrix (credencial do app, sem webhook de escrita) +
// resposta indo pro endereço do card. Diferença: aqui quem chama é o
// colaborador logado no Workspace (sessão Supabase), não o iframe do Bitrix.
// Route handler (não server action) porque a imagem + PDF passam de 1 MB.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITE_DESTINATARIOS = 15;

type Corpo = {
  cardId?: number;
  versao?: number;
  para?: string[];
  cc?: string[];
  assunto?: string;
  status?: StatusEmail;
  validade?: string;
  biometrias?: BiometriaSeguradora[];
  observacoes?: string;
  pngBase64?: string;
  pdfBase64?: string;
  passeBitrix?: string;
};

function limparLista(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
}

export async function POST(request: NextRequest) {
  let corpo: Corpo;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Requisição inválida." }, { status: 400 });
  }

  // Sessão do Workspace OU passe da aba "Panorama" no card do Bitrix.
  const autor = await autorizarPanorama(Number(corpo.cardId), corpo.passeBitrix);
  if (!autor) return NextResponse.json({ ok: false, erro: "Sem permissão." }, { status: 403 });
  const supabase = autor.db;

  const { cardId, versao, assunto, status, validade, observacoes = "", pngBase64, pdfBase64 } = corpo;
  const para = limparLista(corpo.para);
  const cc = limparLista([...(corpo.cc ?? []), EMAIL_FIANCA]).filter((e) => !para.includes(e));
  const biometrias = (corpo.biometrias ?? []).filter((b) => b && typeof b.seguradora === "string");

  if (!cardId || !versao || !pngBase64 || !pdfBase64) {
    return NextResponse.json({ ok: false, erro: "Dados do panorama incompletos." }, { status: 400 });
  }
  if (!para.length) return NextResponse.json({ ok: false, erro: "Escolha pelo menos um destinatário." }, { status: 400 });
  const invalidos = [...para, ...cc].filter((e) => !EMAIL_REGEX.test(e));
  if (invalidos.length) {
    return NextResponse.json({ ok: false, erro: `E-mail inválido: ${invalidos.join(", ")}` }, { status: 400 });
  }
  if (para.length + cc.length > LIMITE_DESTINATARIOS) {
    return NextResponse.json({ ok: false, erro: `Máximo de ${LIMITE_DESTINATARIOS} destinatários.` }, { status: 400 });
  }
  if (!assunto?.trim()) return NextResponse.json({ ok: false, erro: "Preencha o assunto." }, { status: 400 });
  if (!validade?.trim()) return NextResponse.json({ ok: false, erro: "Preencha a validade das cartas." }, { status: 400 });
  if (status !== "APROVADO" && status !== "PRÉ-APROVADO") {
    return NextResponse.json({ ok: false, erro: "Status inválido." }, { status: 400 });
  }

  // A versão tem que existir -- o e-mail sempre sai de um panorama salvo
  // (base do controle de envio).
  const { data: panorama } = await supabase
    .from("panoramas_fianca")
    .select("id, cabecalho")
    .eq("card_id", cardId)
    .eq("versao", versao)
    .maybeSingle();
  if (!panorama) return NextResponse.json({ ok: false, erro: `Versão ${versao} do card ${cardId} não encontrada.` }, { status: 404 });
  const inquilino = (panorama.cabecalho as CabecalhoPanorama).inquilino;

  const html = montarHtmlEmailPanorama({
    inquilino,
    status,
    validade: validade.trim(),
    imagemSrc: "cid:panorama",
    biometrias,
    observacoes,
  });

  const nomeBase = `panorama-fianca-${cardId}-v${versao}`;
  let resendId: string | null = null;
  try {
    const r = await enviarEmail({
      para,
      cc,
      assunto: assunto.trim(),
      html,
      anexos: [
        { nome: `${nomeBase}.png`, conteudo: Buffer.from(pngBase64, "base64"), tipo: "image/png", cid: "panorama" },
        { nome: `${nomeBase}.pdf`, conteudo: Buffer.from(pdfBase64, "base64"), tipo: "application/pdf" },
      ],
      replyTo: gerarEnderecoRespostaCard(ENTITY_TYPE_ID_SEGURO_FIANCA, cardId),
      remetente: "O2 Seguros",
      throwSeFalhar: true,
    });
    resendId = r.id;
  } catch (erro) {
    console.error("Falha ao enviar panorama por e-mail:", erro);
    return NextResponse.json({ ok: false, erro: "Falha ao enviar o e-mail. Tente de novo em instantes." }, { status: 502 });
  }

  // E-mail já saiu -- daqui pra baixo nada desfaz o envio, só registra.
  let registradoNoCard = false;
  try {
    await registrarAtividadeEmail({
      entityTypeId: ENTITY_TYPE_ID_SEGURO_FIANCA,
      itemId: cardId,
      assunto: assunto.trim(),
      // A imagem inline (cid) não abre dentro do Bitrix -- troca por aviso.
      corpo: html.replace(/<img [^>]*src="cid:panorama"[^>]*\/>/, `<b>[Panorama v${versao} anexo ao e-mail]</b>`),
      direcao: "enviado",
      enderecoEnvolvido: para[0],
    });
    registradoNoCard = true;
  } catch (erro) {
    console.error("Panorama enviado, mas falhou ao registrar no card:", erro);
  }

  const { error: erroRegistro } = await supabase.from("panoramas_fianca_envios").insert({
    panorama_id: panorama.id,
    card_id: cardId,
    versao,
    canal: "email",
    para,
    cc,
    assunto: assunto.trim(),
    enviado_por_email: autor.email,
    registrado_no_card: registradoNoCard,
    resend_id: resendId,
  });
  if (erroRegistro) console.error("Panorama enviado, mas falhou ao salvar o registro do envio:", erroRegistro);

  return NextResponse.json({ ok: true, registradoNoCard });
}
