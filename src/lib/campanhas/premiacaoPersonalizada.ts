import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Premiação personalizada por cliente (04/11/2026, só Campanha Elite). Fica na linha de meta do
// participante dentro da campanha (campanhas_metas.premiacao_personalizada_html): é só o BLOCO de
// premiação, em linhas HTML do editor, sem título -- o título novo e todo o resto do e-mail vêm do
// modelo compartilhado (ver aplicarPremiacao em parcialCampanha.ts). Vazio = premiação padrão.
// A prévia e o envio leem daqui pela mesma função, então mostram a mesma composição.

const LIMITE_CARACTERES = 20_000;

/** Participante (id da linha de meta) -> bloco de premiação personalizada, só dos que têm. */
export async function premiacoesDaCampanha(db: SupabaseClient, campanhaId: string): Promise<Map<string, string>> {
  const { data, error } = await db.from("campanhas_metas").select("id, premiacao_personalizada_html").eq("campanha_id", campanhaId).not("premiacao_personalizada_html", "is", null);
  if (error) throw new Error("Não consegui ler as premiações personalizadas: " + error.message);
  const mapa = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; premiacao_personalizada_html: string | null }[]) {
    if (r.premiacao_personalizada_html && r.premiacao_personalizada_html.trim()) mapa.set(r.id, r.premiacao_personalizada_html);
  }
  return mapa;
}

/** Defesa simples: o HTML vem do editor da equipe, mas nunca guarda script nem manipulador de evento. */
export function limparHtmlPremiacao(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/href\s*=\s*"\s*javascript:[^"]*"/gi, 'href="#"')
    .trim();
}

type Resultado = { ok: true } | { ok: false; erro: string };

export async function salvarPremiacaoPersonalizada(db: SupabaseClient, campanhaId: string, participanteId: string, html: string): Promise<Resultado> {
  const limpo = limparHtmlPremiacao(html);
  if (!/<tr[\s>]/i.test(limpo) || limpo.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim().length === 0) {
    return { ok: false, erro: "A premiação está vazia: escreva o texto antes de salvar (ou use “Restaurar premiação padrão”)." };
  }
  if (limpo.length > LIMITE_CARACTERES) return { ok: false, erro: "A premiação ficou grande demais para um e-mail. Reduza o texto." };
  const { data, error } = await db
    .from("campanhas_metas")
    .update({ premiacao_personalizada_html: limpo, updated_at: new Date().toISOString() })
    .eq("id", participanteId)
    .eq("campanha_id", campanhaId)
    .select("id");
  if (error) return { ok: false, erro: "Não consegui salvar: " + error.message };
  if (!data?.length) return { ok: false, erro: "Este cliente ainda não tem linha de meta na campanha: defina a meta no quadro de produção antes de personalizar." };
  return { ok: true };
}

/** Remove SÓ a exceção deste cliente nesta campanha (as dos outros e o modelo geral não são tocados). */
export async function restaurarPremiacaoPadrao(db: SupabaseClient, campanhaId: string, participanteId: string): Promise<Resultado> {
  const { data, error } = await db
    .from("campanhas_metas")
    .update({ premiacao_personalizada_html: null, updated_at: new Date().toISOString() })
    .eq("id", participanteId)
    .eq("campanha_id", campanhaId)
    .select("id");
  if (error) return { ok: false, erro: "Não consegui restaurar: " + error.message };
  if (!data?.length) return { ok: false, erro: "Cliente não encontrado nesta campanha." };
  return { ok: true };
}
