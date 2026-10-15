"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { buscarCardPanorama } from "@/lib/bitrix/panoramaFianca";
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
  precos: Partial<Record<ChaveLinha, PrecosLinha>>
): Promise<ResultadoGerar> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || (!isAdmin(user.email) && !isColaboradorO2(user.email))) return { ok: false, erro: "Sem permissão." };
  if (!["fatura", "boleto", "cartao"].includes(formaPagamento)) return { ok: false, erro: "Escolha a forma de pagamento." };

  let card;
  try {
    card = await buscarCardPanorama(cardId);
  } catch (e) {
    return { ok: false, erro: `Não consegui ler o card no Bitrix: ${(e as Error).message}` };
  }

  const linhas: LinhaPanorama[] = card.linhas.map((l) => {
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
    gerado_por_email: user.email,
  });
  if (error) return { ok: false, erro: `Erro ao salvar: ${error.message}` };

  revalidatePath("/seguro-fianca/panoramas");
  revalidatePath(`/seguro-fianca/panoramas/${cardId}`);
  return { ok: true, versao, linhas, cabecalho: card.cabecalho };
}
