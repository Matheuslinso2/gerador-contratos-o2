"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { criarCardsRenovacao, MAX_CARDS_POR_PEDIDO, type BlocoCriacao, type PedidoCard, type ResultadoCard } from "@/lib/erp/renovacaoCriarCards";

export type RespostaCriacao = { ok: true; resultados: ResultadoCard[] } | { ok: false; erro: string };

// Botão "Autorizar criação" da tela de Renovação (ERP). Só Ramos Elementares (SPA 1046). Acesso: admin ou colaborador O2, checado aqui no servidor.
export async function autorizarCriacaoCards(entrada: { bloco: string; de: string; ate: string; cards: PedidoCard[]; simular?: boolean }): Promise<RespostaCriacao> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email ?? "";
  if (!email || (!isAdmin(email) && !isColaboradorO2(email))) return { ok: false, erro: "Sem permissão para autorizar a criação de cards." };
  if (!["fianca", "cap", "auto", "re_lotes", "re_demais"].includes(entrada.bloco)) return { ok: false, erro: "Bloco inválido." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.de) || !/^\d{4}-\d{2}-\d{2}$/.test(entrada.ate)) return { ok: false, erro: "Período inválido." };
  if (!Array.isArray(entrada.cards) || !entrada.cards.length) return { ok: false, erro: "Nenhum card para criar." };
  if (entrada.cards.length > MAX_CARDS_POR_PEDIDO) return { ok: false, erro: `Máximo de ${MAX_CARDS_POR_PEDIDO} cards por vez. Filtre por imobiliária ou seguradora e autorize em partes.` };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const c of entrada.cards) {
    if (typeof c.titulo !== "string" || c.titulo.length > 300 || !Array.isArray(c.documentoIds) || !c.documentoIds.length || c.documentoIds.length > 600 || !c.documentoIds.every((i) => typeof i === "string" && uuid.test(i))) return { ok: false, erro: "Pedido de criação inválido." };
  }
  try {
    const resultados = await criarCardsRenovacao(entrada.cards, { bloco: entrada.bloco as BlocoCriacao, de: entrada.de, ate: entrada.ate, usuarioEmail: email, simular: !!entrada.simular });
    return { ok: true, resultados };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao criar os cards." };
  }
}
