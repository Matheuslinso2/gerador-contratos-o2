import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chamarBitrix } from "@/lib/bitrix/client";
import type { Oportunidade } from "./desempenho";

// Nome do pretendente nas oportunidades em aberto (27/10/2026). No Bitrix o
// nome do pretendente é o TÍTULO do card (Fiança 1042, Capitalização 1048,
// Ramos Elementares 1046); nas planilhas de Fiança vem de locatarios.nome,
// pelo locatario_id. Sem fonte confiável o campo fica null ("—" na tela):
// nunca se inventa nome. Falha em qualquer fonte não derruba o quadro.

const ENTIDADE_BITRIX: Record<string, number> = { fianca: 1042, capitalizacao: 1048, re: 1046 };
const LOTE = 50;

async function titulosBitrix(entidade: number, ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const resposta = await chamarBitrix<{ result: { items: { id: number | string; title: string | null }[] } }>("crm.item.list", {
      entityTypeId: entidade,
      "select": ["id", "title"],
      "filter[@id]": lote,
    });
    for (const item of resposta.result?.items ?? []) if (item.title) mapa.set(String(item.id), String(item.title).trim());
  }
  return mapa;
}

export async function resolverPretendentes(db: SupabaseClient, oportunidades: Oportunidade[]): Promise<void> {
  const porEntidade = new Map<number, Set<string>>();
  const locatarios = new Set<string>();
  for (const o of oportunidades) {
    const ref = o.ref;
    if (!ref) continue;
    if (ref.fonte === "bitrix" && ref.bitrixId) {
      const entidade = ENTIDADE_BITRIX[o.produto];
      if (entidade) porEntidade.set(entidade, (porEntidade.get(entidade) ?? new Set()).add(ref.bitrixId));
    } else if (ref.locatarioId) {
      locatarios.add(ref.locatarioId);
    }
  }

  const titulos = new Map<string, string>(); // `${entidade}:${id}` -> título
  await Promise.all(
    [...porEntidade].map(async ([entidade, ids]) => {
      try {
        const mapa = await titulosBitrix(entidade, [...ids]);
        for (const [id, titulo] of mapa) titulos.set(`${entidade}:${id}`, titulo);
      } catch {
        // Bitrix indisponível: fica sem nome, o link do card continua.
      }
    })
  );

  const nomesLocatario = new Map<string, string>();
  if (locatarios.size) {
    try {
      const ids = [...locatarios];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("locatarios").select("id, nome").in("id", ids.slice(i, i + 200));
        for (const l of (data ?? []) as { id: string; nome: string | null }[]) if (l.nome) nomesLocatario.set(l.id, l.nome.trim());
      }
    } catch {
      // sem nome
    }
  }

  for (const o of oportunidades) {
    const ref = o.ref;
    if (ref) {
      if (ref.fonte === "bitrix" && ref.bitrixId) o.pretendente = titulos.get(`${ENTIDADE_BITRIX[o.produto]}:${ref.bitrixId}`) ?? null;
      else if (ref.locatarioId) o.pretendente = nomesLocatario.get(ref.locatarioId) ?? null;
    }
    delete o.ref;
  }
}
