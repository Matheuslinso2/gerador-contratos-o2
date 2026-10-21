import { NextRequest, NextResponse } from "next/server";
import { autorizarPanorama } from "@/lib/panoramaAutorizacao";
import { enviarEmail, type AnexoEmail } from "@/lib/email";
import { ENTITY_TYPE_ID_SEGURO_FIANCA, gerarEnderecoRespostaCard } from "@/lib/bitrix/entidadesCard";
import { registrarAtividadeEmail } from "@/lib/bitrix/atividades";
import { BUCKET_ANEXOS } from "@/lib/bitrix/emailNoCard";
import { nomeExibidoRemetente } from "@/lib/campanhas/remetente";
import { buscarCardPanorama } from "@/lib/bitrix/panoramaFianca";
import { createServiceClient } from "@/lib/supabase/service";
import {
  EMAIL_FIANCA,
  montarHtmlEmailPanorama,
  montarHtmlEmailPendencias,
  montarHtmlEmailRecusa,
  seguradorasRecusadas,
  type BiometriaSeguradora,
  type StatusEmail,
  type TipoEmail,
} from "@/lib/panoramaFiancaEmail";
import type { CabecalhoPanorama } from "@/lib/panoramaFiancaConstantes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Envio por e-mail a partir do Panorama de Preços (16/10/2026). Mesmo
// mecanismo do "E-mail no card" (bitrix-app/enviar-email): Resend + atividade
// de e-mail no card do Bitrix (credencial do app, sem webhook de escrita) +
// resposta indo pro endereço do card. Quem chama: colaborador logado no
// Workspace OU a aba "Panorama" no card do Bitrix (passe HMAC).
// Três tipos (mesmos textos dos modelos do E-mail no card):
//  - aprovado: panorama no corpo + PDF anexo (+ cartas de recusa das demais)
//  - recusado: texto padrão com sugestão de Capitalização + cartas
//  - pendencias: documentos pedidos + carta de pendência + cartas de recusa
// Cartas sobem do navegador direto pro Storage (prepararUploadCarta em
// actions.ts) -- aqui só baixamos de volta, por isso não batem no limite
// de 4,5 MB do corpo da requisição.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITE_DESTINATARIOS = 15;
const LIMITE_CARTAS = 10;

type Corpo = {
  tipo?: TipoEmail;
  cardId?: number;
  para?: string[];
  cc?: string[];
  assunto?: string;
  observacoes?: string;
  cartas?: { caminho: string; nome: string }[];
  // Outros arquivos (qualquer tipo) que a equipe queira mandar junto, além
  // das cartas -- não mudam o texto do e-mail (21/10/2026).
  anexosExtras?: { caminho: string; nome: string }[];
  // Nome da pessoa que aparece na caixa de entrada ("Nome | O2 Seguros").
  remetenteNome?: string;
  passeBitrix?: string;
  // aprovado
  versao?: number;
  status?: StatusEmail;
  validade?: string;
  biometrias?: BiometriaSeguradora[];
  pngBase64?: string;
  pdfBase64?: string;
  // recusado
  contatoSeguradora?: string;
  telefoneSeguradora?: string;
  // pendencias
  seguradoraPendente?: string;
  documentos?: string;
};

function limparLista(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
}

const erro = (texto: string, status = 400) => NextResponse.json({ ok: false, erro: texto }, { status });

export async function POST(request: NextRequest) {
  let corpo: Corpo;
  try {
    corpo = await request.json();
  } catch {
    return erro("Requisição inválida.");
  }

  const cardId = Number(corpo.cardId);
  const autor = await autorizarPanorama(cardId, corpo.passeBitrix);
  if (!autor) return erro("Sem permissão.", 403);
  const supabase = autor.db;

  const tipo: TipoEmail = corpo.tipo ?? "aprovado";
  if (!["aprovado", "recusado", "pendencias"].includes(tipo)) return erro("Tipo de e-mail inválido.");
  const { assunto, observacoes = "" } = corpo;
  const para = limparLista(corpo.para);
  const cc = limparLista([...(corpo.cc ?? []), EMAIL_FIANCA]).filter((e) => !para.includes(e));

  if (!para.length) return erro("Escolha pelo menos um destinatário.");
  const invalidos = [...para, ...cc].filter((e) => !EMAIL_REGEX.test(e));
  if (invalidos.length) return erro(`E-mail inválido: ${invalidos.join(", ")}`);
  if (para.length + cc.length > LIMITE_DESTINATARIOS) return erro(`Máximo de ${LIMITE_DESTINATARIOS} destinatários.`);
  if (!assunto?.trim()) return erro("Preencha o assunto.");

  // Cartas: só aceita arquivos subidos pra pasta DESTE card.
  const cartas = (corpo.cartas ?? []).slice(0, LIMITE_CARTAS);
  if (cartas.some((c) => !c?.caminho?.startsWith(`${ENTITY_TYPE_ID_SEGURO_FIANCA}-${cardId}/`))) return erro("Anexo inválido.");
  if (tipo !== "aprovado" && !cartas.length) return erro("Anexe as cartas das seguradoras.");
  const anexosExtras = (corpo.anexosExtras ?? []).slice(0, LIMITE_CARTAS);
  if (anexosExtras.some((c) => !c?.caminho?.startsWith(`${ENTITY_TYPE_ID_SEGURO_FIANCA}-${cardId}/`))) return erro("Anexo inválido.");

  let html: string;
  let anexos: AnexoEmail[] = [];
  let panoramaId: string | null = null;
  let versao: number | null = null;

  // Status das seguradoras sempre lidos do Bitrix agora (não da tela).
  let card;
  try {
    card = await buscarCardPanorama(cardId);
  } catch (e) {
    return erro(`Não consegui ler o card no Bitrix: ${(e as Error).message}`, 502);
  }
  const recusadas = seguradorasRecusadas(card.linhas);

  if (tipo === "aprovado") {
    const { status, validade, pngBase64, pdfBase64 } = corpo;
    versao = Number(corpo.versao) || null;
    if (!versao || !pngBase64 || !pdfBase64) return erro("Dados do panorama incompletos.");
    if (!validade?.trim()) return erro("Preencha a validade das cartas.");
    if (status !== "APROVADO" && status !== "PRÉ-APROVADO") return erro("Status inválido.");
    // A versão tem que existir -- o e-mail aprovado sempre sai de um
    // panorama salvo (base do controle de envio).
    const { data: panorama } = await supabase
      .from("panoramas_fianca")
      .select("id, cabecalho")
      .eq("card_id", cardId)
      .eq("versao", versao)
      .maybeSingle();
    if (!panorama) return erro(`Versão ${versao} do card ${cardId} não encontrada.`, 404);
    panoramaId = panorama.id;
    html = montarHtmlEmailPanorama({
      inquilino: (panorama.cabecalho as CabecalhoPanorama).inquilino,
      status,
      validade: validade.trim(),
      imagemSrc: "cid:panorama",
      biometrias: (corpo.biometrias ?? []).filter((b) => b && typeof b.seguradora === "string"),
      observacoes,
      recusadasComCarta: cartas.length ? recusadas : [],
    });
    const nomeBase = `panorama-fianca-${cardId}-v${versao}`;
    anexos = [
      { nome: `${nomeBase}.png`, conteudo: Buffer.from(pngBase64, "base64"), tipo: "image/png", cid: "panorama" },
      { nome: `${nomeBase}.pdf`, conteudo: Buffer.from(pdfBase64, "base64"), tipo: "application/pdf" },
    ];
  } else if (tipo === "recusado") {
    html = montarHtmlEmailRecusa({
      inquilino: card.cabecalho.inquilino,
      contatoSeguradora: corpo.contatoSeguradora ?? "",
      telefoneSeguradora: corpo.telefoneSeguradora ?? "",
      observacoes,
    });
  } else {
    if (!corpo.documentos?.trim()) return erro("Liste os documentos pedidos pela seguradora.");
    html = montarHtmlEmailPendencias({
      inquilino: card.cabecalho.inquilino,
      seguradoraPendente: corpo.seguradoraPendente ?? "",
      documentos: corpo.documentos,
      recusadas,
      observacoes,
    });
  }

  // Cartas: baixa do Storage (servidor, sem limite de corpo).
  const storage = createServiceClient().storage.from(BUCKET_ANEXOS);
  for (const carta of cartas) {
    const { data, error } = await storage.download(carta.caminho);
    if (error || !data) {
      console.error("Falha ao baixar carta do Storage:", carta.caminho, error);
      return erro(`Falha ao processar a carta "${carta.nome}". Anexe de novo.`, 502);
    }
    anexos.push({ nome: carta.nome, conteudo: Buffer.from(await data.arrayBuffer()), tipo: data.type || "application/pdf" });
  }

  for (const extra of anexosExtras) {
    const { data, error } = await storage.download(extra.caminho);
    if (error || !data) {
      console.error("Falha ao baixar anexo do Storage:", extra.caminho, error);
      return erro(`Falha ao processar o anexo "${extra.nome}". Anexe de novo.`, 502);
    }
    anexos.push({ nome: extra.nome, conteudo: Buffer.from(await data.arrayBuffer()), tipo: data.type || "application/octet-stream" });
  }
  const todosAnexosDoStorage = [...cartas, ...anexosExtras];

  let resendId: string | null = null;
  try {
    const r = await enviarEmail({
      para,
      cc,
      assunto: assunto.trim(),
      html,
      anexos,
      replyTo: gerarEnderecoRespostaCard(ENTITY_TYPE_ID_SEGURO_FIANCA, cardId),
      remetente: nomeExibidoRemetente(corpo.remetenteNome),
      throwSeFalhar: true,
    });
    resendId = r.id;
  } catch (e) {
    console.error("Falha ao enviar e-mail do panorama:", e);
    return erro("Falha ao enviar o e-mail. Tente de novo em instantes.", 502);
  }

  // E-mail já saiu -- daqui pra baixo nada desfaz o envio, só registra/limpa.
  if (todosAnexosDoStorage.length) {
    try {
      await storage.remove(todosAnexosDoStorage.map((c) => c.caminho));
    } catch (e) {
      console.warn("Falha ao limpar cartas temporárias do Storage:", e);
    }
  }

  let registradoNoCard = false;
  try {
    await registrarAtividadeEmail({
      entityTypeId: ENTITY_TYPE_ID_SEGURO_FIANCA,
      itemId: cardId,
      assunto: assunto.trim(),
      // A imagem inline (cid) não abre dentro do Bitrix -- troca por aviso.
      corpo:
        html.replace(/<img [^>]*src="cid:panorama"[^>]*\/>/, `<b>[Panorama v${versao} anexo ao e-mail]</b>`) +
        (todosAnexosDoStorage.length ? `<p><i>Anexos: ${todosAnexosDoStorage.map((c) => c.nome).join(", ")}</i></p>` : ""),
      direcao: "enviado",
      enderecoEnvolvido: para[0],
    });
    registradoNoCard = true;
  } catch (e) {
    console.error("E-mail enviado, mas falhou ao registrar no card:", e);
  }

  const { error: erroRegistro } = await supabase.from("panoramas_fianca_envios").insert({
    panorama_id: panoramaId,
    card_id: cardId,
    versao,
    tipo,
    canal: "email",
    para,
    cc,
    assunto: assunto.trim(),
    anexos: todosAnexosDoStorage.map((c) => c.nome),
    enviado_por_email: autor.email,
    registrado_no_card: registradoNoCard,
    resend_id: resendId,
  });
  if (erroRegistro) console.error("E-mail enviado, mas falhou ao salvar o registro do envio:", erroRegistro);

  return NextResponse.json({ ok: true, registradoNoCard });
}
