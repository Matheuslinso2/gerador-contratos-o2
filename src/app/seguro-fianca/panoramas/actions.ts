"use server";

import { revalidatePath } from "next/cache";
import { autorizarPanorama } from "@/lib/panoramaAutorizacao";
import { createServiceClient } from "@/lib/supabase/service";
import { BUCKET_ANEXOS } from "@/lib/bitrix/emailNoCard";
import { ENTITY_TYPE_ID_SEGURO_FIANCA } from "@/lib/bitrix/entidadesCard";
import { listarConversas, type Conversa } from "@/lib/bitrix/conversasEmail";
import { buscarConversasGmail, vincularConversaGmail, type ConversaGmail } from "@/lib/bitrix/conversasGmail";
import {
  buscarCardPanorama,
  buscarContatosEnvioPanorama,
  type ContatosEnvioPanorama,
} from "@/lib/bitrix/panoramaFianca";
import {
  LMI_BASICO,
  LMI_COMPLETO,
  celulaPreenchida,
  statusEditavel,
  type ChaveLinha,
  type FormaPagamento,
  type LinhaPanorama,
  type PrecosLinha,
} from "@/lib/panoramaFiancaConstantes";

export type ResultadoGerar = { ok: true; versao: number; linhas: LinhaPanorama[]; cabecalho: unknown } | { ok: false; erro: string };

// Gera a versão N+1 do panorama de um card. Cabeçalho e status são relidos
// do Bitrix AGORA (não confia no que a tela mostrava) -- só os preços vêm do
// colaborador, e só das linhas aprovadas/pré-aprovadas.
export async function gerarVersaoPanorama(
  cardId: number,
  formaPagamento: FormaPagamento,
  precos: Partial<Record<ChaveLinha, PrecosLinha>>,
  passeBitrix?: string | null, // aba "Panorama" dentro do card do Bitrix
  // Seguradoras que não aceitam a forma de pagamento escolhida: saem
  // "INDISPONÍVEL" (sem preços) mesmo estando aprovadas no Bitrix.
  indisponiveis: ChaveLinha[] = []
): Promise<ResultadoGerar> {
  const autor = await autorizarPanorama(cardId, passeBitrix);
  if (!autor) return { ok: false, erro: "Sem permissão (se estiver no Bitrix, reabra a aba Panorama)." };
  const supabase = autor.db;
  if (!["fatura", "boleto", "cartao"].includes(formaPagamento)) return { ok: false, erro: "Escolha a forma de pagamento." };

  let card;
  try {
    card = await buscarCardPanorama(cardId);
  } catch (e) {
    return { ok: false, erro: `Não consegui ler o card no Bitrix: ${(e as Error).message}` };
  }

  const linhas: LinhaPanorama[] = card.linhas.map((linhaBitrix) => {
    const indisponivel = statusEditavel(linhaBitrix.status) && indisponiveis.includes(linhaBitrix.chave);
    const l = indisponivel ? { ...linhaBitrix, status: "indisponivel" as const } : linhaBitrix;
    const p = statusEditavel(l.status) ? precos[l.chave] : undefined;
    const limpo: PrecosLinha = { basico: {}, completo: {} };
    for (const lmi of LMI_BASICO) if (celulaPreenchida(p?.basico?.[lmi])) limpo.basico[lmi] = p!.basico[lmi];
    for (const lmi of LMI_COMPLETO) if (celulaPreenchida(p?.completo?.[lmi])) limpo.completo[lmi] = p!.completo[lmi];
    return { ...l, precos: limpo };
  });

  const algumPreco = linhas.some((l) => Object.keys(l.precos.basico).length || Object.keys(l.precos.completo).length);
  if (!algumPreco) return { ok: false, erro: "Preencha pelo menos um preço (parcelas e valor) antes de gerar." };

  const { data: ultima } = await supabase
    .from("panoramas_fianca")
    .select("versao")
    .eq("card_id", cardId)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();
  const versao = (ultima?.versao ?? 0) + 1;

  const { error } = await supabase.from("panoramas_fianca").insert({
    card_id: cardId,
    versao,
    cabecalho: card.cabecalho,
    linhas,
    forma_pagamento: formaPagamento,
    assinatura_status: card.assinaturaStatus,
    gerado_por_email: autor.email,
  });
  if (error) return { ok: false, erro: `Erro ao salvar: ${error.message}` };

  revalidatePath("/seguro-fianca/panoramas");
  revalidatePath(`/seguro-fianca/panoramas/${cardId}`);
  return { ok: true, versao, linhas, cabecalho: card.cabecalho };
}

// Destinatários sugeridos pra janela de envio por e-mail (Fase 2).
export async function buscarContatosEnvio(
  cardId: number,
  passeBitrix?: string | null
): Promise<({ ok: true } & ContatosEnvioPanorama) | { ok: false; erro: string }> {
  if (!(await autorizarPanorama(cardId, passeBitrix))) return { ok: false, erro: "Sem permissão." };
  try {
    return { ok: true, ...(await buscarContatosEnvioPanorama(cardId)) };
  } catch (e) {
    return { ok: false, erro: `Não consegui ler os contatos no Bitrix: ${(e as Error).message}` };
  }
}

// Conversas de e-mail já existentes neste card (resposta do cliente, cópia
// da equipe, e-mails nossos) -- o envio pode continuar uma delas em vez de
// abrir outra tratativa por e-mail.
export async function buscarConversasEnvio(
  cardId: number,
  passeBitrix?: string | null
): Promise<{ ok: true; conversas: Conversa[] } | { ok: false; erro: string }> {
  if (!(await autorizarPanorama(cardId, passeBitrix))) return { ok: false, erro: "Sem permissão." };
  return { ok: true, conversas: await listarConversas(ENTITY_TYPE_ID_SEGURO_FIANCA, cardId) };
}

// Conversas do Gmail com o destinatário (últimos 45 dias) pra vincular ao
// card quando ele ainda não tem conversa registrada, e o vínculo em si.
export async function procurarConversasGmail(
  cardId: number,
  enderecos: string[],
  passeBitrix?: string | null
): Promise<{ ok: true; conversas: ConversaGmail[] } | { ok: false; erro: string }> {
  if (!(await autorizarPanorama(cardId, passeBitrix))) return { ok: false, erro: "Sem permissão." };
  try {
    return { ok: true, conversas: await buscarConversasGmail(enderecos) };
  } catch (e) {
    return { ok: false, erro: `Não consegui consultar o Gmail: ${(e as Error).message}` };
  }
}

export async function vincularConversaDoGmail(
  cardId: number,
  threadId: string,
  passeBitrix?: string | null
): Promise<{ ok: true; assuntoBase: string } | { ok: false; erro: string }> {
  if (!(await autorizarPanorama(cardId, passeBitrix))) return { ok: false, erro: "Sem permissão." };
  try {
    return { ok: true, ...(await vincularConversaGmail(ENTITY_TYPE_ID_SEGURO_FIANCA, cardId, threadId)) };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

// Cartas das seguradoras (recusa/pendência) anexadas ao e-mail: o navegador
// sobe direto pro Storage com esta URL assinada (mesmo bucket e mesmo
// esquema do E-mail no card), sem passar pelo limite de 4,5 MB do Vercel.
// A rota de envio só aceita caminhos dentro da pasta deste card.
const TAMANHO_MAXIMO_CARTA = 15 * 1024 * 1024;

export async function prepararUploadCarta(
  cardId: number,
  nomeArquivo: string,
  tamanho: number,
  passeBitrix?: string | null
): Promise<{ ok: true; caminho: string; token: string; bucket: string } | { ok: false; erro: string }> {
  if (!(await autorizarPanorama(cardId, passeBitrix))) return { ok: false, erro: "Sem permissão." };
  if (tamanho > TAMANHO_MAXIMO_CARTA) return { ok: false, erro: `"${nomeArquivo}" passa de 15 MB.` };
  // Chave do Storage sem acento/espaço (o nome original vai no e-mail).
  const seguro = nomeArquivo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(-120);
  const caminho = `${ENTITY_TYPE_ID_SEGURO_FIANCA}-${cardId}/${crypto.randomUUID()}-${seguro}`;
  const { data, error } = await createServiceClient().storage.from(BUCKET_ANEXOS).createSignedUploadUrl(caminho);
  if (error || !data) return { ok: false, erro: "Falha ao preparar o anexo." };
  return { ok: true, caminho: data.path, token: data.token, bucket: BUCKET_ANEXOS };
}
